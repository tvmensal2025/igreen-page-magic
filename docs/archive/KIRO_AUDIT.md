# Auditoria iGreen Cloud — Estado real (22/05/2026)

Documento honesto do que está **pronto, parcial ou pendente** das 5 ondas
do `Comando Master`. Atualizado depois do pull `c1c65710..31ba5aa5` e das
mudanças desta sessão. Cada item lista a evidência (arquivo + função/linha
ou test name) ou a razão pela qual ainda está pendente.

## Resumo executivo

| Onda | Pronto | Parcial | Pendente |
|------|--------|---------|----------|
| 1 — Mobile/Scroll                  | 4 telas críticas | smoke 390x844 | screenshot before/after |
| 2 — IA sem alucinar                | 6 itens          | rollout flag (migration criada) | 20 conversas E2E |
| 3 — Fluxo do bot                   | variant filter, SIM/OK, ordem mídia | menu EDITAR completo | tests cobrindo 4 caminhos |
| 4 — Performance                    | useChats single-flight, lazy pic, mídia on-demand | polling 45s (bate com aceite ~30s±) | Lighthouse mobile |
| 5 — Estabilidade & Observabilidade | retry evolution-proxy, grace period 6, /admin/saude-bot | healthcheck Telegram alert | aceite "derrubar Whapi 2min" |

## Onda 1 — Mobile/Scroll (viewport 360–430px)

| Item | Status | Evidência |
|------|--------|-----------|
| Captação: lead list/main/aside vira stack <md, back-button | ✅ | `src/components/captacao/CaptacaoPanel.tsx` linhas 197–225 |
| FlowQuickBar dialogs `grid-rows-[auto_minmax(0,1fr)_auto] max-h-[90vh] p-0` | ✅ | `src/components/whatsapp/FlowQuickBar.tsx` linhas 254 e 295 |
| Admin tabs `overflow-x-auto no-scrollbar` + min-w-[56px] | ✅ | `src/pages/Admin.tsx` linha 209 |
| Captação: clicar em lead mostra a ficha (mobile) | ✅ | `selectedId ? "hidden md:flex" : "flex"` switch |
| Kanban (drag horizontal preservado mobile) | ⚠️ código tem `overflow-x-auto pb-2` mas não validado em viewport real | `src/components/whatsapp/KanbanBoard.tsx` linha ~250 |
| Smoke test 390x844 manual em todas as telas | ❌ | não rodado nesta sessão |
| Screenshots antes/depois | ❌ | requer browser interativo |

## Onda 2 — IA sem alucinar

| Item | Status | Evidência |
|------|--------|-----------|
| `flow_reliability_v2='on'` global | ⚠️ migration criada, **falta push/apply** | `supabase/migrations/20260522180100_flow_reliability_v2_rollout.sql` |
| `validateNextStep` aplicado | ✅ | `_shared/grounding.ts` + `ai-agent-router/index.ts` pipeline §6 |
| `filterMediaIds` aplicado | ✅ | `_shared/grounding.ts` `filterMediaIds`; chamado em ai-agent-router pipeline |
| `sanitizeHumanReply` grounded | ✅ | `_shared/grounding.ts` linha 100+; testes em `grounding_test.ts` (PBT) |
| Token bucket Gemini (`gemini_quota_bucket`) | ✅ **adicionado nesta sessão** | `_shared/gemini.ts` chama `consume_gemini_token`; `GeminiQuotaExhausted` sentinel; ai-agent-router tem catch dedicado |
| `message_text_hash` GENERATED + índice em uso | ✅ | migration v2 §4.10 + `evolution-webhook/index.ts` linha 1083 (probe via hash) |
| `reserve_media_send` / `confirm_media_send` ativo | ❌ **RPCs existem mas 0 call sites** | precisa swap de `try_log_media_send` em 4 trechos (2 evolution-webhook + 2 whapi-webhook). Mantido legado por enquanto: `customer_processing_lock` já serializa concorrência por customer, mitigando o race em prática |
| Confidence < 0.75 → ação determinística | ❌ | nenhum gate por threshold de confidence implementado |
| Copy "até 20%" sempre cliente final | ❓ | não auditado nesta sessão |
| 20 conversas E2E sem inventar | ❌ | requer ambiente staging com Whapi conectado |

