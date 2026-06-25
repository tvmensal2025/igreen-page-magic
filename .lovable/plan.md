
## O que aconteceu na conversa do 5511971254913 (Cleuza Michelini)

Cliente entrou no **Cadastro Rápido** (Flow D, `aee7b26c-…`) e seguiu o caminho certo até a etapa do e-mail. Daí em diante:

```
13:14  Oi → Welcome → "⚡ Cadastro rápido"
13:14  Foto da conta enviada ✅  (OCR ok: CPFL, CEP 13350000, R ERMANO MARQUES, ELIAS FAUSTO/SP)
13:15  Confirma dados conta SIM ✅
13:15  Resultado + pede documento
13:15  Frente do RG ✅
13:16  Verso do RG ✅  + confirma dados doc SIM
13:17  "📱 Outro número" → bot pede telefone → cliente manda 19991846804
13:18  Bot pede e-mail → cliente manda michelinicleuza@gmail.com
13:18  ❌ Bot responde: "CEP inválido. Informe os 8 números"   ← BUG 1
13:19  Cliente digita 13354016
13:19  ❌ Bot dispara Flow B (b1a53333): "Você prefere simulação completa ou rápida?"  ← BUG 2
13:20  Cliente clica "Simulação completa"
13:20  ❌ Bot pede a foto da conta DE NOVO  ← BUG 3
13:21  Cliente reenvia foto → bot pede CEP de novo
13:22  "Cadastrar e finalizar"
13:25  Cliente reenvia telefone 19991846804  ← BUG 4 (perdeu o telefone)
13:25  portal_submitting ✅
13:29  OTP 329225 ✅ (finalmente)
```

Resultado: cadastro concluiu, mas levou 15 min com 4 perguntas desnecessárias. A regra do produto é: **conta → documento → telefone → e-mail → OTP/link**. Nada mais.

## Causas (no código)

### Bug 1 – "CEP inválido" depois do e-mail
- A conta OCR salvou `cep = 13350000` (terminado em `000`).
- `_shared/conversation-helpers.ts:89` força `ask_cep` quando o CEP termina em `000`, mesmo com rua/cidade/UF presentes.
- Em `whapi-webhook/handlers/bot-flow.ts` o `autoResolveCepIfNeeded` deveria silenciar isso (linhas 252-260, "🚫 NUNCA pedir CEP"), mas o caso B (reverse ViaCEP) e o silent fallback não estão sendo respeitados quando o lead vem do Flow D — o handler do `ask_email` acaba caindo no branch `ask_cep` e dispara o texto "❌ CEP inválido…".

### Bug 2 – Flow B disparado no meio do Flow D
- O input `13354016` foi tratado pelo flow-router como **keyword de entrada** do Flow B (a regex de "valor" / número grande captura CEP).
- Falta um guard "se o lead está no funil de cadastro (Flow D, etapa pós-`aguardando_facial`/pré-`portal_submitting`), NUNCA reiniciar outro fluxo público".

### Bug 3 – Pediu a foto da conta duas vezes
- Consequência do Bug 2: Flow B começou do zero (`d_pedir_conta`) ignorando que `electricity_bill_photo_url` já estava preenchido. Faltam guards de "skip-if-have" nos steps de coleta do Flow B (alguns existem em outros pontos via `shouldSkipAsk`, mas não no `d_pedir_conta`).

### Bug 4 – Telefone re-perguntado
- Em `ask_phone`/`ask_phone_confirm` o valor `19991846804` foi salvo em `phone_landline` mas `phone_contact_confirmed` não foi marcado, então o portal-submit pediu de novo. Precisa marcar `phone_contact_confirmed=true` quando o cliente confirma "outro número" + dígita.

## Mudanças propostas

Tudo em edge functions + helpers, sem mexer em UI. Espelhar no `evolution-webhook/handlers/bot-flow.ts` (mesmo handler duplicado).

