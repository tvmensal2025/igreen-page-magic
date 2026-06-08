# Sincronização iGreen via Extensão do Navegador

## Por que essa abordagem

O portal iGreen não tem API pública e o Cloudflare/WAF bloqueia qualquer login automatizado (worker + Tor + 2Captcha já provou ser inviável). A solução é **inverter o fluxo**: em vez de o servidor tentar logar como o consultor, o **próprio navegador do consultor — já logado no portal — envia os dados para a gente**. Não compartilhamos tokens, não há bot, Cloudflare vê tráfego humano legítimo.

## Como o consultor usa (fluxo de 30 segundos)

1. Em `/admin` (ou tela do consultor), botão **"Baixar extensão iGreen Sync"** → baixa ZIP.
2. Consultor abre `chrome://extensions`, ativa **Modo desenvolvedor**, clica **Carregar sem compactação** e seleciona a pasta.
3. Abre `https://app.igreenenergia.com.br` e faz login normalmente.
4. Clica no ícone da extensão → **Conectar ao iGreen Cloud** → cola um **token de pareamento** gerado em `/admin`.
5. Clica **Sincronizar agora** (ou deixa a extensão sincronizar automaticamente a cada X horas enquanto a aba estiver aberta/logada).

A extensão chama `/customer-map` (e outros endpoints internos do portal) usando os cookies de sessão do próprio usuário, normaliza e faz POST para um Edge Function nosso.

## Arquitetura

```text
┌─────────────────────────┐        ┌──────────────────────────┐
│  Navegador do consultor │        │  Lovable Cloud (Supabase)│
│                         │        │                          │
│  iGreen portal (logado) │        │  Edge Function:          │
│         │               │        │  igreen-ingest-customers │
│         ▼               │ HTTPS  │         │                │
│  Extensão Chrome (MV3)  │───────▶│         ▼                │
│  - fetch /customer-map  │        │  upsert em customers     │
│  - normaliza JSON       │        │  + import_log            │
│  - envia com pairing JWT│        │                          │
└─────────────────────────┘        └──────────────────────────┘
```

Worker `worker-igreen-sync` deixa de ser usado para login; pode ficar parado ou ser removido depois.

## O que precisa ser construído

### 1. Pareamento extensão ↔ consultor

- Tabela `igreen_extension_tokens` (`consultant_id`, `token` opaco aleatório, `expires_at`, `revoked_at`, `last_used_at`).
- Em `/admin` (ou perfil do consultor): botão **Gerar token** mostra o token uma única vez para colar na extensão. Lista de tokens ativos com botão **Revogar**.
- Edge Function `igreen-ingest-customers` valida o token no header `x-pairing-token`, resolve `consultant_id` e descarta requisições com token inválido/expirado.

### 2. Edge Function `igreen-ingest-customers`

- POST público (sem JWT do usuário), autenticado pelo `x-pairing-token`.
- Recebe `{ customers: [...] }` com o payload bruto do `/customer-map`.
- Normaliza para o schema da tabela `customers` (mesma lógica que o worker fazia).
- Upsert por `external_id` + `consultant_id`.
- Grava linha em `import_log` (origem `extension`, contagem, erros).

### 3. Extensão Chrome (Manifest V3)

Pasta `extension/igreen-sync/`:

- `manifest.json` — permissões `storage`, `activeTab`, host `https://*.igreenenergia.com.br/*` e a URL do Supabase Functions.
- `popup.html` + `popup.js` — campos: token de pareamento, status de conexão, último sync, botão **Sincronizar agora**, toggle **Sincronizar automaticamente**.
- `background.js` (service worker) — `chrome.alarms` agenda sync periódico; faz `fetch` para `/customer-map` via cookies do usuário e envia para o Edge Function.
- `chrome.storage.local` guarda token de pareamento e timestamp do último sync.
- Empacotamento com `nix run nixpkgs#zip` para `public/igreen-sync-extension.zip`.

### 4. UI no app

- `/admin` (ou tela do consultor): seção **Sincronização iGreen** com:
  - Botão **Baixar extensão** (via fetch+blob, conforme padrão).
  - Instruções passo a passo de instalação.
  - **Gerar novo token** + lista de tokens ativos.
  - Indicador de **último sync recebido** (último `import_log` da extensão).

## Segurança

- Token de pareamento é opaco (32 bytes random base64url), armazenado **hasheado** (`sha256`) no banco; o valor cru só existe no momento da geração.
- Sem `service_role_key` na extensão. Edge Function usa service_role internamente.
- RLS em `igreen_extension_tokens`: consultor só vê os próprios; admin vê todos.
- Token pode ser revogado a qualquer momento; expira em 90 dias por padrão.

## Detalhes técnicos

- **Endpoints do iGreen a chamar**: confirmar com captura no DevTools do consultor (`/customer-map` já está mapeado; pode haver paginação — extensão itera até esgotar).
- **CORS**: como a extensão tem permissão de host, `fetch` para o domínio iGreen funciona com cookies (`credentials: 'include'`).
- **Rate limit**: extensão envia em lotes de 500 clientes para o Edge Function.
- **Multi-consultor**: cada consultor instala a própria extensão com o próprio token; não há compartilhamento de sessão.

## Fora de escopo (por enquanto)

- Publicar na Chrome Web Store (instalação fica "unpacked" via Modo desenvolvedor — ok para uso interno).
- Sincronizar outras entidades além de clientes (faturas, comissões) — pode ser adicionado depois reusando o mesmo pareamento.
- Desligar/remover o `worker-igreen-sync` — fica parado; decidimos depois que a extensão estiver em produção.

## Entregáveis

1. Migration: tabela `igreen_extension_tokens` + grants + RLS + função `hash_pairing_token`.
2. Edge Function `igreen-ingest-customers`.
3. Pasta `extension/igreen-sync/` com manifest, popup, background script e ícone.
4. Script de build do ZIP em `public/igreen-sync-extension.zip`.
5. Seção **Sincronização iGreen** em `/admin` com download, geração de token e histórico.
