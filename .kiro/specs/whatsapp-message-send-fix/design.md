> ⚠️ FONTE DE VERDADE WA = **Whapi** (não Evolution). Este spec pode estar defasado — siga `.kiro/steering/regras-duras.md` + `wa-webhook.md`. Ver `.kiro/specs/STATUS.md`.

# WhatsApp Message Send Fix — Bugfix Design

## Overview

O arquivo `src/services/evolutionApi.ts` faz chamadas HTTP diretas à Evolution API na VPS, expondo a apikey no frontend e ignorando o proxy Supabase Edge Function (`evolution-proxy`). O fix consiste em reescrever a função interna `request()` para rotear todas as chamadas pelo proxy Supabase, usando autenticação via `supabase.auth.getSession()`. Nenhuma assinatura de função exportada muda — apenas o transporte interno é substituído.

## Glossary

- **Bug_Condition (C)**: Qualquer chamada feita por `request()` em `evolutionApi.ts` — atualmente todas vão direto à VPS em vez de passar pelo proxy Supabase
- **Property (P)**: Todas as chamadas de `request()` devem ser roteadas pelo proxy Supabase (`{SUPABASE_URL}/functions/v1/evolution-proxy`) com headers de autenticação Supabase e body no formato `{ path, method, body }`
- **Preservation**: Todas as funções exportadas (`sendTextMessage`, `sendMedia`, `sendAudio`, `sendDocument`, `createInstance`, `connectInstance`, `getConnectionState`, `deleteInstance`, `logoutInstance`, `fetchInstances`, `findChats`, `findMessages`, `findContacts`, `markAsRead`, `getProfilePicture`, `getBase64FromMediaMessage`) devem manter assinaturas idênticas e retornar os mesmos tipos de dados
- **`request()`**: Função interna em `src/services/evolutionApi.ts` que executa o `fetch()` — único ponto de mudança
- **`evolution-proxy`**: Supabase Edge Function em `supabase/functions/evolution-proxy/index.ts` que recebe `{ path, method, body }` e faz a chamada real à Evolution API com a apikey server-side
- **`normalizeQrBase64`**: Helper interno usado por `createInstance` e `connectInstance` para normalizar o campo base64 do QR code

## Bug Details

### Bug Condition

O bug se manifesta em toda chamada feita por `request()` em `evolutionApi.ts`. A função constrói a URL diretamente com `VITE_EVOLUTION_API_URL` e envia a `VITE_EVOLUTION_API_KEY` como header, em vez de rotear pelo proxy Supabase.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { path: string, method: string, body?: unknown }
  OUTPUT: boolean

  RETURN request() envia fetch() para VITE_EVOLUTION_API_URL/{path}
         AND request() inclui header apikey = VITE_EVOLUTION_API_KEY
         AND request() NÃO envia para {SUPABASE_URL}/functions/v1/evolution-proxy
         AND request() NÃO inclui Authorization: Bearer {supabase_access_token}
