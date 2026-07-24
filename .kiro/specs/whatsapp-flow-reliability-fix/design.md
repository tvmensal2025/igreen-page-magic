> ⚠️ FONTE DE VERDADE WA = **Whapi** (não Evolution). Este spec pode estar defasado — siga `.kiro/steering/regras-duras.md` + `wa-webhook.md`. Ver `.kiro/specs/STATUS.md`.

# Bugfix Technical Design — WhatsApp Flow Reliability Fix

## 1. Solution Overview

Este bugfix é **conservador e incremental**. A arquitetura existente — Evolution API → Edge Function `evolution-webhook` → (`ai-agent-router` ou `runConversationalFlow` ou `runBotFlow` legado) → Supabase + MinIO — permanece intacta. Não vamos reescrever nenhum motor, nem trocar provedor, nem mudar contratos públicos consumidos pelo frontend (`KanbanBoard`, `MessagePanel`, `BulkSendPanel`, `evolution-proxy`).

A estratégia tem três pilares:

1. **Fonte única de verdade no banco** para coisas que hoje vivem em memória de cada container (rate limit, cooldown da IA, lock por conversa). Move o estado para Postgres com RPCs atômicas.
2. **Idempotência + serialização por `customer_id`** para eliminar duplicatas e ordem fora de sequência. Reserva atômica em `webhook_message_dedup` ANTES de qualquer leitura ou envio, e `pg_advisory_xact_lock(hashtext(customer_id))` para serializar webhooks do mesmo cliente.
3. **Hardening determinístico em torno da IA** para nunca permitir silêncio total ou alucinação solta: validação de `next_step` contra `bot_flow_steps`, filtro de IDs de mídia contra `relevantMedia`, fallback determinístico quando o LLM falha, e grounding contra `ai_knowledge_sections`.

A entrega é controlada por um feature flag por consultor (`consultants.flow_reliability_v2`) que permite dark-launch (apenas log, sem mudar comportamento), canary (5% dos consultores), e full rollout. Toggle off restaura o caminho atual em segundos.

Este design respeita integralmente as 28 cláusulas de **Unchanged Behavior (3.1–3.28)** do `bugfix.md`. Nenhum ponto do caminho feliz é tocado.

## 2. Bug Condition → Fix Mapping

