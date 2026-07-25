---
inclusion: always
name: armadilhas
description: Sintoma → correção canônica. Leia antes de consertar.
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
17. **Pós-venda “usa `bot_global`” / só D120 / “via Evolution”** → marcos **D30…D210** + **retentativa**; canal Whapi primeiro; toggle `pos_venda_auto_messages` + `pos_venda_manual` (**não** exige `bot_global`).
18. **Cross-sell em massa ou chamar `avaliarCrossSell` sem consumidor** → card/manual (`#cross-sell`); Cérebro em sombra (`CROSS_SELL_SHADOW`); só avaliar com consumidor elegível e só ligar massa com pedido explícito.
19. **Assumir que ads / cérebro-mg / minio só carregam via `#nome`** → frontmatter real é `inclusion: auto` (CI `check:agent-docs` confere).
20. **Seguir spec Evolution-first em `.kiro/specs`** → leia `.kiro/specs/STATUS.md`; regra dura Whapi vence.
21. **Números “de memória”** → `#evidencia-prod` / `mapa-dominios.json` (snapshot auditado).
22. **Fatura via `extract-receipt`** → fatura = `POST /extractor/extract` (ver PORTAL-OFICIAL).
23. **CORS `*` em edge nova sensível** → preferir `buildCors(req)`.
24. **Cron sem `assertCronAuth`** → sempre gate; preferir 200 `{ skipped }` a 5xx barulhento.
25. **Assumir que o V3 já decide o turno** → `flow_engine_v3` ainda é sombra/canário conforme rollout; preserve a ordem real de roteamento documentada em `#wa-webhook`.
26. **Somar action_types de conversa Meta** (`started`+`first_reply`+`total_connection`) → triplica conversas e CPL cai ~3×; Cérebro sobe budget à toa. Use `pickMetaConversations` / `pickMetaLeads` em `_shared/meta-insight-actions.ts` (prioridade, nunca soma).
27. **Motor global ON = consultor ON** → falso. Cadeado 2: `consultant_automation_prefs` (A/B/C, pós-venda, lembretes). Sem row / pack OFF = skip só daquele `consultant_id`. UI: modal + “Minhas automações”. Helper: `consultant-automation-prefs.ts` / `src/lib/consultantAutomationPrefs.ts`.
