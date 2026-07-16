# 05 — Mapa da arquitetura real

**Fonte primária:** código executável (`src/`, `supabase/functions/`, workers, migrations).  
**Data:** 2026-07-16  
**Modo:** somente leitura  

Documentação antiga em `docs/auditoria/` e README **não** substituem este mapa. Divergências serão listadas em `14-divergencias-documentacao-codigo.md`.

---

## 1. Visão geral em camadas

```mermaid
flowchart TB
  subgraph Clients
    Browser[Browser React/Vite PWA-lite]
    Landing[Landings públicas /:licenca]
    Meta[Meta Lead Ads / TikTok]
    WA_Evo[Evolution API]
    WA_Whapi[Whapi]
    Stripe[Stripe Webhooks]
    VoiceProv[Provedor de voz]
  end

  subgraph Frontend
    App[App.tsx Router]
    Admin[Painel /admin]
    Super[Super Admin]
    PublicPages[Proposta / Solar / Cadastro]
  end

  subgraph Supabase
    Auth[Auth JWT]
    DB[(PostgreSQL + RLS)]
    Storage[Storage / MinIO]
    EF[Edge Functions Deno ~196]
    Cron[pg_cron + net.http_post]
    RT[Realtime]
  end

  subgraph WorkersVPS
    WP2[worker-portal-2]
    WClub[worker-club]
    WSync[worker-igreen-sync]
    WComp[compress-worker]
  end

  Browser --> App
  Landing --> App
  App --> Auth
  App --> DB
  App --> EF
  App --> RT
  Meta --> EF
  WA_Evo --> EF
  WA_Whapi --> EF
  Stripe --> EF
  VoiceProv --> EF
  Cron --> EF
  EF --> DB
  EF --> Storage
  EF --> WP2
  EF --> WClub
  EF --> WA_Evo
  EF --> WA_Whapi
  WP2 --> DB
  WClub --> DB
  WSync --> DB
  WComp --> Storage
```

---

## 2. Bootstrap do frontend

| Peça | Arquivo | Papel real |
|---|---|---|
| Entry | `src/main.tsx` | Hardening, Sentry opcional, recovery de chunk/SW, version gate via `/version.json`, **não registra** Service Worker de cache |
| App shell | `src/App.tsx` | React Query, Theme, Router, lazy routes, CookieBanner, Wallet dialog, Remote Support, Tour |
| Supabase client | `src/integrations/supabase/client.ts` | URL + **anon key hardcoded** (esperado para anon); timeout 15s; sessão em `localStorage` |
| Auth guard | `src/components/auth/ProtectedRoute.tsx` | Só checa **existência de sessão** — não valida papel (role) no guard |
| Contextos | `ThemeContext`, `PrivacyModeContext` | Tema + modo privacidade no admin |
| Features | `features/solar-3d`, `remote-support`, `onboarding`, `produtos`, `help` | Módulos isolados por domínio |

**Kill switch global de bot (já no projeto):** `app_settings.bot_global_enabled` + UI Super Admin + helper `isBotGloballyEnabled` (regra de workspace).

**Gate de automações:** `automation_toggles` via `_shared/automation-gate.ts` — default **false** (fail closed no toggle).

**DNC:** `_shared/contact-suppression.ts` (`assertCanContact`) + campo `customers.do_not_contact` + `voice_dnc_list`.

---

## 3. Frontend → Supabase

```mermaid
sequenceDiagram
  participant UI as React UI
  participant QC as React Query
  participant SB as supabase-js (anon)
  participant RLS as Postgres RLS
  participant EF as Edge Function

  UI->>QC: useQuery / mutation
  QC->>SB: from/rpc/storage
  SB->>RLS: JWT do usuário
  RLS-->>SB: linhas filtradas
  UI->>EF: functions.invoke / fetch proxy
  EF->>RLS: service role OU user JWT
```

- Leituras/escritas diretas do browser passam por **RLS** (quando policy existe).
- Operações sensíveis (envio WA, OCR, Meta, voz, workers) tendem a ir para **Edge Functions**.
- Proxy de dev: `/functions-proxy` → projeto `zlzasfhcxcznaprrragl` (`vite.config.ts`).