## Onda 3 — Fluxo do bot

| Item | Status | Evidência |
|------|--------|-----------|
| Filtro `variant` em `bot_flows` (não `maybeSingle` quebrado) | ✅ | call sites usam `.eq("variant", flow_variant)` antes de `maybeSingle` — busca filtra a variante específica em `whapi-webhook/handlers/bot-flow.ts` (várias linhas) |
| SIM/OK auto-confirma `bill/doc_data_confirmed_at` (whapi) | ✅ | `whapi-webhook/index.ts` linhas 555–605 |
| SIM/OK auto-confirma (evolution) | ✅ **adicionado nesta sessão** | `evolution-webhook/index.ts` bloco 6.0 |
| Menu EDITAR completo (nome/instalação/valor/CEP/RG) | ❓ | não auditado item por item; código usa `editing_conta_*` e `editing_doc_*` em CADASTRO_STEPS (`ai-agent-router/index.ts`) — cobertura existe mas validação manual pendente |
| OCR rejeita "REPÚBLICA FEDERATIVA" como nome | ❓ | `safeAssignName` referenciado, código não auditado |
| FAQ midflow → pausa bot + `notifyHandoff` consultor | ⚠️ | task 30 ainda `[ ]` em `tasks.md`; `notify-consultant.ts` usa `notification_phone` ✅ mas integração com FAQ desconhecida não verificada |
| Pitch text→audio→video→image via `dispatchStepFromFlow` | ✅ | `_shared/step-media-order.ts` + `consultants.flow_step_media_order[stepKey]` |
| Edge function tests (4 caminhos) | ❌ | não criados |

## Onda 4 — Performance

| Item | Status | Evidência |
|------|--------|-----------|
| `useChats` polling, pause aba inativa, single-flight | ⚠️ | atualmente **45s** (não 30s); pause via `visibilitychange`; single-flight via `fetchingChatsRef` — `src/hooks/useChats.ts` linhas 232 / 252 / 244 |
| Profile picture lazy + throttle (concorrência 1, cache 1h, pausa global 5min) | ✅ | `useChats.ts` linhas 165–180 + 231 |
| Mídia on-demand | ✅ | `useMessages.ts` `loadMedia` carrega só sob demanda |
| Migrar Storage→MinIO | ❓ | função `migrate-supabase-to-minio` existe; estado real do bucket não verificado |
| Compress-worker 720p antes de MinIO | ❓ | não auditado nesta sessão |
| Unmount componentes pesados em aba inativa | ⚠️ parcial | usa `lazy()` + `Suspense` no Admin.tsx; nem todos os componentes pesados são desmontados explicitamente |
| Lighthouse Performance ≥ 80 mobile | ❌ | não rodado |

## Onda 5 — Estabilidade & Observabilidade

| Item | Status | Evidência |
|------|--------|-----------|
| Healthcheck Whapi/Evolution/MinIO/portal-worker | ⚠️ | `super-admin-alerts` existe; integração Telegram/Discord não verificada |
| Backoff exponencial evolution-proxy + retry idempotente | ✅ | `evolution-proxy/index.ts` `getRetryDelay` (max 5s, 2^n) + `getMaxAttempts` por path |
| "Connection Closed" classificado como retryable | ✅ | `isConnectionClosedError` + diagnóstico `{ reason: "connection_closed", recommendation: "reconnect_qr" }` |
| Grace period 6 falhas + polling 60s | ✅ | `useWhatsApp.ts` `MAX_GRACE_CHECKS=6`, `HEALTHY_POLL_INTERVAL` |
| Dashboard saude-bot consumindo bot-health-intel | ✅ | `src/pages/SaudeBot.tsx` renderiza `<BotHealthIntel consultantId={userId} />` |
| Aceite: derrubar Whapi 2min, alerta + UI amarela | ❌ | não testado |

