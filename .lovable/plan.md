# Problema

Quando o consultor clica em **"Eu confirmo"** nos cards de revisão (conta e documento), o sistema:
1. Dispara `dispatchPostBillConfirm()` que **envia mensagem de simulação no WhatsApp do cliente** e despacha o próximo capture step.
2. Visualmente o card some/muda mas não fica nítido o "✓ Confirmado com sucesso".

O usuário quer: **quando o consultor confirma, é confirmação interna — não pode mandar nada pro WhatsApp do cliente**. O fluxo do WhatsApp só deve avançar quando for o próprio cliente quem confirma (via botão "Pedir cliente").

## Arquivos afetados

- `src/components/captacao/OcrReviewCard.tsx` — função `confirmSelf` (linhas 105–138)
- `src/components/captacao/CaptureDataConfirmCard.tsx` — função `confirmSelf` (linhas 71–99)

## Mudanças

### 1. `OcrReviewCard.tsx` → `confirmSelf`
- **Remover** a chamada a `dispatchPostBillConfirm({ customer, kind, continueFlowOnNextCapture: true })`.
- Manter o UPDATE no banco (`bill_data_confirmed_at` / `doc_data_confirmed_at` + `*_confirmation_by = "consultant"` + limpa `ocr_review_pending`).
- Atualizar toast: **"✓ Dados confirmados"** / **"Salvo — bot não foi acionado"** (sem o texto "Bot avançando…").
- Remover import de `dispatchPostBillConfirm` se ficar sem uso.

### 2. `CaptureDataConfirmCard.tsx` → `confirmSelf`
- **Remover** a chamada a `dispatchPostBillConfirm(...)` (linhas 87–91).
- Manter UPDATE no banco igual ao acima.
- Atualizar toast: **"✓ Confirmado"** / **"Dados salvos — sem envio ao cliente"**.
- Após confirmar, o card já mostra o badge ✓ (linha 149) e esconde os botões (linha 197), comportamento atual já correto. Vou só reforçar o visual do badge: aumentar pra `text-[10px]` + texto **"Confirmado ✓"** em vez de só ✓, com fundo emerald mais sólido.

### 3. Botão "Pedir cliente" (`askClient`)
- **Não mexer.** Continua despachando `manual-step-send` para o cliente confirmar via WhatsApp — esse é o único caminho que pode mandar mensagem.

## O que NÃO muda

- Lógica do bot/edge functions (`postBillConfirm.ts`, `manual-step-send`, `whapi-proxy`) permanece igual — o helper continua existindo, só não é chamado na confirmação interna do consultor.
- Fluxo do cliente confirmando no WhatsApp (que dispara simulação + próximo step) **continua funcionando normalmente**.
- Validação 18/18, botão CADASTRAR, PortalStatusTracker — nada disso muda.

## Resultado esperado

- Consultor clica "Eu confirmo" → card vira verde com "Confirmado ✓", **zero mensagens** no WhatsApp do cliente, `bill_data_confirmed_at` / `doc_data_confirmed_at` preenchido.
- Consultor clica "Pedir cliente" → mensagem com botões SIM/NÃO/EDITAR vai pro WhatsApp (comportamento atual mantido).
