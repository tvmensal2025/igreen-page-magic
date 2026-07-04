## Diagnóstico

O canal Whapi (SHAZAM-A79TY, +55 34 9823-9056) está **funcional**:
- Painel Whapi: "WhatsApp API authorized"
- `GET /chats` retorna mensagens reais (envios recentes `from_me:true`)
- Webhook aponta corretamente para `whapi-webhook`

O bug é **nosso**: `whapi-proxy` faz `health_check` via `/health` e trata `status.code=5 ("ERROR")` como canal desautenticado (`channel_error` / OFFLINE), bloqueando o botão de importar histórico e mostrando banner vermelho. Mas `/health` do Whapi devolve `code=5` mesmo com o canal operando normalmente — a verdade está nos endpoints de dados.

## Correção

### 1. `supabase/functions/whapi-proxy/index.ts` — `health_check`
Substituir a lógica baseada no numérico de `/health` por uma **prova de vida real**:

- Chamar em paralelo: `GET /health` (informativo) + `GET /users/profile` (ou `GET /chats?count=1` como fallback).
- Regra nova:
  - Se `/users/profile` responder **200** → `status = "AUTH"`, `reasonCode = null`, canal OK (independente do code do `/health`).
  - Se responder **401/403** → `reasonCode = "invalid_token"`.
  - Se responder **402** → `reasonCode = "unpaid"`.
  - Se responder **404** com `channel not found` → `reasonCode = "channel_not_found"`.
  - Só devolver `channel_error` quando `/users/profile` falhar com erro específico de canal desautenticado (mensagem contendo "not authorized"/"logout"/"qr").
- Continuar retornando `statusCode` numérico do `/health` apenas como campo informativo no painel de diagnóstico (sem gatear o resto do UI).
- Manter validação do webhook (`webhookOk`).

### 2. `supabase/functions/whapi-proxy/index.ts` — `mapWhapiError`
Já existe o fallback que consulta `/health` antes de devolver `invalid_token`. Ajustar para também aceitar `/users/profile` OK como sinal de canal saudável — assim um 401 esporádico em outro endpoint não vira "token inválido" enganoso.

### 3. `src/components/whatsapp/WhapiConnectionPanel.tsx`
- Remover o bloqueio do botão **"Importar histórico completo"** quando `reasonCode === "channel_error"` isoladamente — passar a habilitar sempre que `status === "AUTH"`.
- No painel de Diagnóstico ao vivo, exibir `code=5` em amarelo (informativo) em vez de vermelho, quando `/users/profile` estiver OK.
- Manter banner de reautenticação apenas quando a nova regra realmente detectar desautenticação.

### 4. `src/hooks/useWhapiHealth.ts`
Sem mudança de contrato; apenas se beneficia do novo payload correto.

## Fora do escopo

- Não mexer no token (funciona).
- Não recriar/logout do canal (funciona).
- Não alterar `whapi-webhook` nem `whapi-history-backfill`.

## Resultado esperado

Após deploy, o painel Admin mostra status verde AUTH, sem banner falso de "canal desautenticado", e o botão **"Importar histórico completo"** fica liberado imediatamente.