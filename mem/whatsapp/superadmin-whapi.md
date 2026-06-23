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

**Classificação de erros da Whapi (não tratar tudo como "offline"):** `whapi-proxy` chama `classifyWhapiError(status, data)` em todo erro e devolve `{ reasonCode, helpUrl }`:
- `unpaid` (HTTP 402) — canal suspenso por falta de pagamento. Trocar token/QR **não resolve**. UI mostra banner vermelho com CTA para `panel.whapi.cloud/billing`, tanto no card de conexão quanto como banner global em todas as sub-abas do WhatsApp (`WhapiBillingBanner`).
- `channel_not_found` (HTTP 404) — canal removido. CTA para criar novo canal em `panel.whapi.cloud`.
- `invalid_token` (HTTP 401) — token inválido. UI foca em colar token novo.
- `offline` (HTTP 503) — QR/desconectado. Fluxo padrão de reconexão.

`health_check` também devolve `reasonCode`/`reasonMessage`/`helpUrl` para `useWhapiHealth`, então a UI nunca pode esconder o motivo real do bloqueio. **Nunca** voltar à mensagem genérica "Canal Whapi offline ou token inválido" — o super admin precisa saber se é problema financeiro para não perder tempo.
