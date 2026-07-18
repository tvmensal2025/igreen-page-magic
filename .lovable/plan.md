# Diagnóstico do lead Francisca (5511971254913) — 18/07 01:48

## O que aconteceu (linha do tempo real)

1. 01:18 → 01:26 — Bot rodou fluxo A normal: nome → valor (R$ 800) → simulação → "Conhecer mais" → áudio 4a+4b + botões **Cadastrar / Falar com humano**.
2. **01:36:46** — `bot_paused=true`, motivo `humano_assumiu_whatsapp`, `bot_paused_until=null` (pausa permanente). Nada disso foi disparado pelo cliente — foi o webhook de outbound `fromMe` (o consultor mandou algo pelo celular ou um echo do próprio bot fora da janela de 30s).
3. **01:48:47** — cliente clicou **Cadastrar**. Mensagem entrou em `conversations` (inbound), mas o motor não rodou porque o gate `bot_paused` bloqueou. **Nenhum engine_log, nenhuma resposta, nenhum avanço para `a6_ask_bill_photo`.**
4. Estado atual: `assigned_human_id` = próprio consultor, `bot_paused=true`, sem timeout — vai ficar assim para sempre até alguém religar manualmente.

**Causa-raiz:** o takeover automático (evolution-webhook linha 498-511 + `auto-takeover.ts`) grava `bot_paused_until: null`. Não existe expiração, não existe retomada quando o cliente responde um botão do fluxo. Qualquer echo/manual fora da janela de 30s congela o lead.

Isso explica os relatos anteriores ("bot parou de responder", "não seguiu até portal/OTP/facial") — não é OCR, não é worker: é a pausa órfã.

---

## Correções (para "nunca falhar")

### 1. Retomar bot automaticamente quando o cliente clica um botão do fluxo
No motor (evolution-webhook + whapi-webhook, antes do gate `bot_paused`): se o inbound é `button_click` OU casa `trigger_phrases` do step atual, **religar** o bot (`bot_paused=false`, limpar `bot_paused_reason`) e processar. Cliente interagindo = fluxo tem que continuar.

### 2. Endurecer o gate de outbound `fromMe`
- Aumentar janela de "ignorar como bot recente" de 30s para 5 min (o áudio+texto+auto-publish do painel gera outbounds espaçados).
- Ignorar outbounds cujo `messageId` já está em `outbound_message_log` como enviado pela própria plataforma (não só o `evolution_message_id` — também matching por texto+timestamp curto).
- Só considerar takeover quando o outbound vier de um device diferente das instâncias gerenciadas do consultor.

### 3. Timeout de takeover
Popular `bot_paused_until = now + 24h` sempre que o motivo for `humano_assumiu_whatsapp` (echo/manual). Cron `bot-unpause-expired` já existe — só passa a limpar essas linhas. Motivos explícitos (`humano_assumiu` via clique no painel) continuam sem expiração.

### 4. Consertar o lead da Francisca agora
Rodar `undoTakeoverByPhone("5511971254913")` para o customer `8428419b…` e disparar `manual-step-send` do step `a6_ask_bill_photo` (`f21b3d40-…`) para o cliente receber o pedido de foto da conta e o fluxo retomar exatamente onde parou.

### 5. Painel de saúde no `/admin/checklist`
Card "Leads travados por takeover órfão": lista `customers` com `bot_paused=true AND bot_paused_reason='humano_assumiu_whatsapp' AND last_inbound_at > bot_paused_at`. Botão "Religar em massa".

---

## Arquivos afetados

- `supabase/functions/evolution-webhook/index.ts` (linhas 482-514) — janela + retomada por botão.
- `supabase/functions/whapi-webhook/index.ts` (linha 209 e gate equivalente) — mesma correção.
- `supabase/functions/_shared/engine/runner.ts` — antes do check de `bot_paused`, chamar `maybeResumeOnFlowInteraction(customer, inbound)`.
- `src/lib/whatsapp/auto-takeover.ts` — `applyPause` grava `bot_paused_until = now+24h` para reason `humano_assumiu_whatsapp` (só essa).
- `supabase/functions/bot-unpause-expired/index.ts` — cron já roda; garantir que trata esse motivo.
- `src/pages/AdminChecklist.tsx` — card de leads travados + botão de religar em massa.

## Aceite

- Reproduzir: pausar bot manual → cliente clica botão → bot religa e envia o próximo step do fluxo. **Passar.**
- Lead Francisca volta a receber `a6_ask_bill_photo` e completa até OTP/link facial.
- Nenhum lead fica com `bot_paused=true` + `bot_paused_until=null` para o motivo `humano_assumiu_whatsapp` por mais de 24 h.
