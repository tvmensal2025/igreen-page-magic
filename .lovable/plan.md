# Limpeza dos botões de sessão do WhatsApp

## Problema

Hoje aparecem 3 ações com nomes parecidos e o usuário se perde:

1. **"Reconectar chip"** no painel de Saúde (derruba sessão + gera QR novo) — adicionado agora.
2. **"Reconectar"** no `ConnectionPanel`, no estado `disconnected` (faz a mesma coisa, só com outro caminho de código).
3. **"Liberar — chip reconectado e estável"** no painel de Saúde (NÃO é reconexão, só destrava o circuit breaker de envios automáticos).

Além disso, o botão **"Desconectar"** só aparece quando o status é `connected`. Se a conexão estiver instável/caída, o usuário não consegue trocar de chip — fica sem saída.

## Mudanças (somente UI, sem mexer em lógica de negócio)

### 1. Um único botão "Reconectar chip" — no `ConnectionPanel`

- **Remover** o botão `Reconectar chip` do header do `InstanceHealth.tsx` (e o Dialog do QR que vai junto).
- **Manter / reforçar** o botão `Reconectar` que já existe no `ConnectionPanel` (estado `disconnected`) e **adicionar a mesma ação também no estado `connected`**, ao lado do `Desconectar`, usando a edge function `evolution-instance-reconnect` (que já criamos) para garantir logout forçado + novo QR.
- Resultado: só **um** botão "Reconectar chip" visível, sempre no mesmo lugar (`ConnectionPanel`), tanto quando está conectado quanto quando caiu.

### 2. Botão "Desconectar" sempre disponível

Adicionar o `Desconectar` também nos estados:
- `showDisconnectedWithInstance` (conexão perdida) — para o usuário poder zerar a instância e conectar outro chip.
- `showConnectingWithQr` / `showConnectingWithoutQr` — já existe como "Cancelar conexão"; manter, só padronizar rótulo para "Desconectar / trocar chip".

Mantém o `AlertDialog` de confirmação que já existe (linha 490 do `ConnectionPanel.tsx`).

### 3. Renomear "Liberar" para deixar claro que NÃO é reconexão

No `InstanceHealth.tsx`, dentro do bloco de modo recuperação:
- Trocar rótulo `Liberar — chip reconectado e estável` por **`Encerrar modo recuperação (destravar envios)`**.
- Atualizar o texto explicativo acima para deixar explícito: "Este botão só destrava os disparos automáticos. Para trocar de chip / gerar QR novo, use **Reconectar chip** no painel de conexão acima."

### 4. Ajuste cosmético no header do `InstanceHealth`

Como o botão de reconectar sai daqui, sobra só `Pausar envios por 24h`. Mantemos como está, só removendo o `Dialog` do QR e os estados `reconnectOpen / qrBase64 / pairingCode / reconnectLoading` que ficam órfãos.

## Arquivos afetados

- `src/components/whatsapp/InstanceHealth.tsx` — remover botão + Dialog QR + estados; renomear "Liberar".
- `src/components/whatsapp/ConnectionPanel.tsx` — adicionar `Reconectar` no estado conectado; adicionar `Desconectar` no estado desconectado-com-instância; padronizar "Cancelar conexão" → "Desconectar".
- (talvez) `src/components/whatsapp/WhatsAppTab.tsx` — o `Reconectar` da barra amarela superior (linha 257) é diferente: chama `createAndConnect()` e é só um atalho rápido. Pode permanecer porque é contextual à barra de aviso, mas posso remover se você preferir uma única entrada absoluta. **Pergunta:** remover esse também?

## Validação

- Conectado → vejo `[Reconectar chip]` + `[Desconectar]` lado a lado.
- Desconectado (com instância) → vejo `[Reconectar]` + `[Desconectar]` + `[Resetar]`.
- Em modo recuperação → o botão verde no painel de saúde agora diz `Encerrar modo recuperação`, sem ambiguidade.
- Nenhuma duplicata de "Reconectar chip" no mesmo card.
