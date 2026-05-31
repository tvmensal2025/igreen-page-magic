# Auditoria completa do sistema

Objetivo: passar um pente fino em segurança, banco, edge functions, worker-portal, fluxo do bot e frontend, gerar um relatório em `/mnt/documents/AUDITORIA_SISTEMA_2026-05-31.md` e aplicar as correções que dá pra resolver sem decisão sua.

## Frentes da auditoria

### 1. Segurança & banco (Supabase)
- Rodar `supabase--linter` e tratar todos os warnings (RLS off, SECURITY DEFINER sem `search_path`, função sem grant, etc.).
- Rodar `security--run_security_scan` e classificar cada finding (corrigir, ignorar com justificativa, ou registrar).
- Revisar GRANTs do schema `public` (toda tabela criada precisa ter GRANT pra `authenticated`/`service_role`; `anon` só onde faz sentido).
- Conferir políticas RLS de tabelas sensíveis: `customers`, `user_roles`, `consultants`, `consultant_wallet`, `wallet_transactions`, `crm_deals`, `bot_flows`, `ai_decisions`, `admin_audit_log`, `facebook_connections`.
- Confirmar que nenhum secret (service_role, tokens) está em tabela ou exposto no frontend.

### 2. Edge functions
- Listar todas as functions em `supabase/functions/` e cruzar com `supabase/config.toml` (faltando `verify_jwt`, memória/timeout incoerentes).
- Para functions críticas (`evolution-webhook`, `whapi-webhook`, `upload-documents-minio`, `bot-stuck-recovery`, `ai-followup-cron`, `bot-loop-watchdog`, `facebook-capi`, `portal2-ai-audit`), checar logs recentes via `supabase--edge_function_logs` e identificar erros.
- Validar secrets necessários presentes via `fetch_secrets` (Evolution, MinIO, Gemini, Worker, Stripe, FB).
- Conferir CORS, validação de input (zod) e tratamento de erro nas functions HTTP públicas.

### 3. Worker-portal / worker-portal-2
- Validar Dockerfile, start.sh, healthcheck, secrets esperados (`WORKER_SECRET`, `SUPABASE_URL`, `EVOLUTION_*`).
- Conferir endpoints expostos e autenticação por `WORKER_SECRET`.

### 4. Fluxo do bot WhatsApp
- Conferir consistência do fluxo Camila: `seed_default_camila_flow`, `bot_flows`, `bot_flow_steps`, `repair_bot_flow`.
- Verificar leads travados (`customer_flow_state` com `entered_step_at` antigo, `bot_paused` órfão, `assigned_human_id` inválido).
- Confirmar que `customers` órfãos / duplicados foram limpos.

### 5. Frontend / acesso admin
- Validar `/admin`, `useAdminAuth`, `useUserRole` — Rafael consegue acessar como super_admin.
- Conferir rotas protegidas e que `service_role` não vaza em código cliente.
- Rodar checagem rápida de console errors / network 4xx-5xx no preview.

### 6. CI / config
- Olhar `.github/workflows/` rapidamente, ver se algo está quebrado.
- Conferir `supabase/config.toml` completo (functions novas registradas).

## Entregável

Arquivo `/mnt/documents/AUDITORIA_SISTEMA_2026-05-31.md` com:
- Resumo executivo (severidade × quantidade).
- Por frente: o que foi checado, achados, severidade, status (corrigido / pendente / aceito).
- Lista de migrations e mudanças de código aplicadas no loop.
- Pendências que dependem de você (ex.: rotacionar secret, decisão de produto).

## Correções aplicadas automaticamente

Vou aplicar sem perguntar:
- Warnings do linter Supabase (search_path em SECURITY DEFINER, RLS faltando, índice óbvio).
- GRANTs faltando em tabelas `public`.
- `config.toml` desatualizado (functions sem entry).
- CORS / validação faltando em edge functions HTTP.

Vou só reportar (não aplicar) quando:
- Mudança altera comportamento de produto.
- Política RLS muda quem vê o quê.
- Envolve secret ou integração externa que precisa decisão sua.

## Fora de escopo

- Reescrever fluxos do bot ou refatorar arquitetura.
- Mexer em dados de produção (leads, deals) além de cleanups óbvios de órfãos.
- Performance profunda (só sinalizo gargalos óbvios).
