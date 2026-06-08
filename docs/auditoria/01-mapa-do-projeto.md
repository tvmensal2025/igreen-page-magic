# 01 — Mapa Completo do Projeto

> Última atualização: 08/06/2026

---

## Visão Geral

O projeto **iGreen Official Portal** é uma plataforma completa de CRM + automação de vendas via WhatsApp para consultores de energia solar. Inclui:

- **Frontend** (React + Vite + Tailwind + shadcn/ui)
- **Backend** (Supabase Edge Functions em Deno)
- **Banco de Dados** (PostgreSQL via Supabase)
- **Integrações** (WhatsApp via Evolution API / Whapi, IA via Gemini/OpenAI, Facebook Ads, MinIO)
- **Workers** (automação de portais iGreen via Playwright)

---

## Árvore de Pastas Principais

```
igreen-official-portal/
├── src/                          ← FRONTEND (React)
│   ├── assets/                   ← Imagens estáticas (logo, mapas, fotos)
│   ├── components/               ← 200+ componentes React
│   │   ├── ui/                   ← 56 primitivos shadcn/ui (NÃO MEXER)
│   │   ├── admin/                ← Painel administrativo do consultor
│   │   ├── whatsapp/             ← CRM WhatsApp (chat, kanban, templates)
│   │   ├── captacao/             ← Gamificação de captação de documentos
│   │   ├── licenciada/           ← Landing page de parceiro licenciado
│   │   ├── superadmin/           ← Painel do super administrador
│   │   ├── layout/              ← Shell, sidebar, topbar
│   │   ├── common/              ← Componentes compartilhados landing
│   │   ├── wallet/              ← Sistema de carteira (recarga)
│   │   └── support/             ← Chat de suporte
│   ├── pages/                    ← 24 páginas/rotas
│   ├── hooks/                    ← 50+ hooks customizados
│   │   └── whatsapp/            ← Hooks WhatsApp (5 arquivos)
│   ├── services/                ← 11 serviços de integração
│   ├── lib/                     ← Utilitários e lógica auxiliar
│   │   ├── captacao/            ← Lógica de captação
│   │   ├── flow-selectors/      ← Seletores de fluxo
│   │   ├── flow-simulator/      ← Simulação de fluxo
│   │   └── whatsapp/            ← Helpers WhatsApp
│   ├── integrations/supabase/   ← Cliente Supabase + types auto-gerados
│   ├── contexts/                ← 2 contexts (Tema + Privacidade)
│   ├── data/                    ← Dados estáticos (distribuidoras)
│   ├── styles/                  ← CSS adicional (painel elite)
│   ├── test/                    ← Testes unitários e property tests
│   └── types/                   ← TypeScript types (3 arquivos)
│
├── supabase/                     ← BACKEND
│   ├── functions/                ← 120+ Edge Functions (Deno)
│   │   ├── _shared/             ← 85+ módulos compartilhados
│   │   ├── evolution-webhook/   ← 🔴 Orquestrador principal do bot
│   │   ├── whapi-webhook/       ← Webhook Whapi (super admin)
│   │   ├── ai-sales-agent/      ← Agente de vendas IA
│   │   ├── ai-agent-router/     ← Roteador de IA
│   │   ├── facebook-*/          ← 30+ funções Meta Ads
│   │   ├── bot-*/               ← Infraestrutura do bot
│   │   └── ...                  ← Captura, CRM, crons, mídia, etc.
│   ├── migrations/              ← 280+ migrations SQL
│   └── config.toml              ← Configuração (JWT, funções)
│
├── worker-portal/                ← Worker Playwright (cadastro no portal iGreen)
├── worker-portal-2/              ← Worker Portal 2 (API direta "autoconexão")
├── worker-igreen-sync/           ← Worker de sincronização com portal iGreen
├── compress-worker/              ← Worker de compressão de mídia
│
├── public/                       ← Arquivos estáticos públicos
├── docs/                         ← Documentação existente
├── extension/                    ← Extensão Chrome (igreen-sync)
├── mem/                          ← Memória/contexto do projeto (copy, crm, features)
├── fixtures/                     ← Fixtures de teste (CNH, conta)
│
├── package.json                  ← Dependências + scripts
├── vite.config.ts                ← Config Vite + PWA
├── tailwind.config.ts            ← Config Tailwind
├── supabase/config.toml          ← Config Supabase
├── playwright.config.ts          ← Config Playwright (E2E)
└── vitest.config.ts              ← Config Vitest (unit)
```

---

## Classificação dos Arquivos

### Essenciais (NUNCA mexer sem planejamento)