| Cond | Sub-bug | Intervenção principal | Arquivo(s) afetado(s) |
|------|---------|------------------------|------------------------|
| 2.1 | B1 | Falha persistente em `inbound_media_failures` + reply explícito de reenvio + métrica `evolution_media_lost` | `_shared/evolution-api.ts`, `evolution-webhook/index.ts`, nova migração |
| 2.2 | B1 | Tabela `inbound_media_retry` com TTL + job `inbound-media-retry-cron` | nova Edge Function `inbound-media-retry-cron`, `_shared/minio-upload.ts`, nova migração |
| 2.3 | B1 | Em step conversacional com falha de download, manter `conversation_step` e pedir reenvio (não redirecionar) | `evolution-webhook/handlers/conversational/index.ts` |
| 2.4 | B1 | Fallback de download direto via `imageMessage.url`/`documentMessage.url` com headers da Evolution + persistência MinIO antes de seguir | `_shared/evolution-api.ts` (novo helper `downloadMediaFallback`) |
| 2.5 | B1 | Áudio passa a ter `isFile=true` quando o passo conversacional precisa de transcript; chamada a `ai-transcribe-media` | `evolution-webhook/_helpers.ts` (parseEvolutionMessage), `_shared/audio-transcript.ts` |
| 2.6 | B2 | `checkAndMarkProcessed` movido para o início absoluto, ANTES de `loadCustomer`; segundo executor curto-circuita | `evolution-webhook/index.ts`, `_shared/bot/dedupe.ts` |
| 2.7 | B2 | `sendWithRetry` recebe `idempotency_key` (hash determinístico por turno) registrado em `outbound_message_log` antes do envio; retentativas reusam a key | `_shared/evolution-api.ts`, nova migração `outbound_message_log` |
| 2.8 | B2 | Anti-dup textual passa a comparar por `message_text_hash` (lowercase + trim + normalização Unicode) por `(customer_id, conversation_step)` | `evolution-webhook/index.ts` |
| 2.9 | B2 | Contrato único `__inline_sent=true` respeitado em TODOS os ramos do bloco "10) Send reply" | `evolution-webhook/index.ts` |
| 2.10 | B2 | Quando `aiShouldHandle=true`, executar exclusivamente `ai-agent-router`; fallback determinístico só se router retornar erro/skipped | `evolution-webhook/index.ts` |
| 2.11 | B3 | `pg_advisory_xact_lock(hashtext(customer_id))` no início do processamento por turno | nova migração + `evolution-webhook/index.ts` |
| 2.12 | B3 | Roteador NÃO zera `conversation_step` se customer está em `CADASTRO_STEPS` quando flag muda | `_shared/flow-router.ts` |
| 2.13 | B3 | Antes de redirect hardcoded para `aguardando_conta`, checar se existe step `image_capture` em `bot_flow_steps` do consultor | `evolution-webhook/handlers/conversational/index.ts` |
| 2.14 | B3 | `auto-resume` aplica prefixo correto baseado em `engineUsed` em uma única update atômica | `_shared/flow-router.ts`, `evolution-webhook/handlers/step-namespace.ts` |
| 2.15 | B3 | Handlers usam `buttonId` como input primário antes de `messageText` | `evolution-webhook/handlers/conversational/index.ts`, `_shared/flow-router.ts` |
| 2.16 | B3 | Roteamento referencia `step_key` (estável) em vez de `position`; já é assim em vários pontos, garantir consistência total | revisão em `_shared/flow-router.ts` e handlers |
| 2.17 | B4 | Se consultor tem step com `is_opening=true` ou primeiro step da sequência, executar via `runConversationalFlow` em vez de `ai-agent-router` no welcome | `evolution-webhook/index.ts` (gate de `aiShouldHandle`) |
| 2.18 | B4 | Antes de gravar `next_step`, validar contra `bot_flow_steps[consultant_id].step_key ∪ CADASTRO_STEPS`; logar `ai_invalid_next_step` | `ai-agent-router/index.ts`, `_shared/ai-decisions.ts` |
| 2.19 | B4 | `aiDecideFallback` valida alcançabilidade do step a partir do atual; se inválido, `REPEAT` | `_shared/ai-faq-answerer.ts`, `_shared/flow-router.ts` |
| 2.20 | B4 | Redirect "foto fora de hora" só seta `aguardando_conta` se o engine `sys` esperar conta de luz | `evolution-webhook/handlers/conversational/index.ts` |
| 2.21 | B5 | Piso `min_typing_ms=2500` e proporcionalidade 60ms/char, teto 12s; `sendPresence` renovado a cada 2.5s | `_shared/human-pace.ts`, `_shared/evolution-api.ts` |
| 2.22 | B5 | Entre mídias: piso 800ms; após áudio/vídeo, esperar `min(60% * duration_sec, 8000ms)` | `_shared/step-media-order.ts` |
| 2.23 | B5 | Piso reduzido para respostas curtas (≤10 chars: 2000ms); teto 12s para longas | `_shared/human-pace.ts` |
| 2.24 | B5 | Falha de `sendPresence` gera log estruturado e reduz delay para piso mínimo | `_shared/evolution-api.ts` |
| 2.25 | B5 | Quando `ai-agent-router` aplica `should_pause_seconds`, ele assume responsabilidade do delay e webhook NÃO adiciona `humanDelayMs` | `evolution-webhook/index.ts`, `ai-agent-router/index.ts` |
| 2.26 | B5 | Se sequência ultrapassar 50s acumulados, restante vai para tabela `pending_outbound_media` enviada por `outbound-media-flush-cron` | nova Edge Function `outbound-media-flush-cron`, `_shared/step-media-order.ts`, nova migração |
| 2.27 | B6 | `sanitizeHumanReply` valida contra `ai_knowledge_sections` (preço, prazo, link, comissão); regex expandido + grounding numérico | `_shared/ai-decisions.ts`, `ai-agent-router/index.ts` |
| 2.28 | B6 | Filtra `media_to_send_ids` ⊆ `relevantMedia.id`; loga `ai_hallucinated_media_id` | `ai-agent-router/index.ts` |
| 2.29 | B6 | `audio_slot_key` inválido cai em fallback determinístico (boas_vindas se primeiro contato; senão ignora slot e usa reply_text/template) | `ai-agent-router/index.ts` |
| 2.30 | B6 | LLM falha → fallback determinístico (template do passo atual em `bot_flow_steps` ou frase padrão) | `ai-agent-router/index.ts` |
| 2.31 | B6 | Validar pré-condições antes de gravar `cadastro_portal`: `electricity_bill_value IS NOT NULL` AND `document_uploaded=true` | `ai-agent-router/index.ts` (precondition gate) |
| 2.32 | B6 | `answerFaqWithAI` prefere `bot_flow_qa.text_response` em match exato; LLM só parafraseia | `_shared/ai-faq-answerer.ts` |
| 2.33 | B7 | `webhook_rate_limit` table substitui `Map` em memória; RPC `try_acquire_rate_limit(phone, window_ms, max_count)` | `evolution-webhook/index.ts`, nova migração |
| 2.34 | B7 | `webhook_message_dedup` UNIQUE composto `(message_id, instance_name)`; helper `checkAndMarkProcessed(messageId, instanceName)` em todos call sites | `_shared/bot/dedupe.ts`, nova migração |
| 2.35 | B7 | `ai_cooldown_state` table substitui Map por instância; RPC `ai_cooldown_check_and_set(key, ttl)` | `_shared/bot/ai-cooldown.ts`, nova migração |
| 2.36 | B7 | `try_log_media_send` divide-se em `reserve_media_send` (`dispatch_status=reserved`) e `confirm_media_send` (`dispatch_status=sent`/`failed`); sem confirmação em 30s, libera para retry | `_shared/audit.ts` (try_log_media_send wrappers), nova migração |
| 2.37 | B7 | Lock por `customer_id` via `pg_advisory_xact_lock(hashtext(customer_id))` (mesmo de 2.11) | mesma migração de 2.11 |
| 2.38 | B7 | Token bucket por `consultant_id` para chamadas Gemini; quando estourar, fallback determinístico | `_shared/gemini.ts`, nova migração `gemini_quota_bucket` |

