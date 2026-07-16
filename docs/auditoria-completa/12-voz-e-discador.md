# 12 — Voz e discador (Velip)

**Data:** 2026-07-16  
**Escopo:** voice dialer, SMS de voz, DNC, webhooks Velip  
**Onda 2:** `assertCanContact` já aplicado em `voice-dialer-cron` antes do dial.

---

## 1. Superfície

### Edge Functions

| EF | Papel | Auth |
|---|---|---|
| `voice-dialer-cron` | Disca fila (`queued` → Velip) + reconcilia `dialing` stale | Cron secret / service secret / service_role |
| `voice-dialer-enqueue` | Monta campanha + targets | JWT consultor (esperado) |
| `voice-dialer-webhook` | Callback status Velip | `VELIP_WEBHOOK_AUTH` fail-closed se ausente |
| `voice-sms-send` | SMS (canal voz) | Auth + DNC |
| `voice-campaign-control` | pause/resume/finish | JWT |
| `voice-contact-base` | bases de contato | JWT |
| `voice-dashboard-metrics` | métricas | JWT |
| `voice-dialer-health` | health | — |
| `voice-template-stitch` | templates áudio | JWT |
| `_shared/voice-dialer/velip.ts` | API Velip | secrets env |
| `_shared/voice-dialer/twilio.ts` | legado/alternativo | — |

### Frontend

`src/components/whatsapp/voice/*` — templates, clips, picker, names library.

### Tabelas (migration `20260710000000_voice_dialer_module.sql` + follow-ups)

- `voice_campaigns`, `voice_campaign_targets`, `voice_call_logs`
- `voice_dnc_list` (consultant_id + phone)
- settings / secrets para cron header

---

## 2. Fluxo

```
UI enqueue → voice-dialer-enqueue
  → filtra voice_dnc_list + customers.do_not_contact
  → targets status=queued
pg_cron */5 → voice-dialer-cron (auth)
  → assertCanContact(channel=voice)  [Onda 2]
  → playAudioFile / makeTTSCall
Velip callback → voice-dialer-webhook
  → atualiza target; pode upsert voice_dnc_list (opt-out)
```

---

## 3. DNC — cobertura

| Ponto | DNC |
|---|---|
| Enqueue | Sim — `voice_dnc_list` + `do_not_contact` |
| Cron (dial) | Sim — `assertCanContact` (Onda 2) |
| SMS send | Sim — lista + `do_not_contact` |
| Webhook | Escreve DNC em cenários de opt-out; não disca |

**Gap residual:** enqueue e SMS usam queries diretas, não o helper único `assertCanContact` (comportamento alinhado, mas divergência futura possível — AUD-005).

---

## 4. Achados

### AUD-014 — Auth do cron de voz depende de settings/secret alinhados ao pg_cron

**Prioridade:** P2  
**Situação:** Confirmado (desenho)  

Migrations sucessivas (`voice_dialer_cron_auth`, `_secret`, `_secret_from_settings`) mostram churn para não deixar o cron 401. Se settings e env divergirem, discagem para (seguro) ou, em misconfig antiga, risco de auth fraca.

**Verificar em prod:** header do job `voice-dialer-tick` vs `VOICE_DIALER_CRON_SECRET` / `SERVICE_SHARED_SECRET`.

### Positivo

- Webhook Velip: sem `VELIP_WEBHOOK_AUTH` configurado → não processa (fail-closed explícito no cron também checa `velipWebhookAuthConfigured`).
- Janela comercial (`inCallWindow`) no cron.
- Reconciliação de targets travados em `dialing`.

---

## 5. Riscos residuais (não P0)

- Twilio shared ainda no repo: confirmar se morto ou fallback.
- Targets sem `customer_id`: DNC por phone+consultant (OK com Onda 2).
- Custo Velip se cron for abusado — mitigado por auth fail-closed.