| Arquivo | Função |
|---------|--------|
| `src/integrations/supabase/client.ts` | Cliente Supabase global |
| `src/integrations/supabase/types.ts` | Types auto-gerados (6765 linhas) |
| `supabase/functions/_shared/caller-auth.ts` | Autenticação entre Edge Functions |
| `supabase/functions/_shared/anti-ban.ts` | Proteção anti-ban WhatsApp |
| `supabase/functions/_shared/evolution-api.ts` | Comunicação com Evolution API |
| `supabase/functions/evolution-webhook/index.ts` | Orquestrador principal do bot |
| `supabase/config.toml` | Configuração de JWT/funções |
| `supabase/migrations/*` | Schema do banco (280+ arquivos) |

### Configuração

| Arquivo | Função |
|---------|--------|
| `package.json` | Dependências e scripts |
| `vite.config.ts` | Build, PWA, chunks |
| `tailwind.config.ts` | Estilos |
| `tsconfig*.json` | TypeScript |
| `eslint.config.js` | Linting |
| `.gitignore` | Controle de versionamento |
| `supabase/functions/.env.example` | Variáveis de ambiente documentadas |

### Frontend (Páginas)

| Arquivo | Função |
|---------|--------|
| `src/pages/Auth.tsx` | Login/cadastro |
| `src/pages/Admin.tsx` | Dashboard principal do consultor |
| `src/pages/SuperAdmin.tsx` | Painel do super admin |
| `src/pages/ConsultantPage.tsx` | Página pública do consultor |
| `src/pages/WhatsAppClientsPage.tsx` | CRM WhatsApp |
| `src/pages/FluxoBuilder.tsx` | Editor de fluxos |
| `src/pages/AdminMetaAds.tsx` | Gestão Meta Ads |
| `src/pages/LicenciadaPage.tsx` | Landing parceiro |

### Integrações

| Arquivo | Função |
|---------|--------|
| `src/services/evolutionApi.ts` | Evolution API (frontend proxy) |
| `src/services/whapiApi.ts` | Whapi (super admin) |
| `src/services/messageSender.ts` | Pipeline unificado de envio |
| `src/services/facebookAds.ts` | Facebook/Meta Ads |
| `src/services/expressCampaign.ts` | Campanhas express com IA |
| `src/services/minioUpload.ts` | Upload para MinIO |

### Variáveis de Ambiente

Todas documentadas em `supabase/functions/.env.example`:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `WHAPI_TOKEN`, `WHAPI_API_URL`
- `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`
- `GEMINI_API_KEY`, `GOOGLE_AI_API_KEY`, `OPENAI_API_KEY`
- `LOVABLE_API_KEY`
- `MINIO_SERVER_URL`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`
- `PORTAL_WORKER_URL`, `WORKER_SECRET`
- `SERVICE_SHARED_SECRET`
- `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`
- `SENTRY_DSN`

---

## Arquivos Suspeitos / Possivelmente Não Usados

| Arquivo/Pasta | Observação |
|---------------|------------|
| `screenshots/`, `sim-screenshots/`, `teste-e2e-screenshots/` | Artefatos de teste — podem ser removidos do repo |
| `tmp/` (raiz) | Contém JPGs de teste locais |
| `.tmp/` | Scripts temporários (maioria ignorada pelo git) |
| `test-*.ts`, `test-*.mjs`, `test-*.sh` (raiz) | Scripts de teste avulsos — não organizados |
| `ANALISE_COMPLETA_CODIGO.md` | Análise anterior — pode estar desatualizada |
| `comandos-debug.sh` | Comandos de debug avulsos |
| `cron_setup.sql` | SQL avulso fora das migrations |
| `*.webp` (raiz) | 10 imagens na raiz — deveriam estar em `public/images/` |
| `bun.lockb` + `bun.lock` + `package-lock.json` | Três lockfiles (bun + npm) — redundante |
| `deno.lock` | Lock do Deno — possivelmente não necessário no repo |

---

## Arquivos Perigosos (mexer com extremo cuidado)

| Arquivo | Risco |
|---------|-------|
| `supabase/functions/evolution-webhook/index.ts` | Orquestrador do bot — um bug para TODO o sistema de WhatsApp |
| `supabase/functions/_shared/caller-auth.ts` | Segurança — um bug expõe dados de todos os usuários |
| `supabase/functions/_shared/anti-ban.ts` | Um erro pode causar BAN do WhatsApp |
| `supabase/migrations/*` | Migrations são imutáveis em produção |
| `src/integrations/supabase/types.ts` | Auto-gerado — NUNCA editar manualmente |
| `supabase/config.toml` | Alteração errada expõe endpoints sem autenticação |
