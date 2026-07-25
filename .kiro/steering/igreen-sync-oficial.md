---
inclusion: fileMatch
name: igreen-sync-oficial
description: Sync carteira iGreen (Playwright).
fileMatchPattern:
  - "worker-igreen-sync/**"
  - "supabase/functions/sync-igreen-customers/**"
  - "supabase/functions/_shared/igreen-sync-worker.ts"
  - "src/lib/igreenSync.ts"
---

# iGreen sync worker — leitura de carteira

Helper: #[[file:supabase/functions/_shared/igreen-sync-worker.ts]]  
Setting: `settings.igreen_sync_worker_url` · secret opcional `IGREEN_SYNC_WORKER_URL`

**URL oficial EasyPanel:** `https://igreen-worker-igreen.d9v63q.easypanel.host`  
Health: `GET /health` → `mode` começa com `tor+playwright+api-vo-`

| Worker | Setting | Uso |
|---|---|---|
| igreen-sync | `igreen_sync_worker_url` | Leitura carteira |
| portal-2 | `portal2_worker_url` | Cadastro leads |
| club | `club_worker_url` | Club |

## Auditoria IA (Gemini 2.5 Flash)

Shadow review dos syncs (não muda o sync):
- Edge: `sync-ai-audit` · tabela `sync_audit_traces`
- Worker: `worker-igreen-sync/ai-audit.mjs` (chama no `/sync-all` e em falhas)
- Modelo: **gemini-2.5-flash** (~US$ 0,0002/run)
- Limite de sucessos: `SYNC_AI_AUDIT_LIMIT` (default **20** na edge). **Falhas sempre auditam.**
- Falha com finding `error` → alerta WA (`sync_fail:*`) via `notifySuperAdminOpsAlert`

Env no Easy Panel do Sync:
- `SUPABASE_URL` = URL do projeto
- `WORKER_TOKEN` (ou `SYNC_AI_AUDIT_SECRET`) = mesmo secret da edge (`IGREEN_SYNC_WORKER_SECRET` / `WORKER_SECRET` / `PORTAL2_WORKER_SECRET`)
- Opcional: `SYNC_AI_AUDIT_DISABLED=true` · `SYNC_AI_AUDIT_LIMIT=0`

## Proibido
localhost:3102 · docker interno · typo `d9v83a` · usar `portal2_worker_url` para sync · re-mapear sem helper+/health.