## 3. Architecture per Sub-Bug

### 3.1 B1 — Confiabilidade de mídia de entrada

**Pipeline atual:** webhook → `parseEvolutionMessage` → (se `isFile`) `downloadMedia` → (se sucesso) `uploadToMinioPath` → OCR/IA → fluxo. Falhas em qualquer ponto silenciam e seguem com `fileBase64=null`.

**Pipeline novo (preservando o feliz):**

```
webhook
  → parseEvolutionMessage (agora trata audioMessage também)
  → downloadMediaWithFallback   ── primary: getBase64FromMediaMessage
                                ── fallback: imageMessage.url / documentMessage.url + headers Evolution
  → se sucesso: uploadToMinioPath → OCR (mantido)
  → se download falhou: insert inbound_media_failures (persistente) + reply "reenvie por favor" + manter conversation_step
  → se download ok mas MinIO falhou: insert inbound_media_retry com base64 + TTL 1h
                                     + job inbound-media-retry-cron tenta MinIO até 3x
```

**Áudio:** `parseEvolutionMessage` passa a marcar `isFile=true` quando `audioMessage` está presente E o passo atual está em `CONVERSATIONAL_STEPS` (não em cadastro). Após download, chama `ai-transcribe-media` e passa o transcript no `messageText` para o roteador. Cadastro continua ignorando áudio (preserva 3.1, 3.2).

### 3.2 B2 — Anti-duplicação

**Ordem nova de processamento no `evolution-webhook/index.ts`:**

```
1. parseEvolutionMessage (early return em CONNECTION_UPDATE, grupos, self)
2. checkAndMarkProcessed(messageId, instanceName)  ← MOVIDO PARA AQUI (era depois de loadCustomer)
   → se já processado: return 200 { ok: true, mode: "deduped" }
3. acquireAdvisoryLock(customerId)  ← NOVO
   → BEGIN; SELECT pg_advisory_xact_lock(hashtext(customerId)); ...
4. loadCustomer + restante do pipeline
5. COMMIT (libera lock automaticamente ao final do xact)
```

**Idempotency key para outbound:** `_shared/evolution-api.ts:sendWithRetry` recebe `idempotency_key = sha256(customer_id|step|content|minute_bucket)`. Antes do envio, faz `INSERT INTO outbound_message_log(idempotency_key) ON CONFLICT DO NOTHING`. Se conflito, é redelivery e o helper retorna o resultado anterior em vez de reenviar.

**Anti-dup textual normalizado:** consulta passa a usar coluna gerada `message_text_hash` em `conversations` (lowercase + trim + NFKC + remove emoji variation selectors), comparando por `(customer_id, conversation_step, message_text_hash)` nos últimos 60s.

**Contrato `__inline_sent`:** o bloco `─── 10) Send reply ───` em `evolution-webhook/index.ts` ganha um único `if (updates.__inline_sent === true) skip; else send;` no topo, eliminando ramos paralelos.

**Exclusão mútua AI vs Flow:** quando `aiShouldHandle=true`, o webhook chama `ai-agent-router` e marca `mode = "ai_agent"`. O caminho `runConversationalFlow`/`runBotFlow` só executa se `aiResult.skipped === true` ou erro. Hoje há ramos onde ambos podem rodar; o gate fica explícito.

### 3.3 B3 — Consistência de fluxo

**Lock por customer:** ver 3.2. Garante que o segundo webhook do mesmo cliente espera o primeiro terminar antes de ler `customers.conversation_step`.

**Preservação de cadastro em flag flip:** `_shared/flow-router.ts:routeEngine` adiciona:

```ts
if (currentStep && CADASTRO_STEPS.has(currentStep)) {
  // não zera, força engine=sys mesmo com conversational_flow_enabled=true
  return { engine: "sys", step: currentStep };
}
```

**Prefixo correto no auto-resume:** ao resetar `status=pending`, normaliza `conversation_step` no mesmo `update`:

```ts
const normalizedStep = engineUsed === "flow" && !step.startsWith("flow:")
  ? `flow:${step}` : engineUsed === "sys" && step.startsWith("flow:")
  ? step.slice(5) : step;
```

