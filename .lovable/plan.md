# Auditoria profunda — `duvidas-dificeis-v3` (20 conversas)

Resultado geral: **5/20 (25%)** chegaram em `cadastro_finalizando`. Os 10 scripted foram bem (10/10 ok), mas os **10 personas LLM colapsaram** todos no mesmo ponto: a etapa `foto_conta`. O fix anterior (`pedido_humano`/`desistencia` expandidos) introduziu regressão grave e os templates determinísticos viraram um loop.

## Bugs encontrados (por categoria)

### 🔴 BUG 1 — `deterministic_despedida` falso-positivo (CRÍTICO)
**Onde:** `templates.ts` — detector `desistencia`.
**Conv-12 turn 3:** lead diz `"me chamo sebastião. mas não precisa instalar nada aqui em casa mesmo? não quero obra não."` → bot responde **"Qualquer hora que quiser economizar é só me chamar 😊"** + `handoff`.
**Causa:** regex de desistência casa `"não quero"` mesmo quando o objeto é "obra" (= reforço positivo, não desistência). A frase é uma **pergunta de objeção**, não uma despedida.
**Impacto:** mata conversas no turno 3. Provavelmente responsável por boa parte dos handoffs prematuros nas personas mais avessas a risco (`aposentado`).

### 🔴 BUG 2 — Loop infinito em `foto_conta` quando lead afirma envio (CRÍTICO)
**Onde:** `orchestrator.ts` / `templates.ts` — sem handler para "afirmação de envio sem mídia".
**Manifesta em:** conv-11, 13, 14, 15, 16, 17, 19, 20 (8 das 10 personas).
**Padrão:** lead diz `"mandei aí"`, `"já mandei, viu?"`, `"vê se chegou"`, `"acho que bugou, mandei de novo"`. Bot sempre responde com `"Me manda a foto da sua conta de luz 📷"` — 4 a 7 vezes seguidas, com variações triviais. Nenhum reconhecimento de que o lead **afirma ter enviado** e não chegou nada.
**Esperado:** detectar `afirma_envio_sem_midia` → responder algo como **"Aqui ainda não chegou a foto, Bruno 🙈 pode tentar reenviar? Às vezes o zap engasga."** + após 2 tentativas, escalar.

### 🟠 BUG 3 — `deterministic_duvida:generica` em loop
**Onde:** `templates.ts` — fallback genérico.
**Manifesta em:** todas as personas. O bot dispara `"boa pergunta! É tudo sem obra, sem fidelidade e regulamentado pela ANEEL ⚡"` **3-5 vezes na mesma conversa**, ignorando o conteúdo real da mensagem.
**Exemplos:**
- conv-11 turn 6: lead pergunta `"precisa de email tbm? bruno.silva88@gmail.com"` → bot responde ANEEL genérico, **ignora o email** entregue.
- conv-13 turn 9: lead pede `"manda seu email também por garantia?"` → bot responde ANEEL.
- conv-19 turn 2: lead `"como funciona isso?"` → bot responde ANEEL e pula direto pro valor da conta, **sem explicar**.
**Causa:** o gate "se etapa determinística e mensagem é dúvida → usa template fixo" não tem anti-repetição nem prioridade pra RAG quando a dúvida é específica (email, como funciona, técnica).

### 🟠 BUG 4 — `deterministic_duvida:foto_antes` mal redigido
**Onde:** `templates.ts` → resposta `foto_antes`.
**Conv-11 turn 5 / conv-20 turn 6:** lead diz `"pode sim, mando a foto?"` → bot responde **"pode mandar sim! Mas antes preciso de um detalhinho rápido: Me manda a foto da sua conta de luz 📷"** — diz "antes preciso de um detalhinho" mas **só pede a própria foto** (frase quebrada, sem sentido).

### 🟠 BUG 5 — Capitalização de nomes inconsistente
**Onde:** `microWrite` / `templates.ts`.
**Sintoma:** bot intercala `"Bruno"` (correto) com `"bruno"` (minúsculo) na mesma conversa. Conv-13/14/19/20 todos têm isso. Quebra a percepção de naturalidade.

### 🟠 BUG 6 — Não responde à pergunta, só pula etapa
**Conv-19 turn 2:** `"como funciona isso?"` → bot dá resposta genérica de 1 linha + força `"Qual o valor médio da sua conta?"`. Lead que pediu explicação técnica recebe slogan.
**Conv-15 (engenheiro):** lead pergunta detalhes técnicos de compensação ANEEL várias vezes; bot só repete `"continua a mesma distribuidora, sem boleto novo"` sem responder o "como" técnico. RAG deveria entrar aqui.

### 🟠 BUG 7 — `deterministic_duvida:foto_antes` triggando fora de hora
**Conv-20 turn 6:** etapa já é `foto_conta` (lead vai mandar a foto) → bot reativa o handler `foto_antes` como se fosse pré-foto. Estado vs. tema bate errado.

