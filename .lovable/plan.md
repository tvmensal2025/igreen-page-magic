# Ajustes na extensao iGreen Sync

## Problemas identificados

1. **Bug critico de troca de arquivos**: No ultimo sync, "Clientes: 0 atualizados (de 919, erros 919)" e "Rede: 919 atualizados". O numero 919 e o total de clientes, nao de consultores (~59). Isso indica que o XLSX de clientes foi enviado como `rede` (ou o mesmo blob foi capturado nas duas abas porque sao abertas em paralelo e o interceptor pega o primeiro blob disponivel).
2. Navegador pede permissao para baixar varios arquivos ao mesmo tempo (porque abre 2 abas e dispara 2 downloads quase simultaneos).
3. Botao "Salvar token" e um passo extra desnecessario.
4. Popup sem identidade visual (icone generico, sem mensagem).

## Mudancas

### 1. `extension/igreen-sync/background.js` — sync sequencial
- Trocar o `Promise.all([syncClientes, syncRede])` por execucao **sequencial**: primeiro abre `/mapa-clientes`, espera capturar+enviar+fechar a aba, **depois** abre `/mapa-rede`. Isso resolve a permissao de "multiplos downloads" e elimina a chance de cross-contamination do blob entre as abas.
- Marcar cada blob capturado com a origem (`source: "clientes" | "rede"`) baseada no `tabId` que originou o download, e validar antes de enviar (ex.: rejeitar se o arquivo capturado em `/mapa-clientes` tiver `rede`/`indicacao` no nome).
- Logar o nome do arquivo XLSX recebido para diagnostico futuro.

### 2. `supabase/functions/igreen-ingest-xlsx/index.ts` — validacao defensiva
- Detectar quando o payload `clientes` na verdade contem colunas de rede (ex.: `Patrocinador`, `Status do Consultor`) e retornar erro claro em vez de gerar 919 erros silenciosos.

### 3. `extension/igreen-sync/popup.html` + `popup.js` — UX
- Remover botao "Salvar token". Token e salvo automaticamente no `input.blur` e tambem no clique de "Sincronizar agora" (se vazio, mostra aviso).
- Adicionar header com icone G (ver item 4) + mensagem motivacional rotativa:
  - "Cada sync acende um novo cliente solar."
  - "Energia limpa comeca com dados limpos."
  - "Voce esta a um clique de iluminar mais lares."
  - "Sol no painel, dados na nuvem."
- Texto sutil abaixo do botao principal.

### 4. Icone G — substituir `extension/igreen-sync/icon.png`
- Gerar um PNG 128x128 com a letra **G** verde (paleta iGreen), fundo claro, estilo do favicon atual do site. Atualizar `manifest.json` se necessario (`48`/`128`).
- Usar o mesmo G como header no popup (`<img src="icon.png" width="32">`).

### 5. Reempacotar
- Bump version 1.1.1 -> **1.2.0**.
- Regerar `public/igreen-sync-extension.zip`.
- Atualizar texto do `IGreenExtensionCard.tsx` removendo a mencao a "Salvar token" e citando o icone novo.

## Detalhes tecnicos

```text
SYNC_NOW
  └─ openTab(/mapa-clientes)
       └─ waitForDataReady → clickExport → captureXLSX(tabId)
       └─ POST ingest { kind: "clientes", file }
       └─ closeTab
  └─ openTab(/mapa-rede)        ← so comeca depois do clientes terminar
       └─ idem
       └─ POST ingest { kind: "rede", file }
       └─ closeTab
  └─ persistir resultado por tipo
```

Validacao no backend: se `kind=clientes` mas as colunas da planilha sao `["Codigo Consultor","Patrocinador",...]` → 400 com `"arquivo trocado: enviado planilha de rede como clientes"`.

## Arquivos a alterar
- `extension/igreen-sync/background.js`
- `extension/igreen-sync/popup.html`
- `extension/igreen-sync/popup.js`
- `extension/igreen-sync/icon.png` (regerar)
- `extension/igreen-sync/manifest.json` (version bump)
- `supabase/functions/igreen-ingest-xlsx/index.ts`
- `src/components/admin/IGreenExtensionCard.tsx`
- `public/igreen-sync-extension.zip` (reempacotar)

## Observacao sobre `.lovable/`
O `.gitignore` do projeto exclui `.lovable/`, onde este plano e salvo. Se quiser que planos persistam entre snapshots, remova `.lovable/` do `.gitignore`.
