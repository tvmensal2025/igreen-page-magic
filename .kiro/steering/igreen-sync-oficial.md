---
inclusion: fileMatch
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

## Proibido
localhost:3102 · docker interno · typo `d9v83a` · usar `portal2_worker_url` para sync · re-mapear sem helper+/health.