---

## 4. Frontend → Edge Functions

Origens típicas (a detalhar por função na etapa 8):

| Origem UI | Exemplos de função |
|---|---|
| WhatsApp tab / manual send | `manual-step-send`, `start-customer-attendance`, `whapi-proxy`, `evolution-proxy` |
| Captação | `lead-intake`, `lead-research`, `leads-to-campaign`, `assign-lead-manual` |
| Meta Ads | `facebook-*`, `ad-creative-*`, `wallet-*` |
| Portal / Club | `finalize-capture`, `finalize-club`, `submit-otp`, `portal2-ai-audit` |
| Solar / Proposta | `solar-*`, `proposal-public-get`, `proposal-respond` |
| Voz | `voice-dialer-*`, `voice-sms-send` |

---

## 5. WhatsApp — dois caminhos ativos

```mermaid
flowchart LR
  subgraph Inbound
    EvoWH[evolution-webhook]
    WhapiWH[whapi-webhook]
  end
  subgraph Shared
    SharedAPI[evolution-api / whapi-api]
    Engine[_shared/engine v3]
    Bot[_shared/bot + bot-flow handlers]
    Gate[automation-gate + DNC + bot_paused]
  end
  subgraph Outbound
    Send[channel-sender / proxies]
  end

  EvoWH --> Bot
  WhapiWH --> Bot
  Bot --> Engine
  Bot --> Gate
  Gate --> Send
  Send --> SharedAPI
```

Evidência de duplicação estrutural:

- `supabase/functions/evolution-webhook/handlers/bot-flow.ts` (~6.290 linhas)
- `supabase/functions/whapi-webhook/handlers/bot-flow.ts` (~6.590 linhas)

Ambos com `verify_jwt = false` no `config.toml` (webhooks de provedor).

---

## 6. Lead → rodízio → consultor

```mermaid
flowchart TD
  In[lead-intake / meta-leadads / tiktok / research / landing]
  Cap[captured_leads + origem]
  Pool[pool de parceiros / rodízio]
  Assign[assign / RPC / locks]
  Cust[customers + consultant_id]
  Notify[notify-partner-leads-batch / WA]
  Attend[atendimento manual ou bot]

  In --> Cap --> Pool --> Assign --> Cust --> Notify --> Attend
```

Código frontend de seleção circular: `src/lib/rodizio/` (com testes property/unit).  
Atribuição server-side: edge functions + SQL (etapa 10 aprofundará).

---

## 7. Captação → Portal 2 / iGreen Club

```mermaid
flowchart TD
  Cap[Captação / OCR / documentos]
  FinCap[finalize-capture]
  FinClub[finalize-club]
  Q1[Fila BullMQ Portal 2]
  Q2[Fila BullMQ Club]
  WP2[worker-portal-2 Playwright+HMAC]
  WC[worker-club Playwright+JWT]
  Portal[Portal iGreen / autoconexao]
  Club[iGreen Club]
  CB[worker-callback / OTP watchdogs]

  Cap --> FinCap --> Q1 --> WP2 --> Portal
  Cap --> FinClub --> Q2 --> WC --> Club
  WP2 --> CB
  WC --> CB
```

Isolamento pretendido: pastas, docs e entrypoints separados. **Comprovação de não-interferência** (Redis keys, tabelas, secrets) fica para etapa 12.

`worker-igreen-sync` é caminho legado (Tor/2captcha/VOffice) paralelo — não confundir com Portal 2.

---

## 8. Meta Ads → campanha → métricas → carteira

```mermaid
flowchart LR
  OAuth[facebook-oauth-start/callback]
  Create[facebook-create-campaign]
  Sync[facebook-sync-metrics]
  Health[facebook-campaign-healthcheck / auto-pause]
  Wallet[wallet-create-topup / stripe-webhook]
  CAPI[facebook-capi]

  OAuth --> Create --> Sync --> Health
  Create --> Wallet
  Sync --> CAPI
```