**ButtonId como input primário:** `_shared/flow-router.ts:matchTransition` recebe `{ buttonId, messageText }` e tenta match em ordem: (a) `buttonId` em `transitions[].trigger_phrases`, (b) `buttonId === goto_special`, (c) match em `messageText`.

**Image capture configurável:** `runConversationalFlow` antes de redirect hardcoded para `aguardando_conta`, busca `bot_flow_steps WHERE consultant_id=? AND step_type='image_capture' AND is_active=true`. Se existir, executa esse step. Senão, mantém o redirect legado (preserva 3.13/3.23).

### 3.4 B4 — Passo correto

**Gate AI vs flow opening:** antes de avaliar `aiShouldHandle`, checa se `bot_flow_steps[consultant_id]` tem `is_opening=true` ou primeiro step ativo. Se sim e `currentStep IN ('welcome', null)`, força `runConversationalFlow` para o opening; AI só atua nos passos que o consultor não cobriu.

**Validação de `next_step`:**

```ts
const validSteps = new Set([
  ...CADASTRO_STEPS,
  ...await loadStepKeys(consultantId)
]);
if (!validSteps.has(decision.next_step)) {
  log("ai_invalid_next_step", { proposed: decision.next_step });
  decision.next_step = currentStep; // mantém atual
}
```

**Reachability em `aiDecideFallback`:** verifica se `proposed_step` está em `transitions[].next_step_key` do step atual OU é um goto especial OU é `REPEAT`. Senão, força `REPEAT`.

**Pré-condições do step:** dicionário `STEP_PRECONDITIONS` aplicado antes de gravar:

```ts
{ aguardando_facial: (c) => !!c.otp_validated_at,
  cadastro_portal:   (c) => !!c.electricity_bill_value && !!c.document_uploaded }
```

### 3.5 B5 — Tempo realista

**Fonte única de timing por turno:**

```ts
function computeHumanDelayMs(charLen, hasIaPause) {
  if (hasIaPause) return 0; // IA já segurou
  const floor = charLen <= 10 ? 2000 : 2500;
  const proportional = 60 * Math.max(charLen, 1);
  return Math.min(12_000, Math.max(floor, proportional));
}
```

**Renovação de presence:**

```ts
async function withTypingPresence(remoteJid, totalMs) {
  const interval = 2_800;
  const ticks = Math.ceil(totalMs / interval);
  for (let i = 0; i < ticks; i++) {
    const ok = await sendPresence(remoteJid, "composing");
    if (!ok) return await sleep(2_000); // piso quando typing falha
    await sleep(Math.min(interval, totalMs - i * interval));
  }
}
```

**Mídias múltiplas:** entre itens, espera `max(800ms, configuredDelay, postAudioVideo)`, onde `postAudioVideo = min(0.6 * duration_sec * 1000, 8000)` aplica-se quando o item anterior é áudio/vídeo.

**Tail past 50s:** quando o acumulador chega a 50s, restante das mídias vai para `pending_outbound_media(consultant_id, customer_id, payload, scheduled_for=now())`. A Edge Function `outbound-media-flush-cron` (cron de 5s) processa essa fila. Webhook retorna 200 imediatamente.

### 3.6 B6 — IA grounded

**Sanitizer reforçado:**

```ts
function sanitizeHumanReply(text, ctx) {
  // 1. regex (existente, expandido)
  // 2. grounding numérico: nenhum número decimal/percentual que não exista em
  //    ctx.knowledgeSections nem ctx.customer pode passar
  // 3. links: bloquear http/https que não estejam em ctx.allowedDomains
  // 4. tamanho ≤ 280 (mantido)
  return cleanedOrEmpty;
}
```

Se sanitizer zera `reply_text` E `audio_slot_key` é vazio E `media_to_send_ids` é vazio, força fallback determinístico (template do step ou frase padrão "oii 😊 me dá um instantinho que eu te respondo"). Nunca silêncio.

**Filtro de mídia:** `media_to_send_ids = decision.media_to_send_ids.filter(id => relevantMediaIds.has(id))`. IDs descartados viram log `ai_hallucinated_media_id`.

**Audio slot inválido:** `if (!validSlotKeys.has(audio_slot_key)) audio_slot_key = currentStep === 'welcome' ? 'boas_vindas' : ''`.

**Falha do LLM:** Try/catch em volta da chamada Gemini. No catch, monta `decision` determinística:
```ts
{ reply_text: bot_flow_steps[currentStep]?.message_text ?? "oii 😊 me dá um instantinho",
  media_to_send_ids: [], audio_slot_key: "", next_step: currentStep, should_pause_seconds: 0 }
```

**Pré-condição de cadastro_portal:** ver 3.4.

**FAQ exact-first:** `_shared/ai-faq-answerer.ts:answerFaqWithAI` primeiro tenta `bot_flow_qa_triggers` exact match (case-insensitive, trim). Se hit, retorna `bot_flow_qa.text_response` direto. Só sem hit chama LLM, e LLM recebe o conjunto `bot_flow_qa.text_response` como contexto restritivo (parafrasear, não inventar).

