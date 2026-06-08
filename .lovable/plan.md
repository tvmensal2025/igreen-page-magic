# Plano — Sync iGreen 100% via extensão

## 1. Remover credenciais do portal iGreen

- `**src/components/admin/DadosTab.tsx**`: deletar o bloco "Credenciais Portal iGreen" (email + senha + toggle de mostrar senha) e os campos `igreen_portal_email` / `igreen_portal_password` do form. Remover imports `KeyRound`, `Eye`, `EyeOff` se ficarem sem uso.
- `**src/components/admin/DashboardTab.tsx**`:
  - Remover o `Dialog` de "Conectar ao Portal iGreen" (credForm, showCredentialsDialog, handleSaveCredentialsAndSync, showCredPassword).
  - Remover o `useEffect` que dispara `runSync` automaticamente quando há `igreen_portal_email`.
  - Remover qualquer auto-prompt de credenciais no boot.
- Manter as colunas `igreen_portal_email/password` no banco (sem migração) — apenas paramos de usá-las na UI.

## 2. "Sincronizar agora" passa a falar com a extensão

- O botão **Sincronizar** do header do Dashboard deixa de chamar a edge `sync-igreen-customers` e passa a:
  1. Tentar `chrome.runtime.sendMessage(EXT_ID, { type: "SYNC_NOW" })`.
  2. Se não houver resposta → modal "Instale/atualize a extensão iGreen Sync" com botão para a aba de instalação (`IGreenExtensionCard` já existente).
  3. Se a extensão responder `{ ok:false, reason:"not_logged_in" }` → modal "Você precisa estar logado no escritório iGreen" com botão "Abrir escritório em nova aba" (`https://escritorio.igreenenergy.com.br/`) e instrução de voltar e clicar de novo.
  4. Se `{ ok:false, reason:"no_token" }` → modal apontando para o card de pareamento (gerar token).
  5. Se `{ ok:true }` → toast verde + cooldown de 30 s já existente.
- Criar helper `src/lib/igreenExtensionBridge.ts` com `requestSync()` e `pingExtension()` usando o ID público da extensão (vamos publicar o ID hardcoded — para dev usamos o `chrome-extension://<id>` impresso pelo manifest após `Load unpacked`; o card de pareamento já mostra esse ID).

### Mudanças na extensão

- `**manifest.json**`: adicionar
  ```json
  "externally_connectable": { "matches": [
    "https://igreen.cloud/*", "https://*.igreen.cloud/*",
    "https://*.lovable.app/*", "http://localhost/*"
  ] }
  ```
- `**background.js**`: adicionar listener `chrome.runtime.onMessageExternal` que:
  - valida origem,
  - checa se há token salvo (`no_token`),
  - faz um `fetch` rápido em `https://escritorio.igreenenergy.com.br/` (ou abre aba em background e inspeciona) para detectar sessão; se 401/redirect login → `not_logged_in`,
  - se OK, dispara o mesmo fluxo do `SYNC_NOW` interno e responde `{ ok:true }` quando termina.

## 3. Popup da extensão: visual + token oculto

`**extension/igreen-sync/popup.html` + `popup.js**` (reescrita do popup):

- Visual mais polido: cabeçalho com gradiente verde, badge de status "Conectado / Não pareado / Sincronizando", card de "Último sync" com ícones, botão principal grande "Sincronizar agora", switch estilizado para auto-sync.
- **Token mascarado por padrão**:
  - Se já existe token salvo → mostrar apenas `abcd1234••••••••` (read-only), com 2 botões pequenos: **Trocar token** (abre input) e **Remover** (limpa storage). Sem campo de input visível.
  - Se não existe token → mostrar input + botão "Salvar".
  - Nunca renderizar o token completo na tela, mesmo após salvar.
- Adicionar seção colapsável "Diagnóstico" com último erro e link "Abrir escritório iGreen" (target=_blank).

## 4. Empacotar nova extensão

- Após as alterações, regerar o `public/igreen-sync-extension.zip` (o `IGreenExtensionCard` já distribui esse arquivo).
- Bump da versão do manifest para `1.4.0`.

## Arquivos tocados

- `src/components/admin/DadosTab.tsx` (remover bloco credenciais)
- `src/components/admin/DashboardTab.tsx` (remover dialog + auto-sync; novo handler do botão Sincronizar)
- `src/lib/igreenExtensionBridge.ts` (novo)
- `extension/igreen-sync/manifest.json` (externally_connectable, v1.4.0)
- `extension/igreen-sync/background.js` (handler externo + detecção de login)
- `extension/igreen-sync/popup.html` + `popup.js` (visual + token oculto)
- `public/igreen-sync-extension.zip` (regerar)

## Pergunta

1. Posso publicar o **ID fixo da extensão** (precisamos de uma `key` no manifest para o ID não mudar entre máquinas) ou prefere que o usuário cole o ID dele uma vez no painel? Recomendo a `key` fixa — torna o "Sincronizar" funcionar sem configuração extra.  
  
fixo id o id dele ja é colocado em dados e assim que ele faz  o cadastro 