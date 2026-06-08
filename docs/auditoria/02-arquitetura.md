# 02 — Arquitetura do Sistema

> Última atualização: 08/06/2026

---

## Diagrama Geral

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USUÁRIOS                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  Consultor  │  Super Admin  │  Lead (público)  │  Cliente (WhatsApp)    │
└──────┬──────┴───────┬───────┴─────────┬────────┴───────────┬───────────┘
       │              │                  │                    │
       ▼              ▼                  ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      FRONTEND (React + Vite)                             │
├─────────────────────────────────────────────────────────────────────────┤
│  /admin      → Dashboard, CRM, WhatsApp, Fluxos, Ads, Materiais        │
│  /super-admin → Controle global, A/B tests, saúde da IA                 │
│  /:licenca   → Página pública do consultor                              │
│  /cadastro   → Página de cadastro pública                               │
│  /crm        → Landing CRM (marketing)                                  │
│  /auth       → Login/Cadastro                                            │
└──────┬──────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    SUPABASE (PostgreSQL + Auth + Edge Functions)          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐     │
│  │   Auth (GoTrue)   │  │   PostgREST      │  │  Edge Functions   │     │
│  │   Login/JWT       │  │   RLS + Policies │  │  (120+ Deno)      │     │
│  └──────────────────┘  └──────────────────┘  └───────────────────┘     │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    PostgreSQL (280+ tables)                        │   │
│  │  consultants, customers, conversations, bot_flow_steps,           │   │
│  │  whatsapp_instances, deals, scheduled_messages,                   │   │
│  │  facebook_campaigns, wallet_transactions, ai_knowledge_sections,  │   │
│  │  outbound_message_log, webhook_message_dedup, ...                 │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    Storage (S3-compatible)                         │   │
│  │  consultant-photos, media, documents                              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└──────┬──────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       INTEGRAÇÕES EXTERNAS                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────────┐     │
│  │ Evolution   │  │    Whapi     │  │  Gemini  │  │  Facebook    │     │
│  │ (WhatsApp)  │  │ (WhatsApp)  │  │  (IA)    │  │  (Meta Ads)  │     │
│  └─────────────┘  └─────────────┘  └──────────┘  └──────────────┘     │
│                                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────────┐     │
│  │   MinIO     │  │   Portal    │  │  OpenAI  │  │   Sentry     │     │
│  │   (mídia)   │  │  Workers    │  │  (IA)    │  │  (erros)     │     │
│  └─────────────┘  └─────────────┘  └──────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Fluxo de Login

```
Usuário → /auth → Supabase Auth (email+senha) → JWT gerado
  → Redirect para /admin
  → useAdminAuth carrega consultant
  → Se não existe → auto-cria registro pendente (approved=false)
  → Se approved=false → mostra modal de "pendente"
  → Se approved=true → carrega dashboard completo
```

---

## Fluxo de Lead (público)

```
Lead clica link do consultor → /:licenca (ConsultantPage)
  → Formulário multi-step (CEP, valor conta, CPF, WhatsApp, email, endereço)
  → Cada step salva parcialmente no Supabase (customers)
  → Final: dispara webhook para cadastro no portal iGreen
  → Worker Playwright preenche o formulário real do portal
  → Retorna status → atualiza customer
```

---

## Fluxo de WhatsApp (Bot Automático)

```
Cliente envia mensagem no WhatsApp
  → Evolution API recebe
  → Webhook → supabase/functions/evolution-webhook/
  → Deduplicação (idempotency key)
  → Rate limiting (webhook_rate_limit)
  → Customer lock (serialização por cliente)
  → Identifica/cria customer no banco
  → Verifica:
    - Bot habilitado globalmente?
    - IA do consultor habilitada?
    - Cliente pausado? (takeover manual ativo?)
    - Kill switch ativo?
  → Rota para engine:
    - Legacy (step-based linear)
    - Conversacional (IA vendedora)
    - Engine v3 (flow-templates)
  → Gera resposta (texto/mídia/áudio)
  → Anti-ban checks (quota, warmup, quiet hours)
  → Simula digitando (typing presence)
  → Envia via Evolution API
  → Log de auditoria
```

---

## Fluxo de Campanhas (Meta Ads)

```
Consultor → /admin/meta-ads
  → Conecta conta Facebook (OAuth)
  → Seleciona assets (pixel, page, ad account)
  → Cria campanha (wizard ou express)
  → Express: IA gera copy automático
  → Publica no Facebook Ads
  → Cron sincroniza métricas (facebook-sync-metrics)
  → Dashboard mostra performance
  → CAPI envia eventos de conversão
  → Wallet controla gasto (prepaid)
```

---

## Fluxo de Mensagens Manuais

```
Consultor → /admin → Tab WhatsApp → Chat
  → Seleciona contato no sidebar
  → Digita mensagem ou seleciona template
  → messageSender.ts → evolutionApi.ts → evolution-proxy (Edge Function) → Evolution API
  → Marca autoTakeover (pausa bot por 30min)
  → Mensagem aparece no chat em tempo real (Supabase Realtime)
```

---

## Fluxo de Segurança / Permissões

```
Requisição chega na Edge Function:
  1. config.toml: verify_jwt = true/false?
  2. Se false → caller-auth.ts:
     - Header x-service-secret → modo "service" (bypass total)
     - Header Authorization Bearer → valida JWT → extrai consultantId
     - Sem nada → 401
  3. assertOwnership: verifica se consultor é dono do recurso
     - Admin → acesso total
     - Dono do customer/consultant → ok
     - Outro → 403
  4. RLS no PostgreSQL: segunda camada de proteção
     - Cada tabela tem policies por auth.uid()
     - service_role bypassa RLS (usado pelas Edge Functions)
```

---

## Fluxo de IA

```
Mensagem do cliente → evolution-webhook
  → Flow router decide se IA deve responder
  → ai-gateway.ts (Lovable Gateway)
     → Modelo: google/gemini-3-flash-preview (padrão)
     → Fallback: OpenAI (opcional)
  → Gemini quota bucket (60 tokens/min por consultor)
  → Gera resposta contextual
  → Extrai intenções (cadastrar, dúvida, objeção)
  → Aplica memória (ai-extract-memory)
  → Envia resposta humanizada
  → Registra custo (ai-cost-tracker)
```

---

## Tecnologias

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18, Vite 5, TypeScript, Tailwind CSS, shadcn/ui |
| Routing | React Router v6 |
| State | React Query (TanStack), useState/useEffect |
| Backend | Supabase Edge Functions (Deno), PostgreSQL |
| Auth | Supabase Auth (GoTrue) |
| Realtime | Supabase Realtime (WebSocket) |
| WhatsApp | Evolution API (Baileys), Whapi |
| IA | Gemini 3 Flash (via Lovable Gateway), OpenAI (fallback) |
| Ads | Facebook Marketing API |
| Storage | Supabase Storage + MinIO |
| Testes | Vitest, Playwright, fast-check (property tests) |
| Deploy | Lovable Cloud |
| Monitoramento | Sentry |
| PWA | Vite PWA (Workbox) |
