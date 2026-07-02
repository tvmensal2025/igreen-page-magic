# Blindagem do rodízio de parceiros

Análise completa feita. O sistema hoje **funciona na maior parte dos casos**, mas tem 3 furos que explicam o incidente que você relatou (lead foi para o parceiro errado). Este plano corrige esses furos **sem ativar nenhum anúncio** — só deixa o motor pronto para você adicionar 2, 10 ou 50 parceiros sem risco.

---

## Como funciona hoje (resumo em português)

Quando alguém clica no anúncio do Facebook e cai no seu WhatsApp, o sistema tenta descobrir **de qual anúncio veio** em 4 tentativas, em ordem:

1. **AD ID do Meta** (perfeito, sem erro) — se o Meta mandou o ID do anúncio no payload.
2. **CTWA CLID** (ID único do clique) — se já foi visto antes.
3. **Frase inicial cadastrada** — compara os primeiros 60 caracteres da mensagem com a `initial_message` da campanha.
4. **Fallback pela frase-âncora genérica do CTWA** ("olá, posso ter mais informações…") — **AQUI mora o bug**.

Depois de descobrir a campanha, chama a função `rodizio_next()` no Postgres, que devolve o próximo parceiro da fila (round-robin) e atribui.

---

## Os 3 furos que precisam sumir

### 🔴 Furo 1 — Fallback "pool única" atribui ao parceiro errado

**O que acontece:** se o sistema não consegue identificar o anúncio pelos métodos 1–3, ele cai no fallback que diz: *"se o consultor só tem 1 pool de rodízio ativa, use essa"*. Isso **parece seguro**, mas quebra em 2 casos:

- Você tem 2 anúncios rodando com pools diferentes → o lead do anúncio A pode ir para a pool do anúncio B.
- Você pausou um anúncio mas esqueceu a pool ativa → todo lead novo vira "da pool errada".

**Foi provavelmente isso que causou o incidente que você relatou.**

**Correção:** desligar o fallback silencioso. Se não deu para identificar o anúncio com certeza, o lead fica com o consultor dono (você) e **não** é distribuído no rodízio. Nada de "chute educado".

### 🔴 Furo 2 — Corrida de mensagens no primeiro contato

**O que acontece:** quando é um lead novinho (primeira vez que ele fala), o sistema **não trava** o processamento. Se o lead manda 2 mensagens em menos de meio segundo (comum: "oi" e depois a frase do anúncio), o webhook processa **as duas em paralelo**, chama `rodizio_next()` duas vezes, e dois parceiros diferentes recebem notificação do mesmo lead.

**Correção:** adicionar lock de "primeira mensagem por telefone" para forçar processamento serial dos primeiros segundos.

### 🔴 Furo 3 — Erro no rodízio é engolido em silêncio

**O que acontece:** se a RPC `rodizio_next` der timeout, erro de conexão ou qualquer exceção, o código faz `console.warn` e segue. O lead vai para o consultor dono sem alerta nenhum. Você só descobre quando o parceiro reclama que não recebeu.

**Correção:** registrar toda falha do rodízio em `campaign_match_log` com `method='rodizio_fallback'` + criar um alerta visível no `/admin` quando isso acontecer.

---

## Arquivos que serão tocados

**Edge functions (backend WhatsApp):**

- `supabase/functions/evolution-webhook/index.ts` — remover chamada ao fallback pool-única (linhas 983–1000), adicionar lock de primeira mensagem, registrar falhas de rodízio.
- `supabase/functions/whapi-webhook/index.ts` — mesmas 3 correções (código espelhado).
- `supabase/functions/_shared/meta-ctwa-fallback.ts` — deprecar a função `resolveSingleActivePool` (deixa comentada + throw se chamada).
- `supabase/functions/_shared/rodizio-assignment.ts` — expor motivo do fallback pra cima.

**Banco de dados (migration nova):**

- Constraint `UNIQUE (campaign_id) WHERE is_active = true` em `rodizio_pools` — impede 2 pools ativas para a mesma campanha.
- Nova tabela `lead_first_message_lock (phone, consultant_id, locked_at)` com TTL 30s — usada pelo lock do Furo 2.
- Nova coluna `campaign_match_log.rodizio_outcome text` — registra `assigned | pool_empty | rpc_error | no_campaign`.

**Frontend admin (visibilidade):**

- Novo card em `src/pages/Admin.tsx` (aba Anúncios ou Conversão) mostrando "Leads que caíram no fallback nas últimas 24h" — pra você ver na hora quando algo não bater.

---

## O que NÃO faz parte deste plano

- Nenhum anúncio será ligado, pausado ou modificado.
- Nenhuma pool existente será mexida.
- Nenhum parceiro será adicionado/removido — isso continua manual em `referral_partners`.
- A RPC `rodizio_next` do Postgres **não** vai ser reescrita agora (ela está fora do repositório). Só será exposta como migration versionada em um plano futuro se você quiser.

---

## Ordem de execução

1. **Migration** (constraint + lock table + coluna de log) — 1 arquivo SQL.
2. **Edge functions** — 4 arquivos editados, deploy automático.
3. **Frontend admin** — card de monitoramento.
4. **Teste manual guiado**: te passo um checklist de 5 cenários para simular (lead com AD ID, lead sem nada, lead com 2 msgs em <1s, campanha sem pool, pool vazia) — todos devem ter comportamento previsível e logado.

Depois disso, quando você quiser cadastrar mais parceiros e ligar um anúncio, o sistema aguenta sem chutar.

---

## Perguntas antes de eu implementar

1. Ao remover o fallback "pool única" (Furo 1), leads não-identificados ficam com **você** (consultor dono). OK ou prefere que fiquem em uma fila de revisão manual visível no `/admin`? fique em uma fila, e quem fez o anuncio recebe uma mensagem. mas ai ele nao finaliza, e sim aguarda a pessoa finalizar manual, assim nunca cadastra errado. mas é uma situacao que nao pode acontecner
2. O alerta de fallback no admin: notificação in-app basta, ou também quer WhatsApp para o seu número quando acontecer? sim no whatsapp do alerta 