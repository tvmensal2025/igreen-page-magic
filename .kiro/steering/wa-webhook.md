---
inclusion: fileMatch
name: wa-webhook
description: Contrato webhook Whapi e paridade Evolution.
fileMatchPattern:
  - "supabase/functions/whapi-webhook/**"
  - "supabase/functions/evolution-webhook/**"
  - "supabase/functions/_shared/whapi-api.ts"
  - "supabase/functions/_shared/webhook-auth.ts"
  - "supabase/functions/_shared/bot/dedupe.ts"
  - "supabase/functions/whapi-webhook/AGENTS.md"
---

# WhatsApp webhook — Whapi primário

## Evidência prod (2026-07-24)
- Dedup `webhook_message_dedup`: **1363** rows
- Outbound log: **1295** · campaign_match_log: **306** · rodizio_assignments: **28**
- Canal health = Whapi `AUTH` — **não** use `whatsapp_instances.needs_reconnect` (Evolution) como Zap offline

## Edges
| Edge | Papel |
|---|---|
| `whapi-webhook` | Inbound **primário** (~3801 index + bot-flow **7140** + conversational/index **3630**) |
| `evolution-webhook` | Legado / paridade (~3952 + bot-flow **6902** + conversational ~3455) — **manter paridade**, não “apagar” |

Nested: #[[file:supabase/functions/whapi-webhook/AGENTS.md]]

## Contrato de entrada (ordem mental + evidência)
1. **Auth origem** `verifyWebhookOrigin(..., "WHAPI_WEBHOOK_SECRET")` — `index.ts:75`; default **grace**; `ENFORCE_WEBHOOK_ORIGIN=true` → 401
2. **Kill switch outbound** `isBotGloballyEnabled` — `index.ts:99–101` (inbound OK); bloqueio de resposta auto ~`:1909–1934` (grava `conversations` + notifica)
3. Parse + `summarizeWebhookBody` (LGPD)
4. **ACK statuses** — atualiza log, **não** reverte cadência
5. **Dedup** `checkAndMarkProcessed` → `duplicate` — ~`:392–393` / tabela `webhook_message_dedup`
6. **CTWA/rodízio** — mini-resolução + `assignRodizioLead` ~`:1403–1411` (detecção completa de lead-source mais à frente ~`:1293`)
7. Keyword/parceiro: `keyword-matcher` + `qr-phrase` (paridade nos dois webhooks)
8. **Retentativa PV** — `activatePosVendaRecadastro` ~`:1846–1868` (antes dos motores; clique → Grupo A)
9. **Motores (ordem real)** — V3 sombra `runEngineV3IfEnabled` ~`:3163–3174` (hoje observa/delega) → Cérebro sombra ~`:3179–3200` → Cérebro/Fluxo B resposta ~`:3272–3307` → fallback `runEngine()` (`runBotFlow`/`runConversationalFlow`) ~`:3438–3440`. O `:3213` é só a **definição** de `runEngine`, não a execução.
10. **Cérebro × Grupo A (cadastro)** — **não** é “Cérebro manda em tudo”. Em variante A + cadastro → `fluxo-a-bypass` (determinístico). Em cadastro + input esperado → determinístico. Só freeform / fora do cadastro / carteira → Cérebro. Detalhe canônico: `#cerebro-fluxo-b` § “Como DEVE funcionar com o Grupo A”.

Paridade Evolution: mesmos helpers compartilhados (`normalizePhone`, dedupe, `runBotFlow`, `runConversationalFlow`, `routeEngineV2`, rodízio, `isBotGloballyEnabled`) — espelho em `evolution-webhook/index.ts` imports.

## Chat / tabelas
- Chat = **`conversations`** (não invente tabela `messages` para o chat vivo)
- `customers`, `webhook_message_dedup`, `outbound_message_log`, `campaign_match_log`

## Helpers canônicos
`channel-sender.ts` · `channels/whapi.ts` · `customer-display-name.ts` · `bot/global-flag.ts` · `bot/dedupe.ts` · `deterministic-campaign-resolver.ts` · `rodizio-assign.ts` · `cerebro/resposta-hook.ts`

## NÃO FAÇA
- Tratar Evolution `needs_reconnect` como Zap offline
- Quebrar paridade Whapi↔Evolution sem checklist nos dois
- Importar `_shared/vendedora/` (morto)
- Early-return que **descarte inbound** quando `bot_global=false` (lead se perde)
- Appendar protocolo `2026-####` na mensagem WA
