# Decisões de produto — Bot, kill switch e retenção

Data: 13/07/2026  
Status: **aplicadas no código** (toggles de retenção continuam OFF até piloto)

---

## 1. Kill switch global (`bot_global_enabled`)

| Antes | Depois |
|---|---|
| OFF = webhook ignora tudo (lead some) | OFF = **para de falar**, **continua recebendo** |
| Sem aviso | Avisa o consultor responsável (`notifyInboundWhileBotOff`) |

Arquivos: `whapi-webhook`, `evolution-webhook`, `global-flag.ts`, `notify-consultant.ts`

---

## 2. Assumir lead / envio manual

| Antes | Depois |
|---|---|
| `manual-step-send` despausava o bot | **Não despausa** — só o botão Religar no chat |
| Aviso fraco | Banner no chat + notificação WhatsApp deixa claro: **Bot DESLIGADO** |

Arquivos: `manual-step-send/index.ts`, `ChatView.tsx`, `notifyClientReplyWhilePaused`

---

## 3. Retenção (ordem de piloto)

Ordem recomendada (**ainda NÃO ligada em produção**):

1. `bot_followup_checker` — checker 6h (mensagem simples)
2. `faq_reengagement_nudge` — nudge pós-FAQ 20min
3. `process_followups` — follow-up completo / Cérebro

Ligar **um por vez**, com 1 consultor piloto, depois validar.

---

## O que NÃO foi ligado

- Nenhum toggle de automação em massa
- Crons duplicados permanecem (decisão anterior: deixar até finalizar ajustes)