### 3.7 B7 — Escala multi-tenant

**Persistência do que estava em memória:**

| O que | De | Para |
|-------|-----|------|
| `rateLimitMap` | `Map<phone, number[]>` por instância | tabela `webhook_rate_limit(phone, window_start, count)` + RPC atômica |
| `aiInCooldown` | `Map<key, until>` por instância | tabela `ai_cooldown_state(key, until)` + RPC `ai_cooldown_check_and_set` |
| Sem coalescing Gemini | livre | `gemini_quota_bucket(consultant_id, tokens, refilled_at)` |

**Lock por customer:** `pg_advisory_xact_lock(hashtext(customer_id))` no início; libera ao final do xact (automático).

**`try_log_media_send` com confirm:** novo contrato:

```sql
-- reserve: SELECT reserve_media_send(consultant_id, customer_id, media_id) → reservation_id
-- send via Evolution
-- confirm: SELECT confirm_media_send(reservation_id, true|false)
-- se sem confirm em 30s, RPC sweeper cron libera reserva (allow retry)
```

`_shared/audit.ts:try_log_media_send` continua existindo como wrapper que chama os dois (preserva 3.19).

**Token bucket Gemini:** antes de chamar Gemini, `SELECT consume_gemini_token(consultant_id, tokens=1)`. Se retorna `false`, fallback determinístico imediato, log `gemini_quota_exhausted`, e cliente recebe template do step.

## 4. Database Schema Changes

Migração nova: `supabase/migrations/<timestamp>_whatsapp_flow_reliability_v2.sql`