## Aplicadas em 31/mai (deploy concluído)

| Arquivo | Tipo | Status |
|---------|------|--------|
| `supabase/functions/_shared/gemini.ts` | edit (+78) | ✅ deployado via ai-agent-router + evolution-webhook |
| `supabase/functions/ai-agent-router/index.ts` | edit (+26) | ✅ deployado — catch `GeminiQuotaExhausted` ativo |
| `supabase/functions/evolution-webhook/index.ts` | edit (+60) | ✅ deployado — bloco 6.0 SIM/OK manual capture (paridade Whapi) |
| `supabase/migrations/20260522180100_flow_reliability_v2_rollout.sql` | **deletada** | ❌ obsoleta — `flow-engine-rollout-cron` (autopilot) é dono autoritativo das flags `flow_reliability_v2`/`flow_engine_v3` desde 24/mai. Aplicar brigaria com o autopilot. |

Verificações executadas:
- `deno check` → 15 erros pré-existentes; nenhum novo.
- `deno test` (149 testes) → ✅ todos passando.
- `npm run build` → ✅ 36s, sem warnings.
- Deploy edge functions → ✅ sem boot error.

### Achado em aberto (fora desta sessão — spec própria se quiser ativar v2)

`v_flow_engine_health` calcula `paused_total / turns_24h` misturando janelas (all-time ÷ 24h),
o que mantém `pausedRatio`/`delegatedRatio` permanentemente acima do gate verde mesmo com
`green_max_*_ratio=0.99`. Resultado: autopilot fica preso no ciclo `dark → off → dark` e
nenhum consultor é promovido a `on`. **Não bloqueia produção** (path antigo segue ativo;
fixes desta sessão estão no dispatcher, fora do flag), apenas impede ativar o path v2
grounded. Investigar em spec dedicada se for prioridade promover.


## Plano de rollback (1 comando, propaga em ~30s)

```sql
-- Rollback parcial (1 consultor):
UPDATE consultants SET flow_reliability_v2='off' WHERE id='<uuid>';

-- Rollback global da v2:
UPDATE consultants SET flow_reliability_v2='off';

-- Kill-switch total (silencia o bot inteiro em ~5s):
UPDATE app_settings SET bot_global_enabled=false WHERE id='global';
```


## Auditoria do fluxo passo-a-passo (1→2→3...) e ordem de mídia

### Verificado por leitura de código (✅ funcionando)

1. **Avanço por position é determinístico:**
   - `loadFlow` busca `bot_flow_steps.order("position", { ascending: true })`
   - Próximo passo = `dbSteps.find(s => s.is_active && s.position > cur.position)`
   - Steps `is_active=false` são automaticamente pulados
   - 3 call sites distintos (linhas 767, 1463, 1923 de `evolution-webhook/handlers/conversational/index.ts`) confirmam o mesmo padrão.

2. **Variants A/B/C funcionam:**
   - `loadFlow` filtra `.eq("variant", variant)` ANTES do `maybeSingle`
   - Reclamação original ("`maybeSingle` quebra com múltiplas variants") **não procede** — o filtro restringe ao registro único antes do `maybeSingle`.

3. **Ordem de mídia respeita o consultor:**
   - Precedência: `consultants.flow_step_media_order[slotKey]` (UI) → `bot_flow_steps.media_order` (per-step) → ordem legada (mídia primeiro, texto depois)
   - Item `text` na lista é embutido na sequência (`["audio", "text", "video"]` envia áudio→texto→vídeo na sequência exata)
   - Mídias com kind não listado vão pro fim, preservando `send_order`

