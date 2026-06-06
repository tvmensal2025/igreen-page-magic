# Auditoria — Plano Vendedora v1 (Fluxo B)

Resultado: **5 de 7 itens entregues no código**, **1 item parcial**, **1 item não iniciado**, e **1 migration ainda não aprovada** (bloqueia tudo).

## Status por item

| # | Item | Status | Observação |
|---|------|--------|-----------|
| 1 | Trigger automático de embeddings em `ai_knowledge_sections` + botão "Indexar pendentes" | ✅ Código pronto | Trigger está dentro da migration não aprovada |
| 2 | Painel A/B (multi-variante) em `/admin/fluxo-b` | ✅ Pronto | `VariantsPanel` integrado na aba "Variantes (A/B/N)" |
| 3 | Kill switch por consultor + env var global (`VENDEDORA_V1_FORCE_OFF`) | ✅ Pronto | Lê `consultant_overrides` em `flow_variants` |
| 4 | Botão "marcar conversa vencedora" no chat admin | ⚠️ Parcial | Componente `WinningConversationButton` + edge function existem, **mas não estão plugados no chat do admin** |
| 5 | Worker `process-followups` (cron a cada 5min) | ❌ **Não iniciado** | Pasta `supabase/functions/process-followups/` não existe; cron não agendado |
| 6 | Debug da v1 no tester | ✅ Pronto | Painel "Decisão interna" no `FluxoBEditor` |
| 7 | Destino de `oferecer_cadastro_express` | ✅ Decidido | Removido; substituído por fechamento direto via `closer.ts` (checklist → `finalize-capture`) |

## Bloqueios críticos

1. **Migration `20260606123656_*` ainda não foi aprovada/executada.** Sem ela: `flow_variants` não existe (painel A/B quebra ao carregar), `customers.variant_id` / `followup_hook` não existem (writes da v1 falham), trigger de embeddings não dispara. **Tudo depende disso.**
2. **Secret `INTERNAL_EMBED_TOKEN`** (usado pelo header `x-internal-secret` do trigger → `embed-knowledge`) **não foi criado**. Sem ele a indexação automática silenciosamente não roda.
3. **`process-followups` não existe.** Os campos `next_followup_at` e `followup_hook` estão sendo escritos pela v1, mas ninguém lê. Followups marcados nunca disparam.
4. **`WinningConversationButton` não está renderizado** em nenhuma tela de conversa do admin (só foi criado o componente). O admin não consegue marcar nada.

## Riscos menores

- Variant-picker: confirmar fallback quando `flow_variants` estiver vazia ou todas inativas (evitar lead sem variante).
- Trigger de embeddings: lida bem com `is_active=false` (não re-embeda), mas não há retry; depende do botão "Indexar pendentes" para cobrir falhas de `pg_net`.
- Backfill de `variant_id`: cobre `'v1'`/`'legacy'`, mas leads antigos sem `fluxo_b_variant` ficam `NULL` (não aparecem nas métricas por variante).

## Próximos passos sugeridos (ordem)

1. Aprovar a migration pendente.
2. Adicionar secret `INTERNAL_EMBED_TOKEN` e propagar ao SQL do trigger.
3. Criar `supabase/functions/process-followups/` + agendar cron `*/5 * * * *` via `pg_cron` + `pg_net`.
4. Plugar `<WinningConversationButton conversationId=… />` no header da conversa em `/admin/conversas` (ou equivalente).
5. Backfill opcional de `variant_id` para leads B antigos (default `b.legacy`).
6. Smoke test ponta-a-ponta: lead novo → conta + doc + email + telefone → `finalize-capture` chamado → métricas aparecem no painel A/B.

## Vai melhorar de verdade?

Sim, **desde que 1–4 sejam fechados**. Hoje, sem a migration e sem o worker de followup, a v1 ainda é "um Writer chique com RAG manual": ela coleta dados mas (a) não tem onde gravar a variante, (b) não recupera leads que somem, (c) ninguém alimenta o banco de conversas vencedoras. Com os 4 bloqueios resolvidos, o fluxo fecha o loop: roteamento → coleta → fechamento automático → follow-up → aprendizado.