```sql
-- 4.1 inbound_media_failures: log persistente de falha de download
CREATE TABLE inbound_media_failures (
  id BIGSERIAL PRIMARY KEY,
  customer_id UUID NOT NULL,
  consultant_id UUID NOT NULL,
  message_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON inbound_media_failures (customer_id, created_at DESC);

-- 4.2 inbound_media_retry: base64 pendente de upload MinIO
CREATE TABLE inbound_media_retry (
  id BIGSERIAL PRIMARY KEY,
  customer_id UUID NOT NULL,
  consultant_id UUID NOT NULL,
  message_id TEXT NOT NULL,
  media_kind TEXT NOT NULL,
  base64 TEXT NOT NULL,
  mime_type TEXT,
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  succeeded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON inbound_media_retry (next_attempt_at) WHERE succeeded_at IS NULL;

-- 4.3 outbound_message_log: idempotency para sendWithRetry
CREATE TABLE outbound_message_log (
  idempotency_key TEXT PRIMARY KEY,
  customer_id UUID NOT NULL,
  consultant_id UUID NOT NULL,
  payload_hash TEXT NOT NULL,
  result_status TEXT,
  evolution_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON outbound_message_log (customer_id, created_at DESC);

-- 4.4 webhook_rate_limit: substitui Map em memória
CREATE TABLE webhook_rate_limit (
  phone TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INT NOT NULL DEFAULT 1,
  PRIMARY KEY (phone, window_start)
);
CREATE INDEX ON webhook_rate_limit (window_start);

CREATE OR REPLACE FUNCTION try_acquire_rate_limit(
  p_phone TEXT, p_window_ms INT, p_max_count INT
) RETURNS BOOLEAN AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count INT;
BEGIN
  v_window_start := date_trunc('second', now()) - (extract(milliseconds from now())::int % p_window_ms) * interval '1 millisecond';
  INSERT INTO webhook_rate_limit (phone, window_start, count)
  VALUES (p_phone, v_window_start, 1)
  ON CONFLICT (phone, window_start) DO UPDATE SET count = webhook_rate_limit.count + 1
  RETURNING count INTO v_count;
  RETURN v_count <= p_max_count;
END $$ LANGUAGE plpgsql;

-- 4.5 ai_cooldown_state: substitui Map por instância
CREATE TABLE ai_cooldown_state (
  cooldown_key TEXT PRIMARY KEY,
  until_at TIMESTAMPTZ NOT NULL,
  reason TEXT
);

CREATE OR REPLACE FUNCTION ai_cooldown_check_and_set(
  p_key TEXT, p_ttl_ms INT, p_reason TEXT
) RETURNS BOOLEAN AS $$
DECLARE v_until TIMESTAMPTZ;
BEGIN
  SELECT until_at INTO v_until FROM ai_cooldown_state WHERE cooldown_key = p_key;
  IF v_until IS NOT NULL AND v_until > now() THEN RETURN false; END IF;
  INSERT INTO ai_cooldown_state(cooldown_key, until_at, reason)
  VALUES (p_key, now() + (p_ttl_ms || ' milliseconds')::interval, p_reason)
  ON CONFLICT (cooldown_key) DO UPDATE
    SET until_at = EXCLUDED.until_at, reason = EXCLUDED.reason;
  RETURN true;
END $$ LANGUAGE plpgsql;

-- 4.6 gemini_quota_bucket: token bucket por consultor
CREATE TABLE gemini_quota_bucket (
  consultant_id UUID PRIMARY KEY,
  tokens INT NOT NULL DEFAULT 60,
  capacity INT NOT NULL DEFAULT 60,
  refill_per_minute INT NOT NULL DEFAULT 60,
  refilled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION consume_gemini_token(p_consultant UUID, p_tokens INT DEFAULT 1)
RETURNS BOOLEAN AS $$
DECLARE
  v_row gemini_quota_bucket%ROWTYPE;
  v_elapsed_min NUMERIC;
  v_new_tokens INT;
BEGIN
  INSERT INTO gemini_quota_bucket(consultant_id) VALUES (p_consultant)
  ON CONFLICT (consultant_id) DO NOTHING;
  SELECT * INTO v_row FROM gemini_quota_bucket WHERE consultant_id = p_consultant FOR UPDATE;
  v_elapsed_min := EXTRACT(EPOCH FROM (now() - v_row.refilled_at)) / 60.0;
  v_new_tokens := LEAST(v_row.capacity, v_row.tokens + (v_elapsed_min * v_row.refill_per_minute)::int);
  IF v_new_tokens < p_tokens THEN
    UPDATE gemini_quota_bucket SET tokens = v_new_tokens, refilled_at = now()
      WHERE consultant_id = p_consultant;
    RETURN false;
  END IF;
  UPDATE gemini_quota_bucket SET tokens = v_new_tokens - p_tokens, refilled_at = now()
    WHERE consultant_id = p_consultant;
  RETURN true;
END $$ LANGUAGE plpgsql;

-- 4.7 webhook_message_dedup: composite UNIQUE
ALTER TABLE webhook_message_dedup
  DROP CONSTRAINT IF EXISTS webhook_message_dedup_message_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS webhook_message_dedup_msg_inst_uniq
  ON webhook_message_dedup (message_id, instance_name);

-- 4.8 media_send_log: dispatch_status + reserve/confirm
ALTER TABLE media_send_log
  ADD COLUMN IF NOT EXISTS dispatch_status TEXT NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS reservation_id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS reserved_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION reserve_media_send(p_cons UUID, p_cust UUID, p_media UUID)
RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO media_send_log(consultant_id, customer_id, media_id, dispatch_status)
  VALUES (p_cons, p_cust, p_media, 'reserved')
  ON CONFLICT (consultant_id, customer_id, media_id) DO UPDATE
    SET dispatch_status = CASE
      WHEN media_send_log.dispatch_status = 'sent' THEN 'sent'
      WHEN media_send_log.reserved_at < now() - interval '30 seconds' THEN 'reserved'
      ELSE media_send_log.dispatch_status END,
        reserved_at = CASE WHEN media_send_log.dispatch_status = 'sent'
          THEN media_send_log.reserved_at ELSE now() END
  RETURNING reservation_id INTO v_id;
  RETURN v_id;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION confirm_media_send(p_res_id UUID, p_ok BOOLEAN)
RETURNS VOID AS $$
BEGIN
  UPDATE media_send_log SET dispatch_status = CASE WHEN p_ok THEN 'sent' ELSE 'failed' END,
    confirmed_at = now() WHERE reservation_id = p_res_id;
END $$ LANGUAGE plpgsql;

-- 4.9 pending_outbound_media: tail past 50s
CREATE TABLE pending_outbound_media (
  id BIGSERIAL PRIMARY KEY,
  consultant_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  payload JSONB NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INT NOT NULL DEFAULT 0,
  succeeded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON pending_outbound_media (scheduled_for) WHERE succeeded_at IS NULL;

-- 4.10 conversations.message_text_hash: anti-dup normalizado
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS message_text_hash TEXT
  GENERATED ALWAYS AS (md5(lower(regexp_replace(coalesce(message_text,''), '\s+', ' ', 'g')))) STORED;
CREATE INDEX IF NOT EXISTS conversations_dup_hash_idx
  ON conversations (customer_id, conversation_step, message_text_hash, created_at DESC);

-- 4.11 consultants.flow_reliability_v2: feature flag de rollout
ALTER TABLE consultants
  ADD COLUMN IF NOT EXISTS flow_reliability_v2 TEXT NOT NULL DEFAULT 'off'
  CHECK (flow_reliability_v2 IN ('off','dark','canary','on'));
```

## 5. Idempotency & Locking Strategy

**Ordem absoluta de processamento por turno** (em `evolution-webhook/index.ts`):

