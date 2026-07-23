---
inclusion: auto
name: projeto
description: Visão geral do monorepo iGreen (complementa product/tech/structure).
---

# Projeto — iGreen Official Portal

Sistema de captação, WhatsApp e cadastro de clientes de energia solar para consultores iGreen. Do anúncio Meta/CTWA até o cadastro no portal iGreen, CRM e pós-venda.

## Stack

- **Frontend:** React 18 + Vite + TypeScript + Tailwind + shadcn/Radix + TanStack Query + React Router
- **Backend:** Supabase (Postgres + RLS + ~209 Edge Functions Deno)
- **Workers VPS (Node):** `worker-portal-2/` (cadastro portal iGreen), `worker-club/` (Club), `worker-igreen-sync/` (sync Playwright)
- **WhatsApp primário:** Whapi (`whapi-webhook`, `instance_name=whapi-superadmin`). Evolution é legado/paralelo — `whatsapp_instances.needs_reconnect` ≠ Zap offline
- **Voz/SMS:** Velip (`voice-dialer-*`, `_shared/voice-dialer/`)
- **Ads:** Meta Marketing API + CAPI (`facebook-*`, `facebook-capi`)
- **Storage mídia:** MinIO (`upload-media`, `upload-documents-minio`)
- **IA:** Gemini/gateway em `_shared/ai-*`, Cérebro (`_shared/cerebro/`), simulador Fluxo B (`fluxo-b-ai`)

## Estrutura

| Path | Papel |
|---|---|
| `src/pages/` | Rotas: Admin, SuperAdmin, ConsultantPage, CRMLandingPage, FluxoBuilder, AdminMotorCadencia, AdminMetaAds, AdminVoz… |
| `src/components/{admin,whatsapp,captacao,superadmin,voz,wallet}/` | UI por domínio |
| `src/lib/` | Helpers canônicos (`crmVsLeadAnalysis`, `customerDisplayName`, `consultantPublicLabel`, phone, cadence) |
| `src/integrations/supabase/` | Client + `types.ts` gerado |
| `src/features/` | Módulos: onboarding, solar-3d, remote-support, produtos, help |
| `supabase/functions/<kebab>/index.ts` | Edge functions |
| `supabase/functions/_shared/` | bot/, cerebro/, channels/, daily-reheat/, voice-dialer/, fluxo-b-ia/, cadence-* |
| `supabase/migrations/` | Schema |
| `docs/` | Docs operacionais (portal-api, campanhas, etc.) |
| `.cursor/rules/` | Regras Cursor (espelhar espírito aqui) |

## Módulos principais

1. **Landing / QR / lead-intake** → cria/atualiza `customers` + conversa WhatsApp
2. **Bot / Cérebro / Fluxo B** → qualificação no chat (`whapi-webhook` → bot-flow / `responderComCerebro`)
3. **Cadência “Zero Lead Perdido”** → `cadence-tick` + `lead_cadence_state` (WA / SMS / voz / Meta audience)
4. **Portal iGreen** → `finalize-capture` → `dispatchPortalWorker` → worker-portal-2; OTP via `submit-otp` / `worker-callback`
5. **Club** → `finalize-club` → worker-club (separado do portal)
6. **CRM Kanban** → `crm_deals` / stages; não misturar com “lead em conversa”
7. **Meta Ads + rodízio** → `facebook_campaigns.id` (UUID) → `rodizio_pools` → `referral_partners`
8. **Reaquecimento** → `daily-reheat-cron` + `daily_reheat_*`
9. **Agenda humana** → `scheduled_messages` / `send-scheduled-messages` (sem quiet hours de bot)
10. **Carteira Ads** → `consultant_wallet` + Stripe (`wallet-*`)

## Integrações externas

- Supabase Auth + RLS; Edge secrets (`SERVICE_SHARED_SECRET`, Whapi, Velip, Meta)
- Portal iGreen HTTP (worker VPS) — doc: `worker-portal-2/PORTAL-OFICIAL.md`
- Club iGreen — `worker-club/CLUB-OFICIAL.md`
- Whapi Cloud API; Evolution API (consultores legado)
- Meta Graph (campanhas CTWA, Lead Ads webhook, CAPI)
- Velip (TTS call + SMS); ElevenLabs via `tts-proxy`
- ViaCEP / cobertura distribuidoras no portal worker

## Regras de ouro do produto

- Automações ligadas com cadeados; **não apagar** código/migrations/flags
- Kill switch: `app_settings.bot_global_enabled` (`_shared/bot/global-flag.ts`)
- WhatsApp = Whapi primeiro; não assustar com Evolution `needs_reconnect`
- Campanha/rodízio = UUID (`source_campaign_id`), não texto livre do Zap
- Idioma do projeto e respostas: **pt-BR**
