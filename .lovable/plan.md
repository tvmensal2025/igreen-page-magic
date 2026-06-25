## Objetivo

Garantir que o ciclo do código (OTP) **sempre funcione** e termine com a entrega do link de assinatura/facial — a "mensagem chave de ouro".

## Esclarecimentos confirmados

- **"Chave de ouro"** = a mensagem final, calorosa, com nome e link de assinatura. Vai SÓ depois do código validado.
- **Código sempre vale** — não expira. Logo o fluxo de erro pode ser simples: nunca devolver "código inválido" como falha definitiva; sempre tratar como retry técnico.

## Causa-raiz do problema atual (confirmada no código)

1. **Webhook manda payload errado pro worker.**
   `whapi-webhook/index.ts` linha 446 envia `{ customer_id, otp_code }`.
   `worker-portal-2/server.mjs` linha 1036 exige `{ idconsultor, idcliente, code }`.
   → Worker responde 400, webhook ignora, validação nunca roda, link nunca sai.

2. **Webhook não checa a resposta do worker** (não há `res.ok`). Por isso a cliente recebeu "✅ Código recebido!" mesmo com tudo falhando.

3. **Auditoria IA bloqueada por JWT.**
   `portal2-ai-audit` não está declarado em `supabase/config.toml`, então o gateway exige JWT antes da função rodar. Worker manda `WORKER_SECRET` (não-JWT) → 401 antes mesmo da função checar o segredo.

## Plano de correção

### 1. Corrigir o payload do OTP no webhook

Arquivo: `supabase/functions/whapi-webhook/index.ts` (bloco linhas 415-470).

- Antes de chamar o worker, carregar do `customers` os campos `portal2_idcliente` e `consultant_id`, e do `consultants` o `igreen_id` correspondente.
- Montar payload correto:

```text
POST /confirm-otp
{ customer_id, idconsultor, idcliente, code }
```

- Sempre incluir `Authorization: Bearer ${workerSecret}`.
- Tratar a resposta com `res.ok`:
  - `200 ok` → bot fica em silêncio. O próprio worker dispara a mensagem chave de ouro com o link.
  - 4xx/5xx/timeout → resposta de retry simples: `"Recebi! Estou processando seu código, em alguns segundos te confirmo aqui."` Nada de "código inválido" (porque o código não expira).

### 2. Mensagem chave de ouro (worker)

Arquivo: `worker-portal-2/server.mjs`, função `sendFacialLinkToCustomer`.

Texto fixo, calorosa, com nome e fechamento:

```text
✅ {primeiroNome}, código confirmado!

Falta só 1 passinho pra ativar sua economia 💚

👉 Assine e faça sua validação facial:
{link}

Em ~2 minutos te confirmo aqui que ficou tudo certo. Bem-vindo(a) à iGreen!
```

- Pegar `primeiroNome` do `customers.name` (primeiro token, capitalizado).
- Enviar SOMENTE após `validateVerificationCode` retornar sucesso E o link estar resolvido (já tem fallback polling no worker).

### 3. Mensagem inicial (pedido do código) sem link

Arquivo: `worker-portal-2/server.mjs`, função `sendValidationLinkToCustomer` (que hoje envia link junto com OTP).

Trocar pra:

```text
{primeiroNome}, seu cadastro tá quase pronto! 🎯

Vou te mandar agora um código de 6 dígitos por SMS/e-mail.
Quando chegar, me responde aqui só os 6 números — eu cuido do resto. 💚
```

Sem link nessa etapa.

### 4. Worker tolerante e auto-suficiente

Handler `/confirm-otp` (linhas 1034-1103):

- Aceitar tanto `code` quanto `otp_code`.
- Se vier só `customer_id`, buscar `idcliente`/`idconsultor` no Supabase automaticamente (defesa contra integrações futuras).
- Como código nunca expira, retentar `validateVerificationCode` em loop curto (3 tentativas, 1s entre cada) antes de devolver erro.
- Em sucesso: gerar link, atualizar `customers` e disparar mensagem chave de ouro. Em falha real (idcliente não encontrado), gravar em `portal2_audit_traces` e responder 500 com `error_kind` explícito.

### 5. Replay automático: nenhum código se perde

Para o caso raro do código chegar antes do cadastro terminar:

- Quando o webhook receber OTP mas `portal2_idcliente` ainda for null, gravar `customers.otp_code` e marcar `otp_pending_replay=true`.
- A edge function `recover-stuck-otp` (já existe, roda em cron) vai detectar clientes com `otp_pending_replay=true` + `portal2_idcliente` preenchido e disparar `/confirm-otp` retroativamente.

### 6. Corrigir auditoria IA (problema 401 JWT)

- `supabase/config.toml`: adicionar

```text
[functions.portal2-ai-audit]
verify_jwt = false
```

- `portal2-ai-audit/index.ts`: erros mais explícitos (`audit_secret_not_configured`, `audit_secret_mismatch`) em vez de `unauthorized` genérico.
- `worker-portal-2/ai-audit.mjs`: quando vier 401/403, gravar mensagem acionável em vez de "Invalid JWT".

### 7. Sempre funcional, nunca desabilitada

- No boot do worker, fazer ping em `/portal2-ai-audit` com payload mínimo e logar `AI audit OK` ou erro claro.
- `GET /health` do worker passa a expor `ai_audit: { healthy, last_error }`.
- Variável `PORTAL2_AI_AUDIT_LIMIT=0` deixa de significar "desligado" (valor inválido → usa default 10). Pra desligar de propósito, exigir flag explícita `PORTAL2_AI_AUDIT_DISABLED=true`.

## Resultado esperado

1. Cliente termina cadastro → recebe mensagem 1 pedindo só o código.
2. Cliente digita 6 dígitos → webhook chama worker corretamente.
3. Worker valida na iGreen, busca link, envia mensagem chave de ouro com link.
4. Auditoria IA volta a registrar análise real, sem 401.
5. Se algo travar, retry automático garante que o cadastro fecha sozinho.

## Detalhes técnicos

Arquivos a editar:

```text
supabase/functions/whapi-webhook/index.ts       (payload OTP correto + tratamento de resposta)
worker-portal-2/server.mjs                      (/confirm-otp tolerante, msg inicial, msg chave de ouro, /health)
worker-portal-2/ai-audit.mjs                    (erro claro em 401/403)
supabase/functions/portal2-ai-audit/index.ts    (erros explícitos)
supabase/config.toml                            (verify_jwt=false p/ portal2-ai-audit)
supabase/functions/recover-stuck-otp/index.ts   (replay de OTP pendente)
```

Migração leve:

```sql
alter table public.customers
  add column if not exists otp_pending_replay boolean default false;
```

Secrets a conferir manualmente (não rotacionar agora):

```text
EasyPanel worker-portal-2: WORKER_SECRET
Supabase Edge Functions:   PORTAL2_WORKER_SECRET (mesmo valor)
Supabase Edge Functions:   GEMINI_API_KEY
```

Lucinéia segue intocada: nenhuma mensagem nova será enviada a ela durante a correção.