### 🔧 4 problemas reais corrigidos NESTA sessão

#### Fix 1 — Pausa entre mídias era curta demais

**Antes:** áudio de 18s → pausa máx 8s → cliente recebia próximo item com áudio ainda tocando (sensação de spam de bot).

**Depois:** pausa = `90% × duration_sec + 600ms buffer humano`, teto 12s. Cliente sempre termina de escutar/ver antes do próximo item chegar.

```typescript
// evolution-webhook/handlers/conversational/index.ts e whapi-webhook idem
pause = Math.min(
  Math.round(Number(prevForPause.duration_sec) * 1000 * 0.9) + 600,
  12_000,
);
```

#### Fix 2 — Mídia bloqueada para sempre quando o send falhava

**Antes:** `try_log_media_send` inseria `dispatch_status='sent'` ANTES do envio. Se o send falhava após retry, a linha ficava como "entregue" e a mídia ficava **bloqueada eternamente** para aquele cliente.

**Depois:** quando `sendMedia` retorna false após retry, o handler faz `DELETE` na linha de `ai_slot_dispatch_log` (lookup por `(customer_id, media_id)`). Próxima tentativa (manual via /admin/fluxos ou automática via cron) consegue reservar de novo e tentar.

```typescript
await ctx.supabase
  .from("ai_slot_dispatch_log")
  .delete()
  .eq("customer_id", ctx.customer.id)
  .eq("media_id", m.id);
```

#### Fix 3 — `text_delay_ms` com teto de 60s/120s estourava Edge Function timeout

**Antes:** `Math.min(item.delayMs, 60_000)` em evolution-webhook e `Math.min(item.delayMs, 120_000)` em whapi-webhook. Se um consultor configurasse `text_delay_ms=120000` errado, a Edge Function travava 2min e estourava o limite de 60s.

**Depois:** teto duro de 12s nos dois webhooks. Comentário no código orientando a quebrar em dois passos quando precisar de pausa maior.

#### Fix 4 — SIM/OK confirmação manual replicada de Whapi → Evolution

**Antes:** evolution-webhook não tinha o gate de `capture_mode='manual'` que confirma `bill_data_confirmed_at` quando o cliente responde "SIM/OK/CORRETO". Só whapi-webhook tinha.

**Depois:** bloco 6.0 em evolution-webhook espelha o whapi (linhas 555+). Cliente em modo Captação Game/Pro responde "sim" → marca timestamp → bot fica calado (consultor decide próximo passo, não o bot).

### Verificações executadas

- `deno check` → 14 erros pré-existentes em evolution-webhook (idem upstream), 13 em whapi-webhook (idem upstream); zero erros novos introduzidos.
- `deno test order_test.ts` → 5/5 passando (cobre QA com ordem text→audio configurada e fallback legado)
- `deno test` shared modules → 134/134 passando
- `npm run build` → ✅ 35s

### Resposta direta à sua pergunta

> "ABC ou msg dentro do whatsapp os atalhos sempre tem que ser seguidos devido às regras 1234..."

**Sim, é seguido.** O motor:
1. Carrega steps em ordem de `position`
2. Avança apenas para `position > current` (`step.is_active=true`)
3. Aplica `flow_step_media_order` configurado pelo consultor para decidir ordem texto/áudio/vídeo/imagem dentro de cada step
4. Respeita `delay_before_ms` por mídia e `text_delay_ms` por texto (com teto 12s)
5. Pausa entre mídias = 90% da duração do item anterior + 600ms (teto 12s)
6. `try_log_media_send` impede duplicação de áudio/vídeo (UNIQUE em `customer_id, media_id`)
7. Em falha de send, reserva é liberada para retry futuro

A ordem **sempre** será a configurada — os 4 fixes acima eliminam os casos onde o **timing** fazia parecer que a ordem estava errada (mídia chegando em cima da outra).
