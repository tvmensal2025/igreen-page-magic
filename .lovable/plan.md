## Diagnóstico

Confirmei ao vivo, agora, chamando a Whapi com o seu token:

- `GET /health` → HTTP 200, mas `status.code = 5 (ERROR)`. Códigos Whapi: `3=AUTH` (ok), `2=QR` (aguardando scan), `5=ERROR` (não pareado), `6=OFFLINE`.
- Token e webhook estão certos. O que não está OK é o **estado do canal no lado da Whapi**.

Isso não é código nosso — é o WhatsApp que não completou o pareamento ou caiu depois. Trocar token não muda nada.

## O que vou construir para destravar

### 1. Painel de diagnóstico ao vivo (em `WhapiConnectionPanel.tsx`)

Substituir o texto atual "Telefone conectado: …" por um bloco que mostra em tempo real:

```
Whapi /health
├─ HTTP status: 200
├─ status.code: 5 (ERROR)
├─ user.id: 553498239056
├─ channel_id: SHAZAM-A79TY
├─ webhook: ✅ correto
└─ Última verificação: 14:14:47
```

Atualiza a cada 5s. Cores por estado (verde AUTH, amarelo QR/INIT, vermelho ERROR/OFFLINE).

Assim você e eu vemos o mesmo estado da Whapi, e ficamos com certeza se é ERROR ou AUTH.

### 2. `whapi-proxy` — melhorar o `mapWhapiError`

Antes de devolver `invalid_token` num 401, o proxy chama `/health`:
- `/health 200 + code=3` → surpresa, canal está OK → devolve o erro original real.
- `/health 200 + code=5|6` → devolve novo `reasonCode: "channel_error"` com mensagem "Canal desautenticado (Whapi status ERROR). Reescaneie o QR."
- `/health 401` → aí sim `invalid_token`.

Nada de mensagem enganosa.

### 3. Botão "Reautenticar canal" em um clique

No mesmo painel, adicionar botão único que:
1. Chama `whapi-proxy { action: "logout" }`.
2. Espera 2s.
3. Chama `whapi-proxy { action: "request_qr" }` e mostra o QR.
4. Faz polling de `/health` a cada 3s até `code=3`.
5. Ao virar AUTH, some com o QR, mostra "Canal reconectado ✅" e habilita o botão de importar histórico.

### 4. Refresh do webhook (garantia)

Adicionar action `refresh_webhook` no `whapi-proxy` que faz `PATCH /settings` mandando o webhook correto para `whapi-webhook`. Rodo essa action uma vez após reautenticação para ter certeza de que o webhook não caiu. (Hoje já está OK, mas é blindagem.)

## O que você precisa fazer

Depois do deploy:
1. Abrir Admin → Conexão Whapi. O novo bloco de diagnóstico vai mostrar exatamente qual é o `status.code` do canal agora mesmo.
2. Se aparecer `code=5 (ERROR)`: clique em **Reautenticar canal**, escaneie o QR de novo, confirme que virou `code=3 (AUTH)`.
3. Se aparecer `code=3 (AUTH)`: aí sim clique em **Importar histórico completo**.

## O que NÃO vou fazer

- Não vou "trocar o token" — ele já está salvo, correto e a Whapi está aceitando (HTTP 200).
- Não vou tocar em `whapi-history-backfill` — vai funcionar automaticamente quando `code=3`.
- Não posso escanear o QR por você.