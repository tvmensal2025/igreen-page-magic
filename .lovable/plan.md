## Diagnóstico (lead 5511971254913, customer `95fcd3b0…`)

Reconstruí a conversa pelos logs do Whapi + `conversations` + estado do `customers`. O que aconteceu:

```text
20:47:19  "Oi"                        → d_welcome
20:47:27  clicou "Quero simular"     → d_escolher_simulacao
20:47:36  clicou "Simulação rápida"  → pede valor
20:47:53  digitou "800"              → SALVA electricity_bill_value = 800
20:48:02  bot mostra d_simular_resultado (R$ 64–160 economia)
20:48:07  clicou "Quero me cadastrar" → aguardando_conta (pede a foto)
20:48:44  ENVIOU A FOTO DA CONTA      → ignorada, OCR nunca rodou
20:49:06  cliente digitou "✅ SIM"
20:49:07  [resume] dispatcher quis aguardando_conta,
          resume aponta confirmando_dados_conta — usando confirmando_dados_conta
20:49:09  bot mostra d_resultado com o MESMO R$ 800 (sem OCR)
20:49:26  cliente clicou "Continuar Cadastro"
20:49:31  bot pediu RG/CNH (d_pedir_documento) — pulou OCR de fato
```

Estado final em `customers`: `electricity_bill_photo_url = NULL`, `bill_base64 = NULL`, `ocr_done = false`, `bill_holder_name = NULL`, `electricity_bill_value = 800` (do "rápida"), `bill_data_confirmed_at = 20:49:07`.

## Causa raiz

`supabase/functions/_shared/conversation-helpers.ts` — `hasBillData()` (linhas 392–401) trata `electricity_bill_value >= 30` **e** `media_consumo > 0` como prova de que já temos a conta. Esses dois campos são preenchidos pela **Simulação rápida** (valor digitado pelo cliente), não por uma fatura real.

Consequência: assim que o cliente passa por "rápida" e depois aceita cadastrar, o `resolveResumeStep` chamado em `bot-flow.ts:3110` (e demais sítios) acha que a conta já está coletada e devolve `confirmando_dados_conta`. A foto que chega depois entra em `aguardando_conta`, é re-roteada pelo guard de resume para `confirmando_dados_conta` antes do handler de mídia rodar OCR — então a imagem é descartada, o OCR não dispara, `bill_holder_name` fica vazio e o fluxo cai direto no documento usando o valor estimado.

Mesmo problema espelhado em `evolution-webhook/handlers/bot-flow.ts:2962`.

## Fix proposto (mínimo, cirúrgico, paridade whapi/evolution)

1. **`_shared/conversation-helpers.ts`**
   - `hasBillData(customer)` passa a exigir **fatura real**: `electricity_bill_photo_url` (≠ sentinel `evolution-media:pending`) **ou** `bill_base64` **ou** `numero_instalacao` com 7+ dígitos **ou** `ocr_done === true`.
   - Remover os ramos `electricity_bill_value >= 30` e `media_consumo > 0` — eles representam *estimativa do cliente*, não conta enviada. Adicionar comentário explicando o bug do 5511971254913.
   - Criar helper auxiliar `hasBillEstimateOnly(customer)` (retorna true se só temos `electricity_bill_value`/`media_consumo` sem foto) — útil para o ponto 3.

2. **`_shared/bot/resume-or-skip.ts`**
   - Trocar a checagem `hasBillPhoto = electricity_bill_photo_url` por `hasBillData(customer)` (já fica correto após o fix #1) para o gate de "lead avançado".

3. **`whapi-webhook/handlers/bot-flow.ts` e `evolution-webhook/handlers/bot-flow.ts`** (bloco "RESUME determinístico", ~linha 3104/2954)
   - Antes de aceitar o `resolveResumeStep`, se `step === "aguardando_conta"` **e** o input atual for mídia (image/document) **e** `hasBillData(customer) === false` (já estará false após fix #1), manter `aguardando_conta` para o OCR rodar. Defesa em profundidade caso o estado tenha sido populado por outro caminho legado.

4. **Backfill cirúrgico do lead 5511971254913** (apenas esta linha)
   - Resetar o customer ativo `95fcd3b0-ff80-4446-a66c-0277797ff147` para `conversation_step = 'aguardando_conta'`, limpar `bill_data_confirmed_at`, `electricity_bill_value`, `media_consumo` para que ele reenvie a foto e o fluxo D termine corretamente até o documento. Sem migração — `UPDATE` único via `supabase--read_query` não dá; usar `supabase.insert`/RPC seria over-kill, então faço via migration de um único UPDATE idempotente com WHERE id = '…'.

## Validação

- Build automático (já roda no harness).
- Teste unitário novo em `_shared/__tests__/has-bill-data.test.ts`: cobre (a) só `electricity_bill_value=800` → false, (b) `electricity_bill_photo_url` setado → true, (c) `bill_base64` setado → true, (d) sentinel `evolution-media:pending` → false.
- Teste unitário novo em `_shared/__tests__/resume-step.test.ts`: customer pós-rápida (value=800, sem foto) → `aguardando_conta`; com foto e sem `bill_data_confirmed_at` → `confirmando_dados_conta`.
- Re-rodar `reactivation-cron/index_test.ts` e demais testes Deno já existentes para garantir que nada que dependia do antigo `hasBillData` quebra (vou ajustar fixtures se precisarem).

## Fora de escopo

- Não mexer no motor V3, no `mirror-customer`, nem no portal2. Não tocar UI.
- Não alterar o fluxo de "Simulação rápida" em si (continua salvando `electricity_bill_value` — só deixa de ser tratado como conta enviada).

## Risco

Baixo. A mudança restringe `hasBillData` a evidências reais de fatura — o caminho normal (cliente envia a foto direto) continua igual; o caminho "rápida → cadastrar" deixa de pular o OCR. Reverter é trivial (1 commit, 1 helper).