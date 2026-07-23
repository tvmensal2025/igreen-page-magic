---
inclusion: fileMatch
fileMatchPattern:
  - "src/features/remote-support/**"
  - "supabase/functions/remote-support-*/**"
  - "src/pages/SuperAdminRemoteSupport.tsx"
  - "**/migrations/*remote_support*"
---

# Remote Support — tela compartilhada

Requester (consultor) ↔ operator (superadmin): pedido → código → getDisplayMedia → logs → fim.  
Realtime: `remote_support_sessions`.

## Onde
- Feature: `src/features/remote-support/` (`RemoteSupportProvider`, `api.ts`, `screenShare.ts`)
- Console: `/super-admin/suporte` (`SuperAdminRemoteSupport.tsx`) — montado em `App.tsx`
- Edges: `remote-support-request|operator-request|accept|rotate-code|verify-code|end`
- Tabelas: `remote_support_sessions`, `remote_support_codes`, `remote_support_logs`
- Authz realtime: migration `remote_support_realtime_authz`

## FAÇA
Só via `api.ts` · status `requested`→`pending_code`→`active`→`ended|rejected|expired` · logar em `remote_support_logs`

## NÃO FAÇA
Código em claro fora do fluxo · sessão sem auth · misturar com WA/cadência · remover publication realtime
