# Fluxo Cadastro custom — bridge UUID→sys aplicado

## Causa raiz definitiva

`routeEngine` (`_shared/flow-router.ts`) decide qual motor processa cada turno:
- `sys` (bot-flow.ts legacy) → tem OCR, edição, Portal 2, finalize-capture
- `flow` (runConversationalFlow) → só envia prompts de step custom

A regra atual manda **qualquer UUID** para `flow`. Mas os passos custom de
captura (`capture_conta`, `capture_documento`, `capture_email`, `confirm_phone`,
`finalizar_cadastro`) precisam do `sys` porque só ele processa foto/PDF/botão.
Resultado: lead em flow custom envia conta, `runConversationalFlow` não roda
OCR, re-emite o prompt em loop. Confirmado com lead `5511971254913`: enviou
conta 2×, bot pediu 3×, `ocr_conta_attempts=0`, `electricity_bill_photo_url=NULL`.

## Correção aplicada

### Bridge UUID→sys nos dois webhooks

`whapi-webhook/index.ts` (~linha 1746) e `evolution-webhook/index.ts` (~linha 1750):

```ts
if (engine === "flow" && UUID_RE.test(currentStepRaw)) {
  const { data: stepRow } = await supabase
    .from("bot_flow_steps").select("step_type")
    .eq("id", currentStepRaw).maybeSingle();
  if (CAPTURE_TYPES.has(stepRow?.step_type)) {
    engine = "sys";  // NÃO limpa conversation_step
  }
}
```

`CAPTURE_TYPES = {capture_conta, capture_documento, capture_doc, capture_email, confirm_phone, finalizar_cadastro}`.

O UUID é preservado em `conversation_step` porque o **custom-step-resolver**
dentro de `bot-flow.ts` (linha ~2856) já sabe localizar o passo pelo UUID,
mapear `step_type` para o nominal (`capture_conta` → `aguardando_conta` etc.),
cair no `case` do switch que processa OCR + envia botões SIM/NÃO/EDITAR, e
avançar para o próximo UUID do flow custom via `position+1`.

### Recuperação do lead preso

`customer_flow_state` do `11f79043-...` resetado: `retries=0`,
`last_outbound_content_hash=NULL`, `status='idle'`. Próximo inbound será
processado pelo bridge corrigido.

## Fluxo end-to-end agora garantido

```text
"Oi" → router detecta UUID capture_conta → engine=sys
     → bot-flow resolve UUID → step=aguardando_conta → pede conta
foto → OCR Gemini → botões SIM/NÃO/EDITAR
SIM  → próximo step (position+1) → UUID capture_documento
     → resolve → aguardando_doc_auto → pede documento
foto → OCR RG/CNH frente+verso → botões SIM/NÃO/EDITAR
SIM  → capture_email → ask_email → valida
SIM  → confirm_phone → ask_phone_confirm → confirma
SIM  → finalizar_cadastro → finalizando
     → invoke('finalize-capture') → submete Portal 2
     → OTP interceptado → cliente digita → link de assinatura enviado
```

## Por que é minimal e seguro

- **Não toca em bot-flow.ts (6.087 linhas)** — lógica downstream já correta.
- **Não muda routeEngine compartilhado** — evita regressão em outros flows.
- **Não cria tabelas** — só lê `bot_flow_steps.step_type`.
- **Fail-safe**: try/catch; erro mantém engine='flow' (comportamento anterior).

## Validação

Após próximo lead novo entrar no flow Cadastro:

```sql
SELECT id, conversation_step, ocr_conta_attempts,
       electricity_bill_photo_url IS NOT NULL AS bill_ok,
       document_front_url IS NOT NULL AS doc_ok, email, status
FROM customers
WHERE created_at > now() - interval '24h'
ORDER BY created_at DESC;
```

Esperado: `ocr_conta_attempts >= 1` e `bill_ok=true` após primeira foto.

## Status

| Pacote | Status |
|---|---|
| Trigger `log_silent_step_reset` por rank | ✅ |
| Bridge UUID→sys (este) | ✅ |
| Auto-retomada `confirmando_*` >1h | ⏳ |
| Lock em `ask_finalizar` | ⏳ baixa |
