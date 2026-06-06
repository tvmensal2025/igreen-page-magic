# Ajustes na IA do Fluxo B (Whapi + Evolution) — plano final

Objetivo: deixar o Fluxo B da v1 100% confiável nos dois canais, sem mexer em nada que já funciona em Fluxo A/D.

## O que muda

### 1. `process-followups` — reescrita in-process
Problema: hoje chama `…/functions/v1/whatsapp-receive` (que **não existe**). Zera `next_followup_at` antes de tentar enviar → follow-ups silenciosamente perdidos.

Novo comportamento:
- Buscar leads vencidos (`next_followup_at <= now()`, `bot_paused = false`, `assigned_human_id IS NULL`, respeitando `isQuietHourBRT`).
- Para cada lead, resolver o canal via `whatsapp_instances` do `consultant_id`:
  - 1 só conectado → usa esse.
  - Whapi + Evolution conectados → Whapi (default histórico).
  - Nenhum conectado → pula e re-agenda em 30min.
- Rodar `runFluxoBAI({ supabase, customerId, inboundText: "[system_nudge]", customer, nudgeHook: c.followup_hook })` direto in-process.
- Enviar `reply` pelo sender do canal escolhido (`createWhapiSender` ou `createEvolutionSender`).
- Inserir em `conversations` (outbound, type=text).
- **Só depois do envio com sucesso** zerar `next_followup_at` e setar `last_followup_at = now()`. Em erro → `next_followup_at = now() + 10min` (até max 3 tentativas via `followup_count`; depois cancela).

### 2. `_shared/fluxo-b-ai.ts` — aceitar nudge
Adicionar parâmetro opcional `nudgeHook?: string` em `FluxoBRunInput`. Quando presente:
- Injetar bloco "⏰ NUDGE INTERNO — o lead sumiu, use este gancho para reaquecer: {hook}" no system prompt.
- **Não** inserir o `inboundText` sintético em `conversations` (sem poluir histórico).
- Manter todo o resto idêntico (RAG, tools, escrita).

### 3. Resiliência nos webhooks (Whapi + Evolution)
Padrão **conservador** escolhido: silêncio + fallback A/D legado, sem mensagem-fantasma ao lead.

No `try/catch` que chama `runFluxoBAI` (linhas 627-665 do whapi e 627-660 do evolution):
- Envolver com `Promise.race([runFluxoBAI(...), timeout(25_000)])`.
- Em timeout/erro: logar evento (já existe), **não enviar nada**, **cair pro fluxo legado** (comportamento atual).
- Dedupe garantido pelo `checkAndMarkProcessed(messageId, instanceName)` que já existe.

### 4. Backfill de `variant_id`
`UPDATE customers SET variant_id = 'b.legacy' WHERE variant_id IS NULL AND flow_variant = 'B'` — via insert tool.

## O que NÃO vamos mexer (intencional)

- `_shared/ai-gateway.ts` — usado por Fluxo A, D, summary, embed. Não adicionar timeout global pra não regredir nada.
- Cron `process-followups-5min` — já está agendado e ativo, só a edge function muda.
- Botão "Marcar vencedora" — já plugado.
- Trigger de embeddings, painel A/B, kill switch — já funcionando.

## Por que isto é seguro

| Mudança | Pode quebrar Fluxo A/D? | Pode quebrar Fluxo B atual? |
|---|---|---|
| Rewrite `process-followups` | Não (função isolada) | Não (hoje 0% funciona) |
| `nudgeHook` opcional em `runFluxoBAI` | Não (param opcional) | Não (comportamento idêntico se ausente) |
| Timeout 25s + fallback silencioso | Não (try/catch já existe) | Não (idêntico ao atual em erro) |
| Backfill `variant_id` | Não | Não (variant-picker já trata null) |

## Validação após deploy

1. `supabase--curl_edge_functions` em `process-followups` (POST com `x-internal-secret`) → resposta `{ ok: true, sent: N }`.
2. SQL: forçar 1 lead B com `next_followup_at = now() - interval '1 min'`, aguardar cron → conferir nova linha em `conversations` (outbound) + `next_followup_at = null` + msg real no WhatsApp.
3. Inbound real no Whapi (lead B) → reply v1 em <25s.
4. Inbound real no Evolution (lead B) → reply v1 em <25s.
5. Forçar erro (env `LOVABLE_API_KEY` inválido temporário) → confirma silêncio + fallback legado, sem mensagem-fantasma ao lead.

## Arquivos tocados

- `supabase/functions/process-followups/index.ts` (rewrite)
- `supabase/functions/_shared/fluxo-b-ai.ts` (aceitar `nudgeHook`)
- `supabase/functions/whapi-webhook/handlers/bot-flow.ts` (timeout no dispatch v1)
- `supabase/functions/evolution-webhook/handlers/bot-flow.ts` (timeout no dispatch v1)
- SQL `UPDATE` via insert tool (backfill variant_id)
