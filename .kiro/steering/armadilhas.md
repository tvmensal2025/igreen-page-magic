---
inclusion: always
---

# Armadilhas — erros típicos de modelo fraco

Sintoma → correção canônica. Se for fazer o lado esquerdo, pare.

1. **Evolution `needs_reconnect` = Zap offline** → Health Whapi `AUTH`. Regra Whapi primário.
2. **Misturar 3 “em análise”** → `src/lib/crmVsLeadAnalysis.ts`.
3. **Filtrar só `status=pending`** → use `conversation_step` + `portal_submitted_at` + `do_not_contact`.
4. **Rodízio por cidade/texto** → `deterministic-campaign-resolver.ts` + UUID `source_campaign_id`.
5. **Chamar com `whatsapp_profile`** → `safeFirstNameForAddress` (`customer-display-name.ts`).
6. **`display_name || name` do consultor** → `resolvePublicConsultantLabel`.
7. **Portal 1 / URL sync errada** → `dispatchPortalWorker` = Portal 2; sync = `igreen_sync_worker_url`.
8. **Apagar migration/toggle/flag** → arrumar; não deletar. Kill: `isBotGloballyEnabled`.
9. **Ligar envio em massa novo** → só sob pedido explícito + cadeados; E2E `dryRun`.
10. **Quiet hours em agenda humana** → `send-scheduled-messages` **sem** quiet; quiet = bot (`quiet-hours.ts`).
11. **Importar `_shared/vendedora/`** → produção `cerebro/resposta-hook.ts`; simulador `_shared/fluxo-b-ia/`.
12. **Tabela `messages`** → chat = `conversations`.
13. **`webhook_message_dedupe`** → canônico `webhook_message_dedup` (`_shared/bot/dedupe.ts`).
14. **Label “DNC” na UI** → “bloqueado” / “nunca mais contatar” (`isNuncaMaisContatar`).
15. **Protocolo na msg WA** → `2026-####` só banco/admin.
16. **Club com HMAC/fluxo do Portal** → workers e colunas separados (`club_*` ≠ `portal2_*`).
17. **`finalize-club` live sem querer** → default dryRun; `ALLOW_LIVE_CLUB_POST`.
18. **Fatura via `extract-receipt`** → fatura = `POST /extractor/extract` (ver PORTAL-OFICIAL).
19. **CORS `*` em edge nova sensível** → preferir `buildCors(req)`.
20. **Cron sem `assertCronAuth`** → sempre gate; preferir 200 `{ skipped }` a 5xx barulhento.