### 🟡 BUG 8 — Handoff sem motivo no turno 11+
A maioria das personas termina em `handoff` no turno 11-19 **sem trigger explícito** — provavelmente um contador de "rounds em foto_conta sem mídia". OK como salvaguarda, mas o lead nunca soube por que foi escalado: a última resposta do bot ainda é "envia a foto" e o handoff é silencioso.

### 🟡 BUG 9 — Crash não tratado (conv-18 turn 4)
HTTP 500 do `google/gemini-3-flash-preview` após 25s → conversa morre. Falta retry/fallback no caminho do micro-writer.

## Plano de correção (ordem de impacto)

1. **Adicionar handler `afirma_envio_sem_midia`** em `templates.ts`
   - Regex: `/\b(mandei|enviei|t[oô] mandando|t[áa] a[ií]|segue (a )?foto|chegou)\b/i` quando `etapa === "foto_conta"` e `hasMedia === false`.
   - Contador `attemptsSinceLastReal` no state. Resposta varia por tentativa:
     - 1ª: "Bruno, aqui ainda não chegou nada 🙈 pode reenviar? às vezes o zap engasga."
     - 2ª: "Ainda não recebi, viu. Tenta tirar uma nova foto ou enviar como documento PDF."
     - 3ª: handoff explícito **com motivo dito ao lead** ("Vou chamar um consultor pra te ajudar a enviar a foto").

2. **Restringir detector `desistencia`** em `templates.ts`
   - NÃO disparar quando `não quero/precisa/tem` é seguido de substantivo que aparece como benefício (`obra`, `instalação`, `placa`, `multa`, `fidelidade`, `taxa`, `boleto novo`).
   - Exigir intenção de saída explícita: `"não tenho interesse"`, `"deixa pra lá"`, `"depois eu vejo"`, `"vou pensar e te aviso"`, `"melhor não"`, `"fica pra outra hora"`.
   - Frases interrogativas (`?` no fim ou começa com palavra-pergunta) NUNCA são desistência.

3. **Anti-repetição global do template genérico**
   - State guarda último `templateKey` usado. Se o mesmo `deterministic_duvida:generica` for solicitado 2× seguidas, força fallback pra: (a) RAG real via `buscarContexto`, (b) micro-writer com instrução "responda diretamente a essa mensagem".

4. **Detectar email no inbound durante `foto_conta`**
   - Já existe `extrairEmail`. Quando lead manda email não solicitado, salvar em `customer.email` e responder breve confirmação ("Anotei seu e-mail, valeu! Agora só falta a foto da conta 📷"), em vez de responder com ANEEL genérico.

5. **Capitalização determinística de nomes**
   - Helper `prettyName(s)` aplicado em **todo** ponto que injeta nome em template (não só na saudação). Primeira letra de cada palavra do primeiro nome.

6. **Corrigir frase do `foto_antes`**
   - Trocar `"pode mandar sim! Mas antes preciso de um detalhinho rápido:"` por `"Pode mandar a foto sim! 📷"` (sem o "detalhinho" fantasma).
   - Só ativar `foto_antes` quando `etapa !== "foto_conta"`.

7. **Forçar RAG quando dúvida é técnica/específica**
   - Lista de gatilhos que **sempre** chamam `buscarContexto` mesmo em etapa determinística: `como funciona`, `compensação`, `kw/h`, `injeção`, `crédito`, `usina`, `pagamento`, `taxa`, `cobrança`.

8. **Retry no micro-writer**
   - Em `gateway.ts`/`micro-writer`: se HTTP 5xx ou timeout, 1 retry com `gemini-2.5-flash` (fallback) antes de propagar erro.

9. **Handoff comunicado ao lead**
   - Quando `shouldHandoff = true` por contador de loop, última resposta do bot deve incluir frase tipo "Vou chamar um consultor pra te ajudar agora 👤" — não pode ser silencioso.

## Validação

Após aplicar 1-3 + 5-6 (bloco crítico), rodar novamente as 10 personas (`--only persona`) e medir:
- ≥6/10 chegam em `cadastro_finalizando` (vs. 0/10 hoje)
- 0 ocorrências de `deterministic_duvida:generica` repetido 3× na mesma conversa
- 0 handoffs no turno ≤4 sem trigger explícito do lead
- email entregue pelo lead é capturado em ≥80% dos casos

## Arquivos a tocar

- `supabase/functions/_shared/vendedora/templates.ts` (bugs 1, 2, 3, 4, 6, 7, 9)
- `supabase/functions/_shared/vendedora/orchestrator.ts` (bugs 2, 3, 4, 7, 9)
- `supabase/functions/_shared/vendedora/extractors.ts` (bug 4 — capturar email em qualquer etapa)
- `supabase/functions/_shared/vendedora/gateway.ts` (bug 8 — retry)
- `.lovable/plan.md` — registrar este plano