1. `parseEvolutionMessage` (cheap, no side effects beyond reads)
2. `checkAndMarkProcessed(messageId, instanceName)` — INSERT atômico em `webhook_message_dedup`. Se conflito, return 200 deduped. **Antes de qualquer leitura de `customers`.**
3. `try_acquire_rate_limit(phone, 5000, 4)` — return 200 rate_limited se false.
4. BEGIN transaction.
5. `pg_advisory_xact_lock(hashtext(customer_id))` — serialização por cliente.
6. `loadCustomer` (agora dentro do lock, dados frescos).
7. Pipeline normal (route, handler, AI).
8. UPDATE customers + INSERT conversations.
9. COMMIT (libera lock).
10. Envio outbound via `sendWithRetry` com `idempotency_key`.

Webhooks de clientes diferentes não competem (advisory lock por hash de customer_id).

## 6. AI Grounding & Hallucination Guards

Pipeline de saída do `ai-agent-router`:

```
LLM → raw decision
  → validateNextStep(decision.next_step, validSteps)        ── senão keep current
  → filterMediaIds(decision.media_to_send_ids, relevantMedia) ── filtra alucinados
  → validateAudioSlot(decision.audio_slot_key, validSlots)  ── senão fallback
  → sanitizeHumanReply(decision.reply_text, ctx)            ── grounding numérico/links
  → checkPreconditions(decision.next_step, customer)        ── senão keep current
  → if everything empty: deterministicFallback(currentStep, consultantTemplates)
  → emit
```

Toda violação gera linha em `ai_agent_logs` com tag específica para observabilidade.

## 7. Timing Model

Single source of truth por turno: o componente que envia decide o delay.

- `runConversationalFlow` envia inline: usa `text_delay_ms`/`delay_before_ms` configurados, com pisos descritos em 3.5.
- `ai-agent-router` envia: aplica `should_pause_seconds`. O webhook pula `humanDelayMs` quando `mode=ai_agent`.
- `evolution-webhook` envia fallback: aplica `humanDelayMs` com a fórmula nova.
- `pending_outbound_media` (tail): processado pelo cron, sem delay extra (já é assíncrono).

`sendPresence` é renovado a cada 2.8s. Falha em presence reduz o delay para piso (não bloqueia o cliente sem feedback visual).

## 8. Rollout Plan

**Fases** (controladas por `consultants.flow_reliability_v2`):

1. **`off` (default)** — código novo coabita, mas o caminho atual continua. Migrações criam tabelas (não-disruptivas) e índices.
2. **`dark`** — código novo executa em paralelo registrando o que faria, sem mudar o que é enviado. Logs estruturados em `ai_agent_logs`/`bot_audit_log`.
3. **`canary`** — 5% dos consultores (whitelist manual) usam o novo caminho. Monitorar 24-48h.
4. **`on`** — full rollout por consultor.

**Rollback:** UPDATE `consultants` SET `flow_reliability_v2='off'`; o código antigo volta sem deploy.

**Critérios canary→full:**
- Zero aumento em `evolution_send_failures`.
- Redução de `evolution_media_lost` ≥ 80%.
- Zero aumento em latência p95 do webhook.
- Zero queixas de consultor sobre passos pulados/duplicados.

## 9. Regression Prevention Checklist

| Cláusula | Salvaguarda |
|----------|-------------|
| 3.1 OCR conta de luz | Teste de integração `bot-flow_test.ts` reaproveitado; canary monitora `electricity_bill_value` populado |
| 3.2 OCR documento | Mesmo teste cobre `aguardando_doc_*`; preserve early-return em `runConversationalFlow` para `CADASTRO_STEPS` |
| 3.3 CONNECTION_UPDATE | `handlers/connection.ts` não modificado |
| 3.4 bot_paused | Verificação `bot_paused=true` permanece como early-return em `evolution-webhook/index.ts` |
| 3.5 IA globalmente desativada | `_shared/bot/global-flag.ts` não modificado |
| 3.6 bot_flow_qa exact match | Reforçado em 3.6 deste design (exact-first) |
| 3.7 Anti-loop | Lógica preservada em `ai-agent-router/index.ts` |
| 3.8 3x confuso → handoff | Não tocado |
| 3.9 pediu_humano | Não tocado |
| 3.10 variant A/B | `_shared/flow-router.ts` não toca em `flow_variant` |
| 3.11 KanbanBoard messageSender | Frontend não muda |
| 3.12 MessagePanel | Frontend não muda |
| 3.13 BulkSendPanel | Frontend não muda |
| 3.14 complete/registered_igreen | Lógica `stepsFinalizados` preservada |
| 3.15 abandoned/stuck reset | `auto-resume` muda só prefixo, não comportamento |
| 3.16 notifyNewLead | `_shared/notify-consultant.ts` não modificado |
| 3.17 syncDealStageFromStep | `_shared/crm-stage-sync.ts` não modificado |
| 3.18 recover-stuck-otp cron | Não tocado |
| 3.19 try_log_media_send happy | Wrapper preservado, semântica idêntica em sucesso |
| 3.20 flow_step_media_order | `_shared/step-media-order.ts` adiciona delays mas mantém ordem |
| 3.21 grupos/newsletter ignorados | `parseEvolutionMessage` early-return preservado |
| 3.22 self-message ignored | Idem |
| 3.23 goto_special cadastro/humano | Transitions preservadas |
| 3.24 evolution-proxy | Não modificado neste bugfix |
| 3.25 CADASTRO_STEPS bypass | `runConversationalFlow` early-return preservado |
| 3.26 __inline_sent + reply="" | Reforçado pelo contrato único de 3.2 |
| 3.27 500 Connection Closed → needs_reconnect | Lógica preservada |
| 3.28 strict_mode | LLM continua respeitando `strict_mode` |

