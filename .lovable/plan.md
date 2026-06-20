## Diagnóstico (cliente SUELI APARECIDA, id 40907186…)

Rastreei a conversa + banco + código e achei a causa raiz da falha.

### 1. OTP nunca chegou ao Portal 2 (causa raiz do "facial não chegou")

O cliente respondeu `334122` no WhatsApp. O `otp-intercept` (e o `submit-otp`) chamam o endpoint do worker assim:

```
POST {WORKER}/confirm-otp
body: { customer_id, otp_code }
```

Mas o `worker-portal-2/server.mjs` linha 1034 exige:

```js
const { idconsultor, idcliente, code, customer_id } = req.body || {};
if (!idconsultor || !idcliente || !code) return 400 'idconsultor, idcliente, code obrigatórios';
```

→ O worker devolve **400 imediato**. Como o cliente captura o erro silenciosamente (`catch` sem retry), o OTP é salvo no banco e nunca validado no portal. Sem validação, o backend iGreen não emite `link_assinatura`/facial. Cliente fica eternamente em `awaiting_otp`.

Confirmado no banco: `otp_code=334122`, `otp_received_at=14:28:55`, `portal2_otp_validated_at=null`, `link_facial=null`.

### 2. CEP caiu no FAQ ("pediu o fluxo de pergunta de novo")

Quando ela enviou `13350026`, o `conversation_step` do banco estava em `c87d76f8…` (passo `d_como_funciona`), não em `ask_cep`. A entrada não casou com nenhum trigger do passo e o `fallback.goto_step_id` levou a `d_duvidas` (38c0d101). Algum caminho de "restart" do conversational engine reverteu o step para `d_como_funciona` entre o pedido do CEP e a resposta do cliente.

### 3. Faltam redes de segurança (retry/cron) para o pipeline cadastro→OTP→facial

`dispatchPortalWorker` tem 3 tentativas mas só na hora; depois marca `worker_offline` e não há cron varrendo isso. Idem para OTP — nenhum job retenta `/confirm-otp` quando o worker estava fora ou retornou erro.

---

## Plano (objetivo: nunca falhar e sempre chegar ao Portal)

### Passo 1 — Corrigir o payload do `/confirm-otp` (a correção de fato)

**`supabase/functions/evolution-webhook/handlers/otp-intercept.ts`**
- Antes de chamar o worker, carregar do `customers`:
  - `portal2_idcliente`
  - `consultants:consultant_id(igreen_id, portal_kind)`
  - `referral_partners:referral_partner_id(partner_igreen_id)`
- Resolver `idconsultor` com a mesma regra do `buildPortal2Payload` (parceiro tem precedência se tiver `partner_igreen_id`).
- Se `portal2_idcliente` ainda não existe (cadastro não foi pro portal antes do OTP), **disparar `dispatchPortalWorker` primeiro** e abortar o intercept dessa rodada (o cron do passo 3 finaliza).
- Enviar:
  ```json
  { "idconsultor": <num>, "idcliente": <portal2_idcliente>, "code": <otp>, "customer_id": <uuid> }
  ```
- Timeout 30 s (não 5 s — o worker faz polling do contrato).
- Em caso de !ok, registrar `last_otp_dispatch_error` e `last_otp_dispatch_at` no `customers` (campos novos, ver migration).
- Em caso de ok, atualizar localmente `status='validating_otp'` e `conversation_step='aguardando_facial'` (o worker já faz o update final com o link, mas a UI vê progresso na hora).

**`supabase/functions/submit-otp/index.ts`** — aplicar exatamente a mesma troca de payload + timeout (mantém compat com chamadas do frontend).

### Passo 2 — Endurecer `dispatchPortalWorker`

- Persistir `last_portal_dispatch_at` e `last_portal_dispatch_error` em `customers` (migration).
- Quando todas as 3 tentativas falharem, **não** sobrescrever `status` se já estiver em `awaiting_otp` / `awaiting_signature` / `complete` (evita regressão de step quando uma retentativa tardia roda).
- Log estruturado JSON pra facilitar o tail no Edge Functions.

### Passo 3 — Cron de garantia ("portal-otp-watchdog")

Nova função `supabase/functions/portal-otp-watchdog/index.ts`, agendada a cada **1 min** via `pg_cron` (já temos o setup).

