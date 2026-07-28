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
28. **“Velip sem crédito → sistema pausa sozinho”** → API v2 **não expõe saldo**; **não há gate** de crédito no código. Consultar **painel Velip**; recarregar lá. Playbook: `#erros-operacionais`.
29. **`sms_sent` = chegou no celular** → falso. Aceito Velip ≠ `DELIVRD`. Rajada = operadora engole. Ver `voice_sms_log.delivery_status` (`UNDELIV`/`Blocked text#270`/null).
30. **IK/EK/BK/CK ou UNDELIV×2 e “tenta de novo”** → canal morto / DNC; `checkPhoneDeadForChannel`. Não gastar saldo.
31. **Easy Panel “o worker”** → são **3**: Portal2 ≠ Club ≠ Sync (`d9v63q`, nunca typo `d9v83a`). Health de cada URL.
32. **Plataforma não abre = Zap/Evolution** → checklist `#erros-operacionais` §4 (cache → JWT → CORS → Whapi AUTH → workers → cron auth).
33. **Qualquer falha operacional sem playbook** → comece por `#erros-operacionais` (Velip/IA/OCR/EasyPanel/Supabase/caps).
34. **Cliente recebendo A/B/C como lead** → trava `isClienteProibidoCadenciaABC` + DB `tg_lead_cadence_block_cliente` + `cadence_ensure_state_from_customer` (sync não cria GREETED). Cliente = carteira/aprovado/`pos_venda_stage`/andamento ativo → só pós-venda + agenda. Os N do KPI “Total de cadastros” são carteira sync, não pizza A/B/C.
35. **“Falha operacional e ninguém avisa”** → cron `super-admin-alerts` (Whapi → `super_admin_phone`) + MinIO via `_shared/superadmin-alert.ts`. Não depende de Evolution. Dedup `infra_metrics` (`ops_alert` / `minio_alert`). Playbook: `#erros-operacionais` §0b.
36. **`cerebro_ativo=on` = Cérebro conduz o Grupo A inteiro** → falso. Grupo A / cadastro determinístico manda nos passos (OCR, doc, portal). Cérebro só: dúvida livre no meio, fora do cadastro, ou cliente carteira. Gates: `fluxo-a-bypass` + `classifyCadastroInput` em `whapi-webhook`. Ver `#cerebro-fluxo-b`.
37. **`quota_min_interval_not_elapsed` = “40 pessoas falharam”** → falso. Contar `COUNT(DISTINCT customer_id)`, não linhas do log. Era bug: `cadence-tick` tratava intervalo anti-ban como `failed`+30min. Correto: `awaitOutboundSendQuota` (Whapi bypassa → fila `claim_whapi_send_slot`; Evolution espera slot / softDefer em segundos).
38. **`identity_missing:consultor_phone` ≠ `identity_missing:consultor`** — nome sumiu após 2026-07-25 (presentation label). Phone: amarrar `wa.me` ao **canal real** (`channelKind=whapi` → `settings.whapi_connected_phone`; Evolution só se status saudável). Nunca usar `connected_phone` de `needs_reconnect` (Silvia: WA Whapi 5534 + SMS wa.me 5514).
39. **Lead responde COLD_1/B e não entra no Grupo A** → trigger `cadence_on_inbound_message` NÃO pode forçar `AI_QUALIFYING` em cima de COLD_/SMS_/CALL_/RECALL_ (migration `20260728160000_restore_cadence_inbound_preserve_bc`). Sintoma: `cadence_action_log.detail.prev_stage=AI_QUALIFYING` + `from_bc=false` logo após COLD_1. Também: `aguardando_avaliacao_atendimento` ≠ funil A (`isActiveGroupAConversation`). Protocolo vazio no start attendance: nunca passar `protocolo:""` ao `resolveConsultantMessage` antes do assign — deixa `{{protocolo}}` p/ `sendWelcomeHeader`.
40. **Lead Grupo A (Sofia UUID) “cai no Cérebro / outro fluxo”** → `_emCadastro` só olhava `CADASTRO_STEPS` (keys legadas). Step `a1_ask_name` gravado como UUID → `!_emCadastro` → Cérebro assume (Leandro Severiano 2026-07-28). Fix: OR `isActiveConversationalFunnelStep(step)` (UUID / `aN_` / `flow:`) em whapi+evolution. Custom start_attendance sem protocolo: limpar linha `Protocolo:**` em `attendance-flow`. Protocolo `IGR-IGR-####` = iniciais vazias no assign — buscar nome do consultor e nunca usar meio `IGR`.
41. **Abertura falando “Gestor” / “consultora” no lugar do nome** → legado `buildWelcomeHeaderProtocol` tinha `, *Gestor*` hardcoded; fallback sem nome colocava literal `*consultora*`/`*consultor*` entre asteriscos. Fix: nunca hardcodar cargo; sem nome humano → “Aqui é o atendimento da *iGreen*”; `scrubLegacyWelcomeRoleLeak` no welcome + `renderVars`; `resolveConsultantPresentationLabel` só devolve nome humano (nunca substantivo de papel).
41. **Subconta sync “não puxa telefone” / cliente fica `sem_celular_*`** → Conta principal mascara `celular` da rede; unique `(consultant_id, igreen_code)` trava 1 linha. **UPDATE por igreen_code** (não upsert só por phone); enrich **sem** filtrar `igreen_account_id`; `enrich_only` reprocessa placeholder pelo `registered_by`. Ver `#igreen-sync-oficial`.
42. **Cliente carteira recebe msg de lead novo** → sync grava colisão `5511…_igreenCode` e deixa lead sombra no número limpo; webhook buscava só exact → Grupo A no lead. Corrigir: `_shared/inbound-customer-resolve.ts` (prioriza `igreen_sync`), absorver sombra no sync, não notificar carteira como novo lead.
43. **Pós-venda manda 4 msgs iguais no mesmo Zap** → NÃO é falha do UNIQUE `(customer_id, stage_key)`. São **2 rows** sync (limpo + `5511…_igreenCode`) com o mesmo `whatsapp_chat_id`; cada um manda img+áudio = 4 bolhas. Fix: motor pula telefone de colisão + dedupe por `remote_jid`/stage (`skipped_duplicate_phone`); invalidar sombra (`pos_venda_invalid`); filtrar `pos_venda_invalid=false` na query. Ver `#pos-venda`.
