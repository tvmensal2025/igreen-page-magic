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

TTS: `call-stitch.ts` + `safeFirstNameForAddress`; intro canônica **“Olá, Nome! Tudo bem?”** (`buildOlaTudoBemTtsText`) — reusa `intro:ola:ptbr4:{nome}` / `intro:ola:{nome}` **público** (`is_public=true`, helper `_shared/ai-media-shared-intro.ts`) antes de ElevenLabs. Peças costuradas usam **sempre** `SOFIA_STITCH_PROFILE` + `VOICE_SETTINGS_V3_GREET` (mesma voz/speed) — Zap, ligação e pós-venda. Tag cache: `ci_v3_ola_tudobem_v2`. Guard também em `cadence-tick:799`.

## Crédito Velip (conta da plataforma)
- `GetUserID` **não** retorna saldo (API v2). UI mostra “—” / oriente painel.
- **Não existe** pause automática por crédito Velip zerado no código.
- Erros vistos em prod: `Blocked text#270`, `BK_PROCON#250`, `number invalid#203`, delivery `UNDELIV`/`REJECTD`/`EXPIRED`.
- Aceito (`sms_sent` / `status=sent`) ≠ entregue (`DELIVRD`). Playbook completo: `#erros-operacionais`.

## Cobrança ao consultor (iGreen Fone — mesma carteira Ads)
- SMS: R$ 0,10 por `status=sent` — `debitSmsSent` (`_shared/voice-sms-billing.ts`)
- Ligação: R$ 0,10 a cada 30s **atendida** (ceil) — webhook `OK` → `debitVoiceAnswered`
- Idempotente: `platform_usage_billing` + RPC `debit_platform_usage_observation`
- Welcome: novo consultor R$ 1,00 via `ensure_consultant_wallet`
- Saldo zerado → `notifyConsultant` (cooldown 24h) · recarga via admin
- UI: botão `!` na pizza (`CadenceCostHelpModal`) — cada msg A/B/C + preços
- Marca ao consultor: **iGreen Fone** (nunca “Velip” na copy)

## NÃO FAÇA
- Discagem em massa nova sem pedido + cadeados
- Cobrar ligação em `cadence_action_log sent` (é discagem, não atendimento)
- Cobrar SMS de novo no DELIVRD (já cobrou no sent)
- Expor nome Velip na UI do consultor
- Personalizar TTS com `whatsapp_profile` / slug
- Ignorar `voice_dnc_list` ou cross-channel IK/UNDELIV
- Assumir que kill `bot_global` é o único cadeado (cadence + toggles + DNC)
- Assumir que saldo Velip está no banco / que o motor pausa sem crédito