## 10. Files Affected

**Novos:**
- `supabase/migrations/<ts>_whatsapp_flow_reliability_v2.sql`
- `supabase/functions/inbound-media-retry-cron/index.ts`
- `supabase/functions/outbound-media-flush-cron/index.ts`
- `supabase/functions/_shared/idempotency.ts`
- `supabase/functions/_shared/customer-lock.ts`
- `supabase/functions/_shared/grounding.ts`
- `supabase/functions/_shared/feature-flag.ts`

**Modificados:**
- `supabase/functions/evolution-webhook/index.ts` — reordenar dedup, lock, mode-exclusivity, hash anti-dup, single `__inline_sent` gate
- `supabase/functions/evolution-webhook/_helpers.ts` — `parseEvolutionMessage` inclui áudio
- `supabase/functions/evolution-webhook/handlers/conversational/index.ts` — image_capture configurável, redirect condicional, buttonId primary
- `supabase/functions/evolution-webhook/handlers/step-namespace.ts` — prefix correctness em auto-resume
- `supabase/functions/_shared/evolution-api.ts` — `downloadMediaWithFallback`, `sendWithRetry` com idempotency_key, presence renewal
- `supabase/functions/_shared/flow-router.ts` — preservar step em CADASTRO no flag flip, reachability, buttonId match
- `supabase/functions/_shared/human-pace.ts` — fórmula nova de delay
- `supabase/functions/_shared/step-media-order.ts` — pisos entre mídias, queue tail
- `supabase/functions/_shared/ai-decisions.ts` — sanitizer reforçado
- `supabase/functions/_shared/ai-faq-answerer.ts` — exact-first, paraphrase-only LLM
- `supabase/functions/_shared/audit.ts` — `try_log_media_send` wrappers reserve/confirm
- `supabase/functions/_shared/bot/dedupe.ts` — composite key
- `supabase/functions/_shared/bot/ai-cooldown.ts` — backed by `ai_cooldown_state`
- `supabase/functions/_shared/gemini.ts` — token bucket pré-chamada
- `supabase/functions/ai-agent-router/index.ts` — pipeline de validações, fallback determinístico, precondition gate

**Não modificados** (regression prevention):
- `supabase/functions/evolution-proxy/**`
- `supabase/functions/_shared/notify-consultant.ts`
- `supabase/functions/_shared/crm-stage-sync.ts`
- `supabase/functions/_shared/bot/global-flag.ts`
- `supabase/functions/_shared/bot/paused.ts`
- `supabase/functions/_shared/whatsapp-api.ts`
- `supabase/functions/recover-stuck-otp/**`
- Qualquer arquivo do frontend (`src/**`).

## 11. Risks & Mitigations

| Risco | Mitigação |
|-------|-----------|
| Lock starvation por advisory lock | Lock é por hash de `customer_id`, escopo curto (transação única); set_lock_timeout=5s no statement; falha de lock vira retry-after-200 |
| Bloat de `webhook_message_dedup`/`webhook_rate_limit` | Cron de housekeeping diário (DELETE WHERE created_at < now() - interval '24 hours') |
| Storm de retries de MinIO em incidente | `inbound_media_retry.attempts` capped em 3, expires_at = 1h |
| Cooldown DB contention | RPC com 1 row por chave, índice PRIMARY KEY; impacto desprezível |
| Token bucket bloqueando consultor legítimo | Capacity=60/minuto por consultor é generosa; observabilidade via `gemini_quota_exhausted` |
| Migração quebrar produção | Migração só CRIA novos objetos + colunas com DEFAULT; ALTER em `webhook_message_dedup` mantém constraint UNIQUE composto que aceita o caso atual |
| Feature flag não propagar | Cache em memória de 30s; toggle leva até 30s para efeito; aceitável |

## 12. Acceptance Criteria

Cada cláusula 2.x do `bugfix.md` é endereçada por pelo menos uma intervenção da seção 2 deste design. Cada cláusula 3.x do `bugfix.md` é coberta pela checklist da seção 9.

A pull request final deve incluir:
- A migração SQL com todas as tabelas e RPCs.
- As Edge Functions novas e os arquivos modificados listados em 10.
- Testes unitários novos para `idempotency.ts`, `customer-lock.ts`, `grounding.ts`, e atualizações nos testes de `flow-router`/`bot-flow`.
- Documentação no README do `evolution-webhook` cobrindo o gate de feature flag.
