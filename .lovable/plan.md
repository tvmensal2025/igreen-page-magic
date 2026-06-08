## Migração ✅
Tabela `consultant_network` criada (RLS: consultor vê só a própria rede, admin vê tudo).

## Falta implementar (próximo passo, em build mode)

**1. Edge function `igreen-ingest-xlsx`** — recebe `{clientes_b64, rede_b64, mes_ref}` + `x-pairing-token`, valida token, parseia XLSX com `xlsx@0.18.5` (esm.sh), upsert em:
- `customers` (proteção pra leads em conversa, igual a ingest-customers atual)
- `consultant_network` (nova)

**2. Extensão — captura automática do Excel**

`background.js` reescrito: ao clicar "Sincronizar agora":
- Abre 2 abas: `escritorio.igreenenergy.com.br/mapa-clientes` e `/mapa-rede`
- Injeta script no **MAIN world** que sobrepõe `fetch`, `XMLHttpRequest` e `URL.createObjectURL` pra capturar qualquer blob com mime de planilha
- Também escuta `chrome.downloads.onCreated` como fallback (caso o portal use `<a href>` direto): cancela o download, re-baixa via `fetch` com cookies, encoda
- Clica no botão "Exportar Excel" automaticamente
- Quando os 2 XLSX são capturados (ou timeout 30s), manda base64 pra edge function
- Mostra no popup: `Clientes: 919 atualizados | Rede: 59 atualizados`

`manifest.json`: adiciona perms `scripting`, `tabs`, `downloads`, `activeTab`.

`popup.html` / `popup.js`: contadores separados Clientes/Rede + linha de erro detalhada.

**3. `IGreenExtensionCard.tsx`** — atualiza instruções (login em `escritorio.igreenenergy.com.br`, sincronização agora pega clientes + rede).

**4. Repack** `public/igreen-sync-extension.zip`.

**5. Sem UI nova de "Minha Rede" agora** — fica pra outra rodada quando você confirmar que os dados chegaram certinhos. Você consegue ver a tabela direto no Supabase pra validar.

Pode liberar?