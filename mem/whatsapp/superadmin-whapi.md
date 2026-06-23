---
name: Super Admin sempre Whapi
description: rafael.ids@icloud.com (super admin) usa Whapi sempre, nunca Evolution. Reconexão via UI sem código.
type: constraint
---
**Regra fixa:** o usuário autenticado como `rafael.ids@icloud.com` (ou qualquer user com `is_super_admin(user_id) = true`) é **sempre** roteado para Whapi. Nunca pode cair no fluxo Evolution, em nenhuma tela.

- Bypass duro em `src/hooks/useWhatsApp.ts` no início do `init()` (checa email + RPC `is_super_admin`) — antes de qualquer leitura de `settings`.
- `whapi-proxy/index.ts` aceita autorização por `settings.superadmin_consultant_id` OU `is_super_admin(userId)`.
- Outros consultores continuam Evolution normalmente.

**Reconexão sem código:** quando o canal Whapi cair (404 "Channel not found", token expirado), o super admin reconecta pela aba WhatsApp → Dashboard → card "Conexão Whapi (Super Admin)":
- Ver status (`AUTH`/`QR`/`OFFLINE`) via `whapi-proxy` action `health_check`.
- Atualizar token via edge function `whapi-admin` action `update_token` (grava em `settings.whapi_token`).
- Pedir QR (`request_qr`) e fazer logout (`logout`) do canal.

Nunca remover esses caminhos. Nunca expor o painel para consultores normais (gate por `isWhapi`).
