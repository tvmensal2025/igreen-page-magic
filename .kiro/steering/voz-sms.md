---
inclusion: fileMatch
name: voz-sms
description: Discador Velip, SMS e DNC voz.
fileMatchPattern:
  - "supabase/functions/voice-*/**"
  - "supabase/functions/_shared/voice-dialer/**"
  - "src/components/admin/voz/**"
  - "supabase/functions/cadence-tick/index.ts"
---

# Voz / SMS (Velip)

## Evidência prod (2026-07-24)
| Métrica | N |
|---|---|
| `voice_call_logs` | 685 |
| velip OK / NA / IK | 266 / 402 / **9** |
| `voice_sms_log` | 29 |
| `voice_campaigns` | 29 |
| `voice_dnc_list` | **26** (opt_out 12, requested 6, auto_nonexistent 4, auto_velip_ik 2, complaint 2) |

## Edges
| Edge | Papel |
|---|---|
| `voice-dialer-enqueue` | Enfileira campanha/alvo |
| `voice-dialer-cron` | Dispara fila |
| `voice-dialer-webhook` | Callback Velip + auto-DNC |
| `voice-sms-send` | SMS |
| `voice-call-stitch` / `voice-template-stitch` | Áudio personalizado |

Cadência reusa o dialer em stages `A_CALL*`, `CALL_*`, `*_SMS` via `cadence-tick`.

## Bloqueios (nunca contatar)
1. `customers.do_not_contact = true`
2. `voice_dnc_list` (fonte auto do webhook + guards)
3. Cross-channel em `cadence-tick` → `checkPhoneDeadForChannel` (`:594–627`, SMS gate `:777–788`):
   - Voz: status **IK / EK / CK / BK** (`_shared/voice-dialer/velip.ts:117`, `:534–547`)
   - SMS: ≥2 **UNDELIV|REJECTD|…** em 72h → upsert DNC (`voice-dialer-webhook` `:280–309`; `:384`/`:498` são auto-DNC de **voz**, não SMS)

TTS: `call-stitch.ts` + `safeFirstNameForAddress`; guard também em `cadence-tick:799`.

## NÃO FAÇA
- Discagem em massa nova sem pedido + cadeados
- Personalizar TTS com `whatsapp_profile` / slug
- Ignorar `voice_dnc_list` ou cross-channel IK/UNDELIV
- Assumir que kill `bot_global` é o único cadeado (cadence + toggles + DNC)
