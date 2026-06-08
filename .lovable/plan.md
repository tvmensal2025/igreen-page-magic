## Auditoria do suporte remoto

Não dá para afirmar com 100% de certeza que vai funcionar em todos os casos ainda. O fluxo melhorou, mas a auditoria encontrou pontos que ainda podem deixar o painel preso em “Conectando…”.

### O que está OK

- O provedor de suporte remoto está montado globalmente no app, então o consultor consegue receber a sessão em qualquer tela: `src/App.tsx:104`.
- A sessão sai de `pending_code` para `active` corretamente depois do código válido: `supabase/functions/remote-support-verify-code/index.ts:78-80`.
- O operador cria o peer quando a sessão fica `active`: `src/pages/SuperAdminRemoteSupport.tsx:235-265`.
- O fluxo atual já tenta evitar perda de `offer` usando `ready` e retry: `src/features/remote-support/screenShare.ts:95-112` e `src/features/remote-support/screenShare.ts:165-190`.

### Problemas encontrados

1. **A tela mostra “Conectando…” antes da tentativa WebRTC real**
   - Hoje o painel define `connecting=true` assim que a sessão fica `active`: `src/pages/SuperAdminRemoteSupport.tsx:235-237`.
   - Ele só remove “Conectando…” quando chega vídeo ou DataChannel: `src/pages/SuperAdminRemoteSupport.tsx:242-247`.
   - Se o consultor ainda não clicou em “Compartilhar tela”, o operador vê “Conectando…” mesmo sem conexão em andamento.
   - Isso bate com o histórico: a última sessão ficou `active`, mas não registrou `screen_started`; ou seja, entrou na sessão mas a tela não começou a ser compartilhada.

2. **Retry de offer pode recriar offer no estado errado**
   - O requester faz `createOffer()` de novo se ainda estiver em `have-local-offer`: `src/features/remote-support/screenShare.ts:186-190`.
   - Isso pode gerar erro de estado no WebRTC ou deixar a sinalização inconsistente.
   - O correto é reenviar a mesma `localDescription` quando já existe uma offer pendente, não criar outra.

3. **`ready` duplicado pode causar renegociação desnecessária**
   - Ao receber `ready`, o requester força `offerSent=false` e chama `sendOffer()`: `src/features/remote-support/screenShare.ts:165-169`.
   - Se já houver uma offer local pendente, isso pode tentar criar outra offer.
   - O correto é tratar `ready` como “reenviar offer atual se existir” ou “criar offer só se o estado estiver estável”.

4. **Sem TURN, não há garantia em redes restritas**
   - A configuração usa apenas STUN Google: `src/features/remote-support/screenShare.ts:14-19`.
   - Em algumas redes corporativas, CGNAT ou NAT simétrico, STUN não basta.
   - Sem servidor TURN, WebRTC pode ficar em `checking/failed` mesmo com código correto e tela compartilhada.

5. **Estado visual depende do DOM, não de estado React**
   - O placeholder usa `videoRef.current?.srcObject` diretamente no render: `src/pages/SuperAdminRemoteSupport.tsx:330`.
   - Como `srcObject` não é estado React, a tela pode não refletir corretamente a fase real.
   - Deve existir um estado explícito, por exemplo `hasStream` e `rtcStage`.

6. **Fluxo iniciado pelo operador tem risco no aceite do consultor**
   - O diálogo do consultor chama `acceptSession()`: `src/features/remote-support/IncomingOperatorRequestDialog.tsx:31-35`.
   - Mas a função `remote-support-accept` exige Super Admin: `supabase/functions/remote-support-accept/index.ts:40-41`.
   - Se o consultor comum autorizar uma sessão iniciada pelo operador, esse aceite pode falhar ou depender de um fluxo inconsistente.

## Plano de correção

### 1. Separar os estados da conexão no painel do operador

Trocar o booleano `connecting` por uma fase explícita:

```text
idle -> waiting_share -> offer_received -> connecting -> connected -> failed
```

Resultado esperado:

- Depois do código: mostrar “Aguardando o consultor clicar em Compartilhar tela”.
- Quando chegar offer: mostrar “Conectando…”.
- Quando chegar vídeo: mostrar a tela.
- Se falhar: mostrar erro claro e botão “Tentar novamente”.

Arquivos:

- `src/pages/SuperAdminRemoteSupport.tsx`
- `src/features/remote-support/screenShare.ts`

### 2. Corrigir o envio/reenvio de offer

Ajustar `createRequesterPeer` para:

- Criar nova offer apenas quando `pc.signalingState === "stable"`.
- Se já existir `pc.localDescription` com offer, apenas reenviar essa mesma SDP.
- No retry, não chamar `createOffer()` em `have-local-offer`.
- Registrar estados como `offer-created`, `offer-resent`, `answer-received`, `ice-connected`, `failed`.

Arquivo:

- `src/features/remote-support/screenShare.ts`

### 3. Fortalecer o lado operador contra mensagens duplicadas

Ajustar `createOperatorPeer` para:

- Ignorar offers duplicadas quando já estiver conectado.
- Responder offer de forma idempotente quando estiver em estado aceitável.
- Emitir estados `subscribed`, `waiting-offer`, `offer-received`, `answer-sent`, `stream-received`.

Arquivo:

- `src/features/remote-support/screenShare.ts`

### 4. Corrigir o fluxo iniciado pelo operador

Separar autorização do consultor de aceite do Super Admin:

- Criar ou ajustar função para permitir que o próprio requester autorize sessão `initiated_by='operator'`.
- Garantir que o código seja retornado diretamente para o consultor que autorizou, além do broadcast, para evitar perda de mensagem realtime.
- Manter Super Admin como único operador que valida código e assume controle.

Arquivos:

- `supabase/functions/remote-support-accept/index.ts`
- `src/features/remote-support/IncomingOperatorRequestDialog.tsx`
- `src/features/remote-support/api.ts`

### 5. Adicionar diagnóstico visível e logs de falha

Registrar no log da sessão:

- `rtc_operator_waiting_share`
- `rtc_requester_offer_sent`
- `rtc_operator_answer_sent`
- `rtc_connected`
- `rtc_failed`
- `screen_permission_denied`

Isso permite saber se travou por falta de clique, permissão negada, SDP, ICE ou rede.

Arquivos:

- `src/features/remote-support/useRequesterSession.ts`
- `src/pages/SuperAdminRemoteSupport.tsx`
- `src/features/remote-support/api.ts`

### 6. Preparar suporte a TURN

Manter STUN como fallback, mas permitir configurar TURN por variável segura quando disponível.

Sem TURN, o sistema pode funcionar em muitas redes, mas não dá para garantir 100%.

Arquivo:

- `src/features/remote-support/screenShare.ts`

## Como vou validar depois da implementação

- Conferir se a sessão muda `requested -> pending_code -> active`.
- Confirmar que o operador vê “aguardando compartilhamento” antes do clique do consultor.
- Confirmar que, após “Compartilhar tela”, chegam `offer`, `answer`, ICE e vídeo.
- Confirmar que o painel sai de “Conectando…” ao receber stream.
- Confirmar logs de sucesso/falha para saber onde travou se acontecer novamente.