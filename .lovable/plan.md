
# Corrigir fluxo Cadastro custom (5 passos) — 100% sem erro

## Problema confirmado com o lead 5511971254913

O flow `28acf20a` ("Cadastro") tem 5 passos sequenciais:

```text
1. capture_conta          (passo_mqozng6u) ← cliente travou aqui
2. capture_documento      (passo_mqoznqri)
3. capture_email          (passo_mqoznz0g)
4. confirm_phone          (passo_mqozocdy)
5. finalizar_cadastro     (passo_mqozop4s) → OTP → link assinatura
```

O cliente mandou "Oi", recebeu o pedido da conta, enviou 2 fotos da conta de luz — e o bot **reenviou o prompt 3x** em vez de processar. Estado final:

- `electricity_bill_photo_url = NULL` (URL nunca salva)
- `ocr_conta_attempts = 0` (OCR nunca chamado)
- `last_inbound_media_url` = base64 da conta (mídia chegou, mas ficou parada)
- `retries = 3`, `status = delegated_legacy`
- Zero linhas em `bot_step_transitions`, `engine_logs`, `outbound_message_log`

## Causa raiz

Quando o `conversation_step` é um **UUID de passo customizado** (ex.: `3d69389d…` para capture_conta), o handler legacy:

1. Mapeia o `step_type` UUID → nome nominal (`capture_conta` → `aguardando_conta`) **apenas para mensagens de texto**.
2. No caminho de **mídia (imagem/PDF)**, esse mapeamento não roda antes do switch que decide chamar OCR. Resultado: cai no fallback `repeat` do passo custom e reenvia o prompt.
3. Mesmo problema afetará `capture_documento` (frente e verso), e `confirm_phone` (botão "Sim" vs "Editar") quando o step for UUID — porque ambos dependem do mesmo bridge.

Adicionalmente, depois do OCR confirmado o engine precisa avançar para o **próximo UUID do flow custom** (via `position + 1` em `bot_flow_steps WHERE flow_id`), não para o nome nominal antigo (`ask_email`).

## Escopo da correção (apenas o necessário para os 5 passos rodarem direto)

### 1. Bridge UUID → nominal no caminho de mídia (CRÍTICO)

Em `whapi-webhook/handlers/bot-flow.ts` e `evolution-webhook/handlers/bot-flow.ts`:

- Antes de qualquer roteamento de mídia, ler `bot_flow_steps.step_type` quando `conversation_step` é UUID.
- Se `step_type ∈ {capture_conta, capture_documento}` e inbound é mídia → normalizar `step` para `aguardando_conta` / `aguardando_doc_auto` **e** salvar a URL/base64 no campo final (`electricity_bill_photo_url` ou `document_front_url`/`document_back_url`) **antes** de chamar OCR.
- Guardar o `flow_id` + `position` originais em variáveis locais para usar no avanço.

### 2. Avanço sequencial pelo flow custom

Após cada passo concluir (OCR confirmado, email validado, telefone confirmado):

- Em vez de pular para o step nominal hard-coded, fazer:
  ```sql
  SELECT id FROM bot_flow_steps
   WHERE flow_id = :current_flow_id
     AND position > :current_position
     AND is_active = true
   ORDER BY position ASC LIMIT 1;
  ```
- Gravar esse UUID em `conversation_step` e registrar transição em `bot_step_transitions` (`from_step`, `to_step`, `reason='flow_step_completed'`).
- Se não houver próximo passo → step_type = `finalizar_cadastro` → disparar `finalize-capture`.

### 3. Bridge para `confirm_phone` UUID

- Quando `step_type = confirm_phone` e inbound é botão "Sim" / texto "1" → marcar `phone_contact_confirmed=true` e avançar (regra acima).
- Quando botão "Editar" / texto "2" → entrar em mini-fluxo `editando_telefone` (já existe nominal) e ao confirmar voltar para o **próximo passo do flow custom**, não para o nominal.

### 4. Trigger `finalizar_cadastro` no fim

Step `finalizar_cadastro` (passo_mqozop4s) deve:

1. Validar que `electricity_bill_photo_url`, `document_front_url`, `cpf`, `email`, `phone_contact_confirmed` estão preenchidos.
2. Se faltar algo → reenviar **um** prompt apontando o que falta (sem loop) e pausar.
3. Se completo → invocar `supabase.functions.invoke('finalize-capture', { customer_id })` que já existe e cuida de:
   - submeter ao Portal 2 (worker Playwright)
   - aguardar OTP (intercepção via `otp-intercept.ts` no webhook)
   - aguardar link de assinatura do Portal e enviar ao cliente

### 5. Guard contra loop de prompt (prevenção)

- Quando `customer_flow_state.retries >= 3` E o `last_outbound_content_hash` é igual ao próximo a enviar → **parar de reenviar**, pausar bot por 10 min e abrir `bot_handoff_alerts` para consultor. Sem isso, qualquer falha futura dispara prompts infinitos como aconteceu agora.

### 6. Recuperar o lead 5511971254913 (one-shot, fora do código)

Migration única que:

1. Faz upload do `last_inbound_media_url` (base64) para MinIO usando `uploadMediaToMinio`.
2. Grava URL pública em `electricity_bill_photo_url`.
3. Reseta `customer_flow_state.retries = 0`, `status = 'idle'`.
4. Mantém `conversation_step` no UUID de capture_conta — o próximo inbound já vai disparar OCR pelo fix do item 1.
5. Atribui consultor via round-robin (`assigned_consultant_id` está NULL).

## Arquivos envolvidos

- `supabase/functions/whapi-webhook/handlers/bot-flow.ts` (handler principal — bridge mídia + avanço sequencial)
- `supabase/functions/evolution-webhook/handlers/bot-flow.ts` (espelho)
- `supabase/functions/_shared/pipeline-cadastro/registry.ts` (já classifica step_keys; adicionar UUIDs ou usar `step_type`)
- `supabase/functions/_shared/engine/dispatcher.ts` (registrar `delegated_legacy` em `engine_logs` para observabilidade)
- Migration única para recuperar o lead atual.

## O que NÃO está no escopo

- Mudar a estrutura de `bot_flow_steps` ou criar novos campos.
- Mexer no flow conversacional/IA.
- Pacote de dedupe por phone (Pacote 3 anterior) — confirmado desnecessário.

## Resultado esperado

- Cliente novo entra → "Oi" → bot pede conta → cliente manda foto → OCR roda → bot mostra dados extraídos com botões SIM/NÃO/EDITAR → SIM → bot pede documento → mesmo loop → email → confirma whatsapp → finalize-capture → OTP chega via Portal → cliente digita → link de assinatura enviado. Cinco passos, zero loop, zero retries silenciosos.

## Confirmação antes de aplicar

Aplico nesta ordem: (6) recupera o lead atual → (1)(2) bridge mídia + avanço sequencial → (3) confirm_phone → (4) finalizar_cadastro guard → (5) anti-loop. Confirma?