### 1. `supabase/functions/_shared/conversation-helpers.ts`
- Aceitar CEP terminado em `000` quando `address_city`+`address_state`+`address_street` já estão preenchidos (OCR confiável). Linha 89 vira:
  ```ts
  if (c.cep && /000$/.test(...) && !(c.address_city && c.address_state && c.address_street)) return "ask_cep";
  ```
- Em modo Flow D ("cadastro rápido"), também relaxar `ask_complement`, `ask_distribuidora`, `ask_installation_number`, `ask_bill_value` — esses já vêm do OCR; se faltarem, **não bloqueiam**, vão para revisão do consultor (igual à regra do CEP).
- Adicionar parâmetro opcional `opts.flowVariant` em `getNextMissingStep` para esse curto-circuito (sem mudar o contrato para Flow B).

### 2. `supabase/functions/whapi-webhook/handlers/bot-flow.ts` (+ evolution-webhook gêmeo)
- Em `case "ask_email"` (linha ~5320): após salvar email, se `flow_variant === 'D'` e já tem `electricity_bill_photo_url` + `document_front_url` + `phone_contact_confirmed`, ir **direto** para `finalizando` (atalho que já existe parcialmente nas linhas 5370-5372, mas só dispara se `next === 'ask_finalizar'` — generalizar para qualquer step "address/dist/bill" que poderia ser auto-resolvido).
- `autoResolveCepIfNeeded`: quando o CEP é `XXXXX000` mas o restante do endereço está ok, **aceitar** e seguir, sem cair na re-pergunta.
- `case "ask_phone"`: ao gravar `phone_landline`, marcar `phone_contact_confirmed=true` (já que o cliente acabou de dizer "Outro número" e digitou).

### 3. Guard anti-reroteamento no flow router
Em `_shared/flow-router.ts` (e onde o webhook decide qual flow rodar):
- Antes de aplicar `flow_router_rules`, checar `customer.conversation_step`. Se estiver em `{aguardando_facial, portal_submitting, cadastro_em_analise, finalizando, ask_email, ask_phone, ask_phone_confirm, ask_number, ask_cep, ask_complement}` → **ignorar** triggers de Flow B/Flow D e continuar no handler determinístico do cadastro.
- Logar em `engine_logs` um motivo `skipped_router=in_cadastro_pipeline` pra auditoria.

### 4. Pequeno fix no `case "ask_phone"` (cadastro D)
Atualmente ele cai em `getReplyForStep(next)` mas perde a flag de confirmação. Após `updates.phone_landline = …` adicionar `updates.phone_contact_confirmed = true`. Assim o portal-submit não pede de novo às 13:25.

## Validação

1. **Replay no simulador**: rodar a skill `vendedora-e2e-conversations` (ou um script ad-hoc) com 1 conversa scripted reproduzindo o caminho da Cleuza (CEP 13350000) e confirmar que termina em `portal_submitting` sem passar por `ask_cep` nem por Flow B.
2. **Query SQL pós-deploy**: nos próximos 7 dias, alertar se algum lead com `flow_variant='D'` e `electricity_bill_photo_url IS NOT NULL` recebeu uma mensagem com "CEP inválido" — adicionar contador em `engine_logs`.
3. **Smoke**: enviar manualmente outra conta de teste cujo OCR retorne CEP 000 e confirmar fluxo até OTP.

## Não-objetivos

- Não vou refatorar o Flow B nem mexer no editor de fluxos.
- Não vou mudar regras de OCR (CEP 000 continua sendo gravado como tal; só não bloqueia mais).
- Não vou apagar/editar dados desse cliente — o cadastro já completou e tem OTP.

## Detalhes técnicos (para quem for revisar o PR)

- Arquivos: `_shared/conversation-helpers.ts`, `_shared/flow-router.ts`, `whapi-webhook/handlers/bot-flow.ts`, `evolution-webhook/handlers/bot-flow.ts`.
- Sem migração SQL.
- Deploy: as 4 funções afetadas são auto-deployadas via Lovable Cloud.
- Reverter: rollback do PR; nenhum efeito colateral persistente.
