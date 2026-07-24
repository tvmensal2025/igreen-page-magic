---
inclusion: always
name: tech
description: Stack e integrações preferidas.
---

# Tech — stack deste monorepo

## Frontend
React 18 + Vite 5 + TS 5.8 + React Router 6 + Tailwind 3 + shadcn/Radix + TanStack Query 5 + Zod + RHF. Testes: Vitest + Playwright. Sentry + PWA.

## Backend
Supabase (Postgres + RLS + Auth + ~210 Edge Functions Deno). Shared: `supabase/functions/_shared/`. Migrations: `supabase/migrations/` — não apagar.

## Workers VPS (Node ≠ Deno)
| Pasta | Papel |
|---|---|
| `worker-portal-2/` | Cadastro Portal 2 — `PORTAL-OFICIAL.md` |
| `worker-club/` | Club — `CLUB-OFICIAL.md` |
| `worker-igreen-sync/` | Sync carteira Playwright |
| `compress-worker/` | Compressão mídia |

## Integrações preferidas
- WA: **Whapi** (`channels/whapi.ts`); Evolution legado
- Voz/SMS: Velip; TTS `tts-proxy` (ElevenLabs)
- Ads: Meta Graph + CAPI + Lead Ads webhook
- Storage mídia: MinIO
- Ads pay: Stripe (`wallet-*`)
- IA: `_shared/ai-*` + Cérebro; simulador `fluxo-b-ai`

## Preferir
Helpers canônicos, `assertCronAuth`/`resolveCaller`, `buildCors`, gates `{ skipped }`, Whapi `AUTH`.

## NÃO introduzir sem pedido
Baileys/Twilio WA no lugar do Whapi; Portal 1; Prisma/Next/Nest/Redis “porque sim”; MUI/Ant; massa/motor novo sem cadeados.
