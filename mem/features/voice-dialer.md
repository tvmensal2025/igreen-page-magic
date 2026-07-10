---
name: Voice Dialer (ligação PSTN Velip)
description: Módulo isolado Admin → Ligação — discagem via Velip com áudio pré‑gravado, callbacks assinados por token e retry para não atendidas
type: feature
---

# Voice Dialer — Ligação PSTN (Velip)

Rota: `/admin?tab=voz` (sidebar → **Ligação**).

Módulo **isolado** do WhatsApp/bot (Evolution, Whapi, vendedora, Cérebro).
Nada aqui altera webhooks de chat.

## Fluxo

1. Consultor grava/envia áudio (~20s), UI converte para **MP3**.
2. Front chama `voice-dialer-enqueue` (JWT) → cria `voice_campaigns` + `voice_campaign_targets`.
3. Modo:
   - `single`: `voice-dialer-cron` (pg_cron 5 min) dispara `PlayAudioFile` alvo por alvo.
   - `batch`: cria `CreateDestinationBase` + `CreateCampaign` na Velip; a Velip orquestra.
4. Velip envia callback → `voice-dialer-webhook` (auth por `?auth=<VELIP_WEBHOOK_AUTH>`).
5. Status Velip → interno; retry só p/ `NA` (Não Atendeu) até `max_attempts`.

## Stack

| Peça | Detalhe |
|------|---------|
| Tabelas | `voice_audio_clips`, `voice_campaigns`, `voice_campaign_targets`, `voice_call_logs`, `voice_template_renders` |
| Edges | `voice-dialer-enqueue` (JWT), `voice-dialer-cron` (5min, header próprio), `voice-dialer-webhook` (público c/ token), `voice-dialer-health` (público), `voice-campaign-control` (JWT), `voice-template-stitch` (upload lazy para Velip) |
| Shared | `supabase/functions/_shared/voice-dialer/velip.ts` |
| UI | `src/components/admin/voz/*` (VozTab · VelipHealthBanner · VoiceDialerPanel · VoiceCallHistoryPanel) |

## Secrets

Preencher em Supabase → Project Settings → Edge Functions → Secrets:

```bash
# Bearer da conta Velip (painel Velip → Integrações → API)
VELIP_API_TOKEN=

# String aleatória forte (32+ chars) usada como ?auth= dos callbacks
# Gerar: openssl rand -hex 32 → colar aqui e no painel Velip (URL de retorno)
VELIP_WEBHOOK_AUTH=

# OPCIONAL: BINA padrão E.164 (55DDNNNNNNNN)
VELIP_CALLER_ID=

# Já existentes no projeto
VOICE_DIALER_CRON_SECRET=
SERVICE_SHARED_SECRET=
```

URL do callback a colar no painel Velip → Integrações → URLs para Retorno:

```
https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/voice-dialer-webhook?auth=<VELIP_WEBHOOK_AUTH>
```

## Mapa de status Velip → interno

| Velip `cd_called_status` | Interno | Retry? |
|--------------------------|---------|--------|
| `OK` | `completed` | não |
| `NA` | `no_answer` | **sim** (até `max_attempts`) |
| `EK` | `failed` (número inválido) | não |
| `CK` | `failed` (bloqueio operadora) | não |
| `BK` | `failed` (não perturbe) | não |
| `IK` | `failed` (inexistente) | não |

## Ligação individual (test_call)

`voice-dialer-enqueue` com `action: "test_call"`, `test_phone`, `audio_clip_id`.
Cria campanha efêmera + 1 target + `PlayAudioFile` imediato.

## Reconciliação

Cron reconcilia targets em `dialing` há > 10 min sem callback via `GetCallStatus`.
Idempotente — chama sempre que passar.

## Segurança

- `voice-dialer-webhook`: `?auth=` obrigatório; soft‑check dos IPs Velip (`35.232.103.91`, `35.184.30.236`).
- `voice-dialer-cron`: `x-voice-dialer-cron-secret` **ou** service_role **ou** `x-service-secret`.
- `voice-dialer-enqueue` e `voice-campaign-control`: JWT do consultor via `resolveCaller`.
- Contadores recontados a partir dos targets (idempotente).
- Claim atômico `queued → dialing` antes de chamar Velip.

## Deploy

```bash
# Migrations já aplicadas.
supabase functions deploy voice-dialer-enqueue voice-dialer-cron \
                          voice-dialer-webhook voice-dialer-health \
                          voice-campaign-control voice-template-stitch
```

`config.toml`: `voice-dialer-cron`, `voice-dialer-webhook` e `voice-dialer-health` com `verify_jwt = false`.

## Custos

Cobrança 100% pelo saldo da conta Velip (mostrado no banner). Ver painel Velip.

## Legado Twilio

O driver `supabase/functions/_shared/voice-dialer/twilio.ts` foi mantido apenas
como referência histórica. Não é mais chamado por nenhuma edge.
