## Objetivo

Deixar **todas as frases de reaquecimento** (catálogo do sistema + templates por etapa) **prontas, coerentes, profissionais e sem `{{nome}}`** — porque em muitos leads o nome não foi capturado e a frase fica esquisita ("Oi , vi que…"). Também tornar mais fácil para quem edita: comentários claros + variáveis previsíveis.

## Diagnóstico do que está faltando hoje

1. **Catálogo embarcado** (`supabase/functions/_shared/conversion/phrase-catalog.ts`)
   - 30 frases (follow-up, welcome, objeções, por etapa, hot/warm).
   - **Todas** usam `{{nome}}` no começo → quando o nome não foi capturado vira `"Oi , vi que…"` ou `", confirma os dados"`.
   - Algumas etapas não têm frase de reaquecimento (ex.: `simulacao_apresentada`, `corrigir_celular_portal`, `como_funciona`, `completa_ou_rapida`, `boas_vindas_botoes` — visíveis no print).

2. **Templates por consultor** (tabela `reactivation_templates`, UI em `ReaquecimentoTemplates.tsx`)
   - Hoje só mostra os steps **que têm leads parados**. Se nunca houve lead parado naquela etapa, ela some da lista e o admin não consegue pré-preparar a frase.
   - Label da variável `{{nome}}` ainda aparece como sugestão no helper.

3. **Renderizador** (`renderPhraseText` e `renderMessage`)
   - Quando `name` é vazio, substitui por string vazia → gera vírgula/espaço solto (`"Oi , tudo bem?"`).

## O que vai ser feito

### A) Catálogo (`phrase-catalog.ts`) — reescrita das 30 frases
- Remover `{{nome}}` de **todas** as mensagens.
- Reescrever em tom profissional e neutro (sem depender de nome). Mantém `{{valor_conta}}` e `{{representante}}` quando úteis.
- Acrescentar frases para as etapas que faltam, cobrindo o fluxo completo visto no editor:
  - `boas_vindas_botoes`
  - `como_funciona`
  - `completa_ou_rapida`
  - `aguardando_valor_conta`
  - `simulacao_apresentada` / `resultado_simulacao_sim` / `resultado_simulacao_nao`
  - `aguardando_conta` (já existe — só revisar)
  - `aguardando_foto_conta` (já existe)
  - `confirmando_dados` (já existe)
  - `aguardando_doc` (já existe)
  - `aguardando_facial` (já existe)
  - `corrigir_celular_portal`
  - `portal_submitting` (já existe)
  - `aguardando_humano` (já existe)

### B) Renderizador robusto
- Em `renderPhraseText` e `reactivation-cron/renderMessage`:
  - Se a frase contiver `{{nome}}` e o nome estiver vazio, **omitir limpo** (sem vírgula/espaço sobrando).
  - Colapsar espaços duplos e vírgulas órfãs (`", "` no início → remove).
  - Mantém compatibilidade com templates antigos do banco que ainda têm `{{nome}}`.

### C) Painel de Templates (`ReaquecimentoTemplates.tsx`)
- Lista de etapas disponíveis passa a ser a **união** de:
  1. Etapas com leads parados (como hoje).
  2. Catálogo canônico de etapas conhecidas (lista fixa).
- Remover `{{nome}}` da dica de variáveis do textarea; deixar só `{{valor_conta}}` e `{{representante}}` com um aviso curto: "Sem variáveis de nome — funcionam mesmo quando o nome ainda não foi capturado."
- Botão "Restaurar texto sugerido" por etapa (preenche o textarea com a frase oficial do catálogo).

### D) Documentação curta no topo do `phrase-catalog.ts`
- Bloco de comentário explicando, em português simples:
  - O que é cada categoria (follow-up, welcome, objeção, step, hot).
  - Quais variáveis existem (`{{valor_conta}}`, `{{representante}}`) e por que **não** usamos mais `{{nome}}`.
  - Como adicionar uma frase nova (passo a passo: copiar, mudar `shortcut`, escrever texto curto, salvar).

## Exemplos da reescrita (antes → depois)

| Etapa | Antes | Depois |
|---|---|---|
| `/fup24h` | `{{nome}}, ontem você perguntou sobre desconto…` | `Ontem conversamos sobre o desconto na conta de luz. Posso te enviar a simulação agora — só preciso do valor médio da conta 📊` |
| `/step_aguardando_foto_conta` | `{{nome}}, sem a foto da conta não consigo simular…` | `Sem a foto da conta de luz não consigo simular o desconto. Pode tirar uma foto bem legível e enviar aqui? 📸` |
| `/step_confirmando_dados` | `{{nome}}, confirma se os dados…` | `Os dados da conta estão certinhos? Se sim, responde "sim" que seguimos com o cadastro 👍` |
| novo `/step_corrigir_celular_portal` | — | `Vi que paramos na etapa de confirmar o celular no portal. Pode me enviar o número correto com DDD pra eu corrigir e seguir o cadastro?` |
| novo `/step_simulacao_apresentada` | — | `Vi que você parou logo após a simulação. Faz sentido o desconto que apresentei? Posso te explicar qualquer parte 💚` |

## Arquivos afetados

- `supabase/functions/_shared/conversion/phrase-catalog.ts` — reescrever todas as frases + adicionar novas + render robusto + comentário-guia.
- `supabase/functions/reactivation-cron/index.ts` — endurecer `renderMessage` (limpar vírgula/espaço quando nome ausente).
- `supabase/functions/reactivation-cron/index_test.ts` — atualizar/adicionar testes: nome ausente não deixa vírgula órfã.
- `src/components/admin/reaquecimento/ReaquecimentoTemplates.tsx` — união de etapas + remover hint de `{{nome}}` + botão "Restaurar sugerido".

## Detalhes técnicos

- `renderPhraseText`: pré-processar a string trocando padrões `"{{nome}}, "`, `", {{nome}}"`, `"Oi {{nome}}!"` por versão sem nome quando `firstName` vazio. Depois rodar o `replaceAll` normal.
- `reactivation-cron/renderMessage`: aplicar a mesma normalização (helper compartilhado para evitar duplicação).
- Catálogo canônico de etapas (frontend): exportar `KNOWN_REACTIVATION_STEPS` de um único lugar (`src/lib/reactivation-steps.ts`) consumido pelo painel.
- Sem migração de banco. Templates antigos (com `{{nome}}`) continuam funcionando porque o render fica tolerante.

## Critérios de aceite

- Nenhuma frase do catálogo contém `{{nome}}`.
- Render de qualquer frase com `name=null` não gera vírgula/espaço sobrando.
- Painel Admin → Reaquecimento → Templates mostra **todas** as etapas conhecidas, mesmo sem lead parado.
- Cobertura completa: cada etapa do fluxo (do print) tem 1 frase de reaquecimento profissional padrão.
- Testes em `index_test.ts` passam, incluindo novo caso "nome ausente".
