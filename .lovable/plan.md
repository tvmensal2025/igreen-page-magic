## Objetivo
Garantir que o Super Admin (`rafael.ids@icloud.com`) **sempre** opere via Whapi e que, quando o canal Whapi cair (token expirado, canal removido — o famoso `404 Channel not found`), seja possível **reconectar pela própria interface, sem mexer em código**.

## Diagnóstico atual
- A regra "superadmin = Whapi" já está aplicada em `src/hooks/useWhatsApp.ts` (linhas 700‑760) e no `supabase/functions/whapi-proxy/index.ts` (linha 211). ✅
- O erro de hoje (`Edge function returned 404: Channel not found`) veio do gate `gate.whapi.cloud`: o token salvo em `settings.whapi_token` aponta para um canal que não existe mais. O proxy já passou a devolver `503` amigável, mas **não há tela para trocar o token / religar o canal** — então hoje, para reconectar, é preciso editar a tabela `settings` no banco. É exatamente o que o usuário quer eliminar.

## Plano

### 1. Reforço da regra "Superadmin = Whapi, sempre"
- Em `useWhatsApp.ts`, adicionar um **bypass duro no início do `init()`**: antes de qualquer leitura de `settings`, se `supabase.auth.getUser()` retornar e‑mail `rafael.ids@icloud.com` **ou** `is_super_admin(user.id) === true`, marcar `isWhapi=true`, `status="connected"` e sair — sem nem tentar Evolution. (Hoje a checagem de e‑mail está só como fallback dentro do `try/catch`.)
- Em `whapi-proxy/index.ts`, aceitar como super admin tanto `settings.superadmin_consultant_id === userId` quanto `is_super_admin(userId)`. Isso protege contra `settings` corrompida.
- Garantir que `useChats`, `useMessages`, `WhatsAppTab`, `ChatView` e `ConnectionPanel` recebem `isWhapi` consistentemente (já recebem — só validar nada novo passou a chamar Evolution).

### 2. Painel "Conexão Whapi (Super Admin)" — reconectar sem código
Novo card dentro de `WhatsAppTab` que **só aparece para o super admin** (`isWhapi === true`), com:

- **Status do canal em tempo real**: chamada nova `whapi-proxy` action `health_check` → faz `GET /health` no gate Whapi e retorna `{ status: "AUTH" | "QR" | "OFFLINE", phone, channel_id }`. Render: badge verde/amarelo/vermelho.
- **Telefone conectado** lido de `/users/me` (Whapi) — salvo de volta em `settings.whapi_connected_phone`.
- **Botão "Atualizar token Whapi"**: abre input que salva em `settings.whapi_token` via uma edge function nova `whapi-admin` (apenas super admin pode chamar). Depois de salvar, dispara `health_check` automaticamente.
- **Botão "Pedir QR / Pareamento"**: action `request_qr` no proxy → `GET /users/login` no Whapi; renderiza o QR base64 retornado, igual ao fluxo Evolution.
- **Botão "Logout do canal"**: action `logout` → `POST /users/logout`, útil para reparear.
- **Banner global** no topo do chat quando `health_check` devolver `OFFLINE` nas últimas N tentativas, com CTA "Reconectar agora" que abre esse painel.

### 3. Fallback de envio mais claro
Hoje `whapi-proxy/send_text` já devolve `503` com mensagem amigável quando o canal cai. Replicar o mesmo tratamento em `send_media` e `send_audio` (atualmente só `send_text` tem) para nunca quebrar a UI com 404 cru.

### 4. Documentação curta
Adicionar nota em `mem://whatsapp/superadmin-whapi.md` (nova) com a regra fixa: **"rafael.ids@icloud.com = Whapi sempre; consultores normais = Evolution; reconexão Whapi vive na aba WhatsApp > Conexão Whapi."** Atualizar `mem://index.md`.

## Arquivos afetados
- `src/hooks/useWhatsApp.ts` — bypass duro do super admin no topo do init.
- `src/components/whatsapp/WhatsAppTab.tsx` — render do novo painel.
- `src/components/whatsapp/WhapiConnectionPanel.tsx` (novo) — UI de status, QR, troca de token, logout.
- `src/hooks/useWhapiHealth.ts` (novo) — polling do `health_check` a cada 30s.
- `supabase/functions/whapi-proxy/index.ts` — novas actions `health_check`, `request_qr`, `logout`; mesmo tratamento 503 em `send_media`/`send_audio`; aceitar `is_super_admin` como fallback de autorização.
- `supabase/functions/whapi-admin/index.ts` (novo) — endpoint para atualizar `settings.whapi_token` com checagem `is_super_admin`.
- `mem://whatsapp/superadmin-whapi.md` (novo) + `mem://index.md`.

## Resultado esperado
- Super admin nunca mais aparece como Evolution em nenhuma tela.
- Quando o canal Whapi cair, super admin vê banner vermelho, abre o painel, cola o novo token (ou escaneia QR) e o sistema volta a enviar — **sem deploy, sem SQL, sem alterar código**.