Muitas funções Meta com `verify_jwt = false` (crons/health) — autenticação interna a auditar.

---

## 9. Voz

```mermaid
flowchart LR
  UI[Admin VozTab]
  Enq[voice-dialer-enqueue]
  Cron[voice-dialer-cron]
  Prov[Provedor telefonia]
  WH[voice-dialer-webhook]
  DNC[contact-suppression + voice_dnc_list]
  CRM[customers / call logs]

  UI --> Enq --> Cron --> DNC --> Prov
  Prov --> WH --> CRM
```

---

## 10. Proposta pública e Solar 3D

```mermaid
flowchart TD
  Token["/proposta/:token"]
  Get[proposal-public-get]
  Resp[proposal-respond]
  SolarUI["/admin/solar-design"]
  Geo[solar-geocode]
  Roof[solar-roof-*]
  Design[solar-design-get/public]

  Token --> Get
  Token --> Resp
  SolarUI --> Geo --> Roof --> Design
```

Tokens públicos autenticam o recurso (não JWT de usuário). `verify_jwt = false` documentado no config.

---

## 11. Agendamentos / cadência / follow-ups

Processadores observados no inventário de funções (nomes):

| Tipo | Edge / mecanismo |
|---|---|
| Mensagens agendadas | `send-scheduled-messages`, `bulk-scheduler` |
| Follow-up bot | `bot-followup-checker`, `process-followups` |
| Cadência | `cadence-tick`, motor em `_shared` |
| Reaquecimento | `daily-reheat-cron`, `reactivation-cron` |
| Watchdogs | `bot-loop-watchdog`, `bot-stuck-recovery`, `flow-d-stuck-watchdog`, OTP watchdogs |
| Fechamento | `close-attendance-scheduled` |
| Toggle | `automation_toggles` + UI Central de Agendamentos |

UI central: `/admin/agendamentos-central` + aba `agendamentos` no Admin.

---

## 12. Autenticação → perfil → papel → acesso

```mermaid
flowchart TD
  Login["/auth"]
  Sess[Supabase Auth session]
  PR[ProtectedRoute: sessão?]
  Role[useUserRole / profiles / roles]
  Admin["/admin *"]
  SA["/super-admin *"]
  Public[Rotas públicas]

  Login --> Sess --> PR
  PR -->|sim| Admin
  PR -->|sim| SA
  Role --> Admin
  Role --> SA
  Public --> Landing
```

**Risco estrutural a confirmar na etapa segurança:** `ProtectedRoute` não diferencia consultor vs super-admin — a autorização fina depende das páginas + RLS. Página `/assistente` **não** está sob `ProtectedRoute` em `App.tsx` (linha ~141).

---

## 13. Workers — filas, locks, retries (esqueleto)

| Worker | Entrypoint | Fila | Browser | Auth típica |
|---|---|---|---|---|
| portal-2 | `server.mjs` | BullMQ | Playwright | WORKER_SECRET / HMAC |
| club | `server.mjs` | BullMQ | Playwright | JWT Club + secret |
| igreen-sync | `server.mjs` | próprio | Playwright+Tor | legado |
| compress | `server.js` | HTTP sync | — | MinIO |

Detalhamento de locks/DLQ/heartbeat: etapa 12.

---

## 14. Pastas pedidas — status

| Pasta | Status |
|---|---|
| `src/App.tsx`, `src/main.tsx` | Presentes |
| `src/pages`, `components`, `hooks`, `contexts`, `services`, `lib`, `features`, `integrations` | Presentes |
| `supabase/functions`, `migrations` | Presentes |
| `worker-portal-2`, `worker-club`, `worker-igreen-sync`, `compress-worker` | Presentes |
| `scripts`, `.github/workflows` | Presentes |
| `docker-compose` | **Ausente** |

---

## 15. Escala que o mapa precisa carregar

- ~3.330 funções frontend + ~2.188 backend + 274 workers
- 196 edge function dirs / 71 no config.toml
- 722 migrations / ~180 funções SQL únicas / 72 cron names

Próximo documento: rotas e abas administrativas com validação página-a-página.
