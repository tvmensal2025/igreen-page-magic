# Corrigir extensão iGreen Sync não carregando no Chrome

## Diagnóstico

O Chrome está recusando a pasta `extension/igreen-sync/` porque o arquivo `icon.png` **não é um PNG real** — é um JPEG renomeado (cabeçalho `FF D8 FF E0` = JFIF/JPEG, em vez de `89 50 4E 47` esperado para PNG).

Como o `manifest.json` declara `"icons": { "48": "icon.png", "128": "icon.png" }`, o Chrome tenta decodificar como PNG, falha, e rejeita a extensão inteira com erro tipo *"Could not load icon 'icon.png' specified in 'icons'"*. Resultado: a pasta "não carrega".

O mesmo arquivo defeituoso também está dentro de `public/igreen-sync-extension.zip`, então o download do admin entrega o problema para o consultor.

## Correção

1. **Gerar um ícone PNG válido** em `extension/igreen-sync/icon.png` (128×128, fundo verde da marca iGreen com a folha/logo). Usar `imagegen--generate_image` com `transparent_background: false` e extensão `.png`, salvando direto no caminho.

2. **Verificar** que o novo arquivo começa com os bytes mágicos PNG (`89 50 4E 47 0D 0A 1A 0A`).

3. **Reempacotar** `public/igreen-sync-extension.zip` com os 5 arquivos (`manifest.json`, `background.js`, `popup.html`, `popup.js`, `icon.png`) usando `nix run nixpkgs#zip -- -j ...` a partir de `extension/igreen-sync/`.

4. **Validar** listando o conteúdo do novo ZIP e confirmando o tamanho/tipo do `icon.png` interno.

## Fora de escopo

- Nenhuma mudança em código TS/React, edge functions, banco de dados ou UI.
- Nenhuma alteração no `manifest.json` (a declaração está correta; só o binário do ícone estava errado).
