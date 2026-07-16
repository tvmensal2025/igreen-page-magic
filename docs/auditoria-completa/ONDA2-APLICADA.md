# Onda 2 — correções aplicadas

**Data:** 2026-07-16  
**Escopo:** AUD-005 (parcial), AUD-007 (flag), rate limit `lead-intake`

---

## O que foi feito

| Tema | Arquivo(s) | Mudança |
|---|---|---|
| DNC central | `_shared/contact-suppression.ts` | Lookup por telefone quando não há `customerId` |
| DNC | `resend-portal-link` | `assertCanContact` antes do envio |
| DNC | `admin-send-material` | `assertCanContact` por phone+consultant |
| DNC | `outbound-media-flush-cron` | Skip + marca `succeeded_at` se DNC |
| DNC / privacidade | `notify-partner-leads-batch` | Skip lead com `do_not_contact` (não vaza PII ao parceiro) |
| DNC voz | `voice-dialer-cron` | `assertCanContact` channel=voice antes de discar |
| AUD-007 | `evolution-webhook`, `whapi-webhook`, `webhook-auth.ts` | 401 só se `ENFORCE_WEBHOOK_ORIGIN=true` |
| Abuse | `lead-intake` | Rate limit IP (20/min) + phone (5/10min) via `try_acquire_rate_limit` (fail-open se RPC falhar) |

## Não feito (propositadamente)

- AUD-006 (unificar bot-flow Evo/Whapi)
- `ENFORCE_WEBHOOK_ORIGIN=true` em produção (precisa secret na URL/header do provedor primeiro)
- Deploy das edge functions

## Deploy / ops

1. Deploy EFs: `resend-portal-link`, `admin-send-material`, `outbound-media-flush-cron`, `notify-partner-leads-batch`, `voice-dialer-cron`, `evolution-webhook`, `whapi-webhook`, `lead-intake` (+ shared bundled)
2. **Não** setar `ENFORCE_WEBHOOK_ORIGIN=true` até Whapi/Evolution enviarem o secret
3. Depois: configurar `?secret=` / header → aí sim enforce

## Impacto possível

- Material / reenvio de link / mídia pendente / discagem param para leads DNC (desejado)
- Parceiro deixa de receber notificação de lead DNC
- Landing pode retornar 429 sob flood
- Com enforce OFF, webhooks seguem iguais à Onda 1 (grace)
