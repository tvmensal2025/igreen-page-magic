# Corrigir Suporte Remoto travado em "Conectando…"

## Problema

Depois que o consultor autoriza com o código, a sessão fica em `active`, mas no painel do operador a tela continua em "Conectando…" eternamente.

**Causa raiz (handshake WebRTC fora de ordem):**

1. Assim que a sessão vira `active`, o operador chama `createOperatorPeer` e dispara o `offer` no canal de broadcast `support:<id>:rtc`.
2. O consultor **só assina** esse canal quando clica em **"Compartilhar tela"** (dentro de `createRequesterPeer`).
3. Supabase Realtime broadcast **não enfileira** mensagens — quem não está inscrito perde a oferta. Resultado: o operador fica esperando um `answer` que nunca chega → "Conectando…" infinito.

Mesmo se o consultor clicar em "Compartilhar tela" depois, ele só recebe ofertas **futuras**, e o operador não envia outra.

## Solução

Inverter o papel: o **consultor (requester) vira o offerer**, e o operador apenas escuta. Assim a oferta só é enviada depois que o consultor já compartilhou a tela (já tem `MediaStream` + `DataChannel`), garantindo que o operador (que está inscrito desde que a sessão ficou `active`) receba.

### Mudanças

**`src/features/remote-support/screenShare.ts`**
- `createRequesterPeer`: passa a criar o `RTCDataChannel("cmd")` e o `offer`. Após `getDisplayMedia` + `addTrack`, faz `setLocalDescription(offer)` e envia `{type:"offer"}`. Trata `answer` recebido do operador.
- `createOperatorPeer`: remove a criação do data channel e do offer. Usa `pc.ondatachannel` para receber o canal do requester, `pc.ontrack` continua igual. Ao receber `{type:"offer"}`, faz `setRemoteDescription` → `createAnswer` → envia `{type:"answer"}`.
- Mantém troca de ICE candidates nos dois lados.

**`src/pages/SuperAdminRemoteSupport.tsx` (workbench)**
- Mantém a chamada a `createOperatorPeer` quando `status === "active"` (ele agora só assina e espera). O overlay "Conectando…" continua até `ondatachannel` abrir.
- Mensagem "Aguardando o consultor clicar em Compartilhar tela" segue válida.

**`src/features/remote-support/useRequesterSession.ts`**
- Sem mudanças de fluxo: `startScreenShare` continua sendo disparado pelo botão. Como o requester agora é offerer, a oferta sai **depois** do clique, momento em que o operador já está inscrito.

### Fora de escopo
- UI/textos do banner.
- Lógica de código rotativo e verificação (já funciona — a sessão chega corretamente em `active`).
- Comandos remotos (navigate/click/fill) — o data channel continua chamado `"cmd"` e o handler do consultor é o mesmo.

## Validação

1. Operador aceita pedido → consultor lê código → operador valida → sessão `active`.
2. Painel mostra "Aguardando consultor clicar em Compartilhar tela".
3. Consultor clica em **Compartilhar tela** no banner vermelho → escolhe a aba/tela.
4. Esperado: vídeo aparece no painel do operador em poucos segundos e o log mostra "🟢 Canal de comandos aberto".