Varre `customers` em 3 buckets:

| Bucket | Condição | Ação |
|---|---|---|
| A. Cadastro não despachado | `status IN ('cadastro_portal','portal_submitting','worker_offline','missing_documents')` AND `portal2_idcliente IS NULL` AND `updated_at < now() - 90s` | `dispatchPortalWorker(customer_id)` |
| B. OTP pendente no portal | `otp_code IS NOT NULL` AND `portal2_otp_validated_at IS NULL` AND `portal2_idcliente IS NOT NULL` AND `otp_received_at < now() - 30s` | reenviar `/confirm-otp` com payload correto |
| C. OTP validado sem link facial | `portal2_otp_validated_at IS NOT NULL` AND `link_facial IS NULL` AND `updated_at < now() - 60s` | chamar `/lead/:idcliente/status` no worker, pegar `linkassinatura`, salvar e enviar via WhatsApp |

Cada bucket com:
- limite de 20 leads por execução (não estoura worker);
- backoff exponencial via coluna `portal_retry_count` (zera quando avança de fase, +1 a cada retry, máx 10 antes de abrir alerta no `super-admin-alerts`).

### Passo 4 — Corrigir o desvio de step pós-CEP

No `_shared/cerebro/decisor-passo.ts` (e/ou conversational `index.ts` onde o restart-cascade roda):
- Quando `customer.conversation_step` começa com `ask_` (legacy) ou aponta para um `bot_flow_step` cujo `slot_key` está em (`cep`, `numero`, `email`, `complemento`), **não cascatear pro flow de FAQ/welcome** mesmo se o `fallback.goto_step_id` estiver setado — em vez disso, repetir o próprio passo com mensagem "❌ não entendi, me manda só o CEP".
- Garantir que o `flow-router` não troca o `conversation_step` enquanto `pending_slot` ainda estiver pendente (gate no `flow-selectors/openingStep.ts`).

### Passo 5 — Migration

Nova migration adicionando:
```sql
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS last_portal_dispatch_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_portal_dispatch_error text,
  ADD COLUMN IF NOT EXISTS last_otp_dispatch_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_otp_dispatch_error text,
  ADD COLUMN IF NOT EXISTS portal_retry_count int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_customers_otp_pending
  ON public.customers (otp_received_at)
  WHERE otp_code IS NOT NULL AND portal2_otp_validated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customers_portal_pending
  ON public.customers (updated_at)
  WHERE portal2_idcliente IS NULL AND status IN ('cadastro_portal','portal_submitting','worker_offline','missing_documents');
```

E job no `cron`:
```sql
SELECT cron.schedule('portal-otp-watchdog','*/1 * * * *',
  $$ SELECT net.http_post(...portal-otp-watchdog...) $$);
```

### Passo 6 — Hotfix da SUELI

Após o deploy, rodar via SQL (uma vez):
```sql
UPDATE customers SET status='awaiting_otp', updated_at=now()-interval '2 min'
WHERE id='40907186-4789-4eaf-82bf-2de79f69b73c';
```
O watchdog (bucket B) reenvia o OTP com payload correto e ela recebe o link facial no WhatsApp em <1 min.

---

## Arquivos a tocar

1. `supabase/functions/evolution-webhook/handlers/otp-intercept.ts` — payload + timeout + resolução de `idconsultor/idcliente`.
2. `supabase/functions/submit-otp/index.ts` — idem.
3. `supabase/functions/_shared/portal-worker.ts` — não regredir status, gravar last_*_at/error.
4. `supabase/functions/portal-otp-watchdog/index.ts` — **novo** cron worker.
5. `supabase/functions/evolution-webhook/handlers/conversational/index.ts` (+ `flow-selectors/openingStep.ts`) — gate anti-desvio enquanto `pending_slot` está aberto.
6. Migration `supabase/migrations/<ts>_portal_otp_watchdog.sql` — colunas + índices + cron.

Sem mudanças no `worker-portal-2` (o contrato dele já está certo — o lado errado é o caller).

## Fora do escopo

- Reescrever o flow editor ou o motor de QA de fluxo.
- Mexer no Portal 1 (já descontinuado, `resolveWorker` força `autoconexao`).
- Mudar a UI de admin além do alerta já existente no `super-admin-alerts`.
