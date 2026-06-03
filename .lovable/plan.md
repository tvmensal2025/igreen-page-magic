# Por que o Fluxo D entrou no meio

Confirmei no banco:

- `settings.flow_ab_mode = 'only_D'` → o roteador global está forçando **toda** decisão de variante para D.
- O lead `5511971254913` está agora com `flow_variant = 'D'` e `conversation_step = flow:c87d76f8…` (UUID que pertence ao **Fluxo D**, step `d_como_funciona` — exatamente o que apareceu nos logs do `whapi-webhook`).
- O `dev-fire-all-steps` resetou pra A e disparou o primeiro passo do Fluxo A, mas em algum ponto da jornada o lead voltou pra D porque o ambiente inteiro está configurado em `only_D`.

Resumindo: o disparo inicial foi A, mas o ecossistema (settings + autocura de step + re-resolução de fluxo) puxou o lead pra D na primeira oportunidade.

# Plano de correção (para conseguir testar o Fluxo A em 1 número)

## 1. Travar o roteamento global em `only_A` durante o teste
Atualizar `settings.flow_ab_mode` de `only_D` → `only_A`. Isso garante que **nenhum** caminho do webhook/autocura possa empurrar o lead para D, mesmo que algo limpe a variante do customer.

(Depois do teste, posso reverter pra `split` ou `only_D` — você escolhe.)

## 2. Resetar o lead `5511971254913` para virgem + variante A
Via `dev-fire-all-steps` com `{ customerId, variant: "A", fresh: true, mode: "real" }`:
- limpa `conversation_step`, OCR, docs, histórico
- força `flow_variant = 'A'`, `capture_mode = 'auto'`
- dispara só o **primeiro passo do Fluxo A** (boas-vindas) e o `whapi-webhook` cuida do resto conforme você responder no WhatsApp

## 3. Validar passo-a-passo nos logs
Acompanhar `whapi-webhook` enquanto você responde:
- esperado: `boas_vindas → qualificação → como_funciona (audio A) → fazenda_solar (audio A) → checkin_pos_video → pitch_conexao_club → duvidas_pos_club → aguardando_conta (OCR) → simulação → ask_quero_cadastrar → aguardando_doc_auto → finalizar`
- se em qualquer momento aparecer `step_key` começando com `d_` (ex: `d_como_funciona`) → bug, paro e investigo.

## 4. (Opcional, depois) Reverter o A/B
Quando você confirmar que o Fluxo A rodou inteiro, devolvo `flow_ab_mode` ao valor que você quiser (`split` para 50/50, ou `only_D` se quiser voltar como estava).

# Detalhes técnicos

- A migração será só um `UPDATE settings SET value='only_A' WHERE key='flow_ab_mode'` (1 linha).
- O `dev-fire-all-steps` já está travado no número `5511971254913` (anti-abuso), então o disparo é seguro.
- Nenhum código de produção precisa ser alterado pra esse teste — o problema foi configuração, não bug.

# Pergunta antes de aplicar

Você quer que eu **mantenha** `only_A` no final do teste (todo lead novo entra em A) ou **reverta** para `split` (50/50 A vs D) assim que o Fluxo A rodar inteiro?