END FUNCTION
```

### Examples

- `sendTextMessage("inst", "5511999999999", "Olá")` → Atual: `fetch("https://igreen-evolution-api.b099mi.easypanel.host/message/sendText/inst", { headers: { apikey: "429683..." } })` → Esperado: `fetch("{SUPABASE_URL}/functions/v1/evolution-proxy", { method: "POST", headers: { Authorization: "Bearer {token}", apikey: "{anon_key}" }, body: { path: "message/sendText/inst", method: "POST", body: { number: "5511999999999", text: "Olá" } } })`
- `getConnectionState("inst")` → Atual: `fetch("https://igreen-evolution-api.../instance/connectionState/inst", { method: "GET", headers: { apikey: "429683..." } })` → Esperado: proxy POST com `{ path: "instance/connectionState/inst", method: "GET" }`
- `createInstance("inst")` → Atual: chamada direta à VPS → Esperado: proxy POST com `{ path: "instance/create", method: "POST", body: { instanceName: "inst", qrcode: true, integration: "WHATSAPP-BAILEYS" } }`
- `findChats("inst")` → Atual: chamada direta → Esperado: proxy POST com `{ path: "chat/findChats/inst", method: "POST", body: {} }`

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Todas as assinaturas de funções exportadas permanecem idênticas (parâmetros e tipos de retorno)
- Todas as interfaces/tipos exportados (`EvolutionChat`, `EvolutionMessage`, `EvolutionContact`) permanecem idênticos
- `normalizeQrBase64` continua funcionando internamente para `createInstance` e `connectInstance`
- `createInstance` continua retornando `{ instance, qrcode }` com base64 normalizado
- `connectInstance` continua retornando `{ base64, pairingCode }` normalizados
- `sendTextMessage`, `sendMedia`, `sendAudio`, `sendDocument` continuam retornando `{ key: { id: string } }`
- `findChats`, `findMessages`, `findContacts` continuam retornando arrays tipados
- `getProfilePicture` continua retornando `string | null`
- `getBase64FromMediaMessage` continua retornando `{ base64?, mimetype? } | null`

**Scope:**
O proxy retorna a mesma estrutura JSON da Evolution API — portanto todos os 9 arquivos consumidores (`messageSender.ts`, `useMessages.ts`, `useChats.ts`, `useWhatsApp.ts`, `KanbanBoard.tsx`, `MessagePanel.tsx`, `CustomerManager.tsx`, `ChatView.tsx`, `BulkSendPanel.tsx`) continuam funcionando sem alteração.

## Hypothesized Root Cause

A causa raiz é direta e confirmada pela leitura do código:

1. **Chamada direta à VPS**: A função `request()` constrói `url = ${BASE_URL}/${path}` onde `BASE_URL` vem de `import.meta.env.VITE_EVOLUTION_API_URL`, fazendo chamadas diretas à VPS da Evolution API
2. **Apikey exposta no frontend**: A função `headers()` retorna `{ "Content-Type": "application/json", apikey: API_KEY }` onde `API_KEY` vem de `import.meta.env.VITE_EVOLUTION_API_KEY`, expondo a chave no bundle do cliente
3. **Sem autenticação Supabase**: Não há import do cliente Supabase, não há chamada a `supabase.auth.getSession()`, e não há header `Authorization: Bearer`
4. **Sem formato de proxy**: O body é enviado diretamente como payload da Evolution API, em vez de ser encapsulado no formato `{ path, method, body }` que o proxy espera

## Correctness Properties

Property 1: Bug Condition - Proxy Routing

_For any_ chamada a `request(path, method, body)`, a função fixa SHALL enviar um `fetch()` POST para `{SUPABASE_URL}/functions/v1/evolution-proxy` com headers `Authorization: Bearer {access_token}` e `apikey: {SUPABASE_PUBLISHABLE_KEY}`, e body JSON `{ path, method, body }` (omitindo `body` quando não há payload).

**Validates: Requirements 2.1, 2.2**

Property 2: Bug Condition - Error Handling

_For any_ chamada a `request()` que resulte em erro, a função fixa SHALL: lançar "Erro de autenticação com a API do WhatsApp" para status 401, lançar "Erro de conexão. Verifique sua internet." para TypeError, e lançar o statusText para outros erros HTTP.

**Validates: Requirements 2.3, 2.4, 2.5**

Property 3: Preservation - Function Signatures and Return Types

_For any_ chamada a qualquer função exportada de `evolutionApi.ts` com os mesmos argumentos, a função fixa SHALL produzir o mesmo tipo de retorno e a mesma estrutura de dados que a função original (dado que o proxy retorna a mesma resposta JSON da Evolution API).

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9**

## Fix Implementation

### Changes Required

Assumindo que a análise de causa raiz está correta (confirmada pela leitura do código):

**File**: `src/services/evolutionApi.ts`

**Function**: `request()`

**Specific Changes**:

1. **Adicionar import do Supabase client**: Importar `supabase` de `@/integrations/supabase/client` no topo do arquivo

2. **Definir constantes do proxy**: Substituir `BASE_URL` e `API_KEY` (da Evolution API) por `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` apontando para o proxy
   - `SUPABASE_URL = "https://zlzasfhcxcznaprrragl.supabase.co"`
   - `SUPABASE_PUBLISHABLE_KEY` = anon key do client.ts
   - `PROXY_URL = ${SUPABASE_URL}/functions/v1/evolution-proxy`

3. **Remover função `headers()`**: Não é mais necessária — os headers agora são de autenticação Supabase

4. **Reescrever `request()`**:
   - Obter `access_token` via `supabase.auth.getSession()`
   - Fazer `fetch(PROXY_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer {token}", apikey: SUPABASE_PUBLISHABLE_KEY }, body: JSON.stringify({ path, method, body }) })`
   - Tratar erros: 401 → "Erro de autenticação com a API do WhatsApp", TypeError → "Erro de conexão. Verifique sua internet.", outros → `res.statusText`

5. **Manter `normalizeQrBase64`**: Sem alteração — continua sendo usado por `createInstance` e `connectInstance`

6. **Manter todas as funções exportadas**: Nenhuma alteração nas funções exportadas — elas continuam chamando `request()` com os mesmos argumentos

## Testing Strategy

### Validation Approach

A estratégia de testes segue duas fases: primeiro, demonstrar o bug no código não-fixado (chamadas diretas à VPS), depois verificar que o fix roteia corretamente pelo proxy e preserva o comportamento existente.

### Exploratory Bug Condition Checking

**Goal**: Demonstrar que o código atual faz chamadas diretas à VPS em vez de usar o proxy. Confirmar a causa raiz.

**Test Plan**: Escrever testes que mockem `fetch` e verifiquem a URL e headers usados por `request()`. Rodar no código NÃO-FIXADO para observar as falhas.

**Test Cases**:
1. **Direct URL Test**: Verificar que `sendTextMessage` chama `fetch` com URL contendo `VITE_EVOLUTION_API_URL` (vai passar no código não-fixado, confirmando o bug)
2. **Missing Auth Test**: Verificar que `createInstance` NÃO envia header `Authorization: Bearer` (vai passar no código não-fixado, confirmando ausência de auth Supabase)
3. **Exposed Apikey Test**: Verificar que `getConnectionState` envia header `apikey` com valor de `VITE_EVOLUTION_API_KEY` (vai passar no código não-fixado, confirmando exposição)
4. **Wrong Body Format Test**: Verificar que `sendTextMessage` envia body diretamente em vez de `{ path, method, body }` (vai passar no código não-fixado)

**Expected Counterexamples**:
- URL de fetch contém `VITE_EVOLUTION_API_URL` em vez de `/functions/v1/evolution-proxy`
- Headers contêm `apikey: VITE_EVOLUTION_API_KEY` em vez de `Authorization: Bearer {token}`
- Body é o payload direto da Evolution API em vez do formato proxy

### Fix Checking

**Goal**: Verificar que para todas as chamadas onde o bug condition se aplica, a função fixa produz o comportamento esperado.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := request_fixed(input.path, input.method, input.body)
  ASSERT fetch foi chamado com URL contendo "/functions/v1/evolution-proxy"
  ASSERT fetch headers contêm Authorization: Bearer {token}
  ASSERT fetch headers contêm apikey: {SUPABASE_PUBLISHABLE_KEY}
  ASSERT fetch body === { path: input.path, method: input.method, body: input.body }
  ASSERT fetch method === "POST"
END FOR
```

### Preservation Checking

**Goal**: Verificar que para todas as entradas onde o bug condition NÃO se aplica (funções exportadas com mesmos argumentos), a função fixa produz o mesmo resultado.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT request_original(input) = request_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing é recomendado para preservation checking porque:
- Gera muitos casos de teste automaticamente para diferentes combinações de path/method/body
- Captura edge cases que testes manuais podem perder
- Garante que o comportamento é preservado para todas as funções exportadas

**Test Plan**: Observar o comportamento no código NÃO-FIXADO para as funções exportadas, depois escrever testes property-based capturando esse comportamento.

**Test Cases**:
1. **createInstance Preservation**: Verificar que `createInstance("inst")` continua enviando `{ instanceName: "inst", qrcode: true, integration: "WHATSAPP-BAILEYS" }` para path `instance/create` com method `POST`, e retorna `{ instance, qrcode }` com base64 normalizado
2. **connectInstance Preservation**: Verificar que `connectInstance("inst")` continua retornando `{ base64, pairingCode }` normalizados
3. **sendTextMessage Preservation**: Verificar que `sendTextMessage("inst", "phone", "text")` continua enviando `{ number: "phone", text: "text" }` para path `message/sendText/inst`
4. **Error Handling Preservation**: Verificar que erros 401, TypeError e outros HTTP são tratados com as mensagens corretas em português

### Unit Tests

- Testar que `request()` chama `supabase.auth.getSession()` para obter o token
- Testar que `request()` envia POST para a URL do proxy com headers corretos
- Testar que `request()` encapsula path/method/body no formato proxy
- Testar tratamento de erro 401 → mensagem de autenticação
- Testar tratamento de TypeError → mensagem de conexão
- Testar tratamento de outros erros HTTP → statusText
- Testar que `normalizeQrBase64` continua funcionando

### Property-Based Tests

- Gerar paths aleatórios (instance/*, chat/*, message/*) e verificar que todos são roteados pelo proxy
- Gerar combinações de method (GET, POST, PUT, DELETE) e verificar que o proxy sempre recebe POST com o method original no body
- Gerar bodies aleatórios e verificar que são encapsulados corretamente no formato `{ path, method, body }`

### Integration Tests

- Testar fluxo completo de `sendTextMessage` → proxy → resposta
- Testar que `useMessages.ts` continua funcionando com o `evolutionApi.ts` fixado
- Testar que `KanbanBoard.tsx` auto-messages continuam funcionando via proxy
