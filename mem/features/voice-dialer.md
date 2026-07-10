---
name: Voice Dialer (ligação PSTN Twilio)
description: Módulo isolado Admin → Ligação — discagem com número da empresa via Twilio
type: feature
---

# Voice Dialer — Ligação PSTN (Twilio)

Rota: `/admin?tab=voz` (sidebar → **Ligação**).

Módulo **isolado** do WhatsApp/bot (Evolution, Whapi, vendedora). Não altera webhooks de chat.

## O que faz

- Consultor grava/envia áudio (~20s) em **MP3/WAV**
- Dispara ligação real (PSTN) com Caller ID da empresa (`TWILIO_FROM_NUMBER`)
- Ao atender: toca o áudio e desliga
- Caixa postal / máquina: **não** deixa recado (AMD + hangup)
- Histórico por chamada em `voice_call_logs`

## Stack

| Peça | Detalhe |
|------|---------|
| Tabelas | `voice_audio_clips`, `voice_campaigns`, `voice_campaign_targets`, `voice_call_logs` |
| Edges | `voice-dialer-enqueue` (JWT), `voice-dialer-cron` (pg_cron 5min), `voice-dialer-webhook` (TwiML + status + AMD) |
| Shared | `supabase/functions/_shared/voice-dialer/twilio.ts` |
| UI | `src/components/admin/voz/*` |

## Secrets (obrigatórios)

Supabase Dashboard → **Project Settings → Edge Functions → Secrets** (ou CLI `supabase secrets set`):

```bash
# Conta Twilio (Console → Account → API keys / Auth Token)
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx

# Número da EMPRESA em E.164 (Buy a number → Voice enabled)
# BR: preferir 0303 / número local com Voice. Ex: +5511...
TWILIO_FROM_NUMBER=+55XXXXXXXXXXX

# Token aleatório para ?auth= nas URLs de callback (OBRIGATÓRIO)
# Gerar: openssl rand -hex 32
TWILIO_WEBHOOK_AUTH=

# Secret do pg_cron (header x-voice-dialer-cron-secret) — NÃO usar anon key
VOICE_DIALER_CRON_SECRET=

# Já deve existir no projeto (chamadas internas)
SERVICE_SHARED_SECRET=
```

Também documentados em `supabase/functions/.env.example`.

### Checklist Twilio (conta nova)

1. Criar conta Twilio e verificar e-mail
2. Comprar número com **Voice** (ideal BR 0303 para massa)
3. Copiar **Account SID** + **Auth Token**
4. Gerar `TWILIO_WEBHOOK_AUTH` (`openssl rand -hex 32`)
5. Colar os 4 secrets no Supabase
6. Rodar migrations + deploy das 3 edges (abaixo)
7. No Admin → Ligação: gravar clipe → **Ligar teste** no seu celular

## Segurança

- Webhook: exige `?auth=TWILIO_WEBHOOK_AUTH`; com `TWILIO_AUTH_TOKEN` setado, valida **X-Twilio-Signature** (hard-fail)
- Cron: exige `x-service-secret`, `Authorization: Bearer <service_role>` **ou** `apikey` anon (padrão dos pg_cron deste projeto)
- Contadores de campanha: recount a partir dos targets (idempotente)
- Claim atômico `queued → dialing` antes de criar a Call na Twilio

## Deploy

```bash
# 1) Migrations (tabelas + cron)
supabase db push
# ou aplicar: 20260710000000_voice_dialer_module.sql
#             20260710010000_voice_dialer_cron_auth.sql

# 2) Secrets
supabase secrets set \
  TWILIO_ACCOUNT_SID=ACxxx \
  TWILIO_AUTH_TOKEN=xxx \
  TWILIO_FROM_NUMBER=+55... \
  TWILIO_WEBHOOK_AUTH=$(openssl rand -hex 32)

# 3) Edges (já deployadas no projeto IGREEN; re-deploy se mudar código)
supabase functions deploy voice-dialer-enqueue
supabase functions deploy voice-dialer-cron --no-verify-jwt
supabase functions deploy voice-dialer-webhook --no-verify-jwt
# ou: ./scripts/deploy-voice-dialer.sh
```

`config.toml`: `voice-dialer-cron` e `voice-dialer-webhook` com `verify_jwt = false` (auth no código).

## Áudio

- Upload/gravação na UI converte para **MP3** (Twilio `<Play>` não é confiável com OGG Opus)
- Preferir ~15–25s; `TimeLimit` da call ≈ 40s

## Custos (referência Twilio BR)

- Outbound celular: ~US$ 0,066/min
- Número: ~US$ 4–15/mês
- 20s atendido ≈ 1 min cobrado

## Fora de escopo

Wallet, Caller ID pessoal, WhatsApp “chamada falsa”, vendedora/Cérebro, gravação da conversa do cliente.
