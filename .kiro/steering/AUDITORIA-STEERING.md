---
inclusion: manual
name: AUDITORIA-STEERING
description: Histórico de rounds do pack steering.
---

# Auditoria do pack steering

Última atualização: **2026-07-28** (Grupo A UUID ≠ Cérebro + reset Leandro).

## 2026-07-28 — Grupo A UUID caía no Cérebro (Leandro Severiano)
Lead novo no Sofia A com `conversation_step` = UUID de `a1_ask_name`: `_emCadastro` só checava `CADASTRO_STEPS` (keys legadas) → `false` → Cérebro assumia (“outro fluxo”). Msg start_attendance com protocolo vazio virava `Protocolo:**`. Fix: `_emCadastro |= isActiveConversationalFunnelStep` (whapi+evolution); scrub linha protocolo vazia em `attendance-flow`; template start_attendance do Rafael alinhado ao A1; badge PAUSED na pizza usa `operationalGroup`. Armadilha #40. Lead resetado → `welcome` + cadence `NEW`.

## 2026-07-28 — Sync multi-conta: telefone de subconta sempre atualiza
Bug: cliente entrava pela Conta principal (rede) como `sem_celular_*`; subconta (Oseias/Nilma/…) trazia celular real mas upsert por `phone_whatsapp` batia no unique `(consultant_id, igreen_code)` e o enrich filtrava por `igreen_account_id`. Fix em `persistCustomers` (UPDATE por id / promove placeholder) + `applyCustomerDetails` (sem filtro de conta) + `enrich_only` reprocessa `sem_celular_*` pelo `registered_by`. Doc: `#igreen-sync-oficial` · AGENTS sync.

## 2026-07-28 — Cadência B→A muda + protocolo start_attendance
- Trigger `cadence_on_inbound_message` (migration 25/07) apagava COLD_/SMS_ → `AI_QUALIFYING` antes do router TS; lead respondia COLD_1 e não entrava no Grupo A. Fix: `20260728160000_restore_cadence_inbound_preserve_bc` (+ cliente guard). Armadilha #37.
- `start-customer-attendance` passava `protocolo:""` → `applyVars` apagava `{{protocolo}}` antes do assign. Template `Consultor(a)` → `{{o_a_consultor}} *{{consultor}}*` + `Protocolo`.

Tabela `pos_venda_prepared_audio` + edge `pos-venda-audio-prep` (cron :05) gera TTS (Olá nome + saudação do slot + corpo) antes do envio. Auto-progress consome se `saudacao_bucket` bater; senão TTS ao vivo. Pacote Zap = só imagem+áudio. Helpers: `_shared/pos-venda-tts.ts`, `_shared/pos-venda-audio-prep.ts`. Doc: `#pos-venda`.

## 2026-07-27 — Pós-venda: áudio TTS do roteiro (não legacy.ogg)
Bug: preview mostrava `Olá, Nome` + `Muito boa tarde` + corpo, mas o Zap recebia `media_url` estático (`legacy_*.ogg`) sem personalização — TTS só rodava se `media_url` fosse null. Correção: `channel-sender` prioriza TTS quando `forbidText` ou template com `{{nome}}`/`{{saudacao}}`; migration zera `media_url` em `pos_venda_default_media` + `stage_auto_messages` pós-venda. Doc: `#pos-venda`.

## 2026-07-25 — Cérebro na memória always da IA
Garantir que qualquer chat saiba sem `#` manual:
- `#cerebro-fluxo-b` → **`inclusion: always`**
- Cursor rule `cerebro-vs-grupo-a.mdc` → **`alwaysApply: true`** (texto completo)
- Espelhos: `#product`, `#regras-duras`, `#armadilhas` #36, `AGENTS.md` invioláveis + árvore, `_shared/cerebro/AGENTS.md`
Conteúdo: 3 peças (cadência ≠ funil A ≠ Cérebro), tabela webhook, opt-in `cerebro_ativo` default off, modal, piloto Rafael, NÃO FAÇA.

## 2026-07-25 — Cérebro × Grupo A (como deve funcionar)
Regra de produto documentada: **Grupo A manda no funil de cadastro**; Cérebro é voz nas laterais (freeform / fora do cadastro / carteira), não substitui OCR/portal. Evidência: `fluxo-a-bypass` + `classifyCadastroInput` em `whapi-webhook`. Ativação: `cerebro_ativo` default **off**, opt-in no modal (`CEREBRO_OPT_IN`). Piloto Rafael `on`. Arquivos: `#cerebro-fluxo-b` · `#wa-webhook` item 10 · armadilha **#36** · `#glossario` Cérebro.

## 2026-07-25 — Pacote aplicado: design + velocidade (front)
Read-only audit Opus → código (sem deploy ainda):
- **P0 preload:** `vite.config.ts` — `manualChunks` função + `modulePreload.resolveDependencies`; build confirma preload só `react-vendor|radix|icons|supabase` (three/jspdf/charts/xyflow **fora** do `/auth`).
- **Touch desktop-no-mobile:** removido shrink `lg:min-h-0` / `lg:h-8` em WhatsApp (tabs, composer, send, mic, FlowQuickBar, VoiceTemplate, AiSuggest), Captação, Pós-venda, Produtos; `.nav-link` `min-h-11`.
- **Contraste:** `.painel-elite` / Ads light `--primary` → `152 100% 28%`; badges `--pe-*-ink`; `--pe-info` no dark.
- **Fontes:** Google Fonts via `<link>` no `index.html` (sem `@import` no CSS).
- **Scroll:** `min-h-0` em `/assistente` chat list.
- Gold Disparo PRO → `var(--pe-accent-warm)` (BulkPro/MessageEditor).
Não feito de propósito: caça total hex, dark-only `/assistente`, mudar `overflow-x: clip`.

## 2026-07-25 — Comando Opus: auditoria design + velocidade
Prompt read-only para Kiro/Opus 5 Max varrer UI (tokens, tema dual, botões, páginas) e performance (bundle, lazy, Web Vitals, fontes, FOUC). Regra de certeza: P0/P1 só com `path:linha` / screenshot / métrica. **Prioridade mobile:** celular + desktop-no-mobile; FASE 2B scroll/arrastar — cortar/travar/área morta = P0. Arquivos: `.cursor/commands/auditoria-design-velocidade.md` · `docs/PROMPT-AUDITORIA-DESIGN-VELOCIDADE-OPUS.md` · `#auditoria-design-velocidade`. Índice em `AGENTS.md` + `#mapa-tarefas`.

## 2026-07-25 — Auditoria IA no Sync (Gemini Flash)
Edge `sync-ai-audit` + tabela `sync_audit_traces` + `worker-igreen-sync/ai-audit.mjs`.
Mesmo modelo do Portal 2 (`gemini-2.5-flash`, ~$0.0002/run). Limite 20 sucessos; **falhas sempre**. WA em `sync_fail:*`. Env: `SUPABASE_URL` + `WORKER_TOKEN` no Easy Panel Sync.

## 2026-07-25 — Alerta ativo no WhatsApp do dono
Cron `super-admin-alerts` passou a checar falhas reais (kill, workers, Velip crédito, SMS undeliv, Whapi AUTH, caps, portal offline) e avisar via **Whapi** (`_shared/superadmin-alert.ts` → `super_admin_phone`). MinIO também. Dedup `infra_metrics`. Armadilha #35; `#erros-operacionais` §0b. **Não** alerta Evolution `needs_reconnect`.

## 2026-07-25 — Cliente proibido A/B/C
Helper `cliente-cadence-guard.ts` / `clienteCadenceGuard.ts`. Cadence-tick + trigger `tg_customer_journey_sync` + backfill 22 WON. Cliente (carteira/aprovado/pos_venda/andamento) só pós-venda + agenda. Armadilha #34; regras-duras caps.
**v2 hard lock:** `cadence_ensure_state_from_customer` não cria GREETED p/ sync; `tg_lead_cadence_block_cliente` força WON se alguém tentar abrir A/B/C p/ cliente. Os 974 do dashboard = carteira sync — nunca pizza A/B/C.

## 2026-07-25 — Playbook erros operacionais (memória da IA)
Novo `.kiro/steering/erros-operacionais.md` (`inclusion: auto`) + armadilhas **#28–#33**.
Fontes: 5 subagentes (Velip, bot/OCR, infra EasyPanel/Supabase, automação skips, wallet/portal/ads) + MCP SQL prod (IK/UNDELIV/Blocked text#270/BK_PROCON) + Context7 Supabase 401.
Cobre: crédito Velip (API sem saldo / sem gate), SMS aceito≠entregue, IA muda, OCR, 3 workers Easy Panel, checklist “não abre”, caps/prefs/DNC.
Índice: `AGENTS.md` árvore + `#mapa-tarefas` + reforço `#voz-sms`.

## 2026-07-25 — Opt-in automação por consultor
Tabela `consultant_automation_prefs` + modal/atalho “Minhas automações”. Gates em cadence-tick, daily-reheat, pos-venda, process-followups, faq-nudge, bot-followup. Seed ON quem já tinha pizza/outbound 14d. Armadilha #27: global ON ≠ consultor ON.

## Incidente 2026-07-24 — CPL Cérebro ~1/3 do real
Sintoma: aviso WA “CPL R$2 / sobe 15%” na âncora Uberlândia; Ads Manager ~R$90 / 14 conv = **R$6,50**.
Causa: `facebook-sync-metrics` somava `messaging_conversation_started` + `first_reply` + `total_messaging_connection`.
Fix: `_shared/meta-insight-actions.ts` (`pickMetaConversations` / `pickMetaLeads`); armadilha #26; métricas âncora corrigidas (14 conv, CPL R$6,48); budget DB → R$6,29 aguardando tick scale_down na Meta.
**Requer deploy** de `facebook-sync-metrics` (+ creatives + rodizio-metrics-broadcast) senão o cron re-triple.

## Round 10 — caminho 10/10 (cuidado + MCP)
Fontes: Supabase MCP (`execute_sql`, `get_advisors`) · Context7 (`/websites/agents_md`, `/supabase/supabase`) · analyzer Biome · 4 agentes paralelos.

### Doc / CI
- CI `check-agent-docs`: anchors, god-lines ±8%, símbolos canônicos, V3=sombra, nested novos, SQL `scripts/refresh-evidencia-prod-snippet.sql`
- Nested AGENTS: `sync-igreen-customers`, `_shared/bot`, `bulk-scheduler`, `finalize-capture`, `src/lib`
- Specs risco Evolution: banner Whapi em reliability/message-send/multiconsultor/channel-unification/_done evolution + scheduled + flow-v3
- `armadilhas`: cross-sell sem consumidor · V3 sombra · (quiet/needs_reconnect já cobertos)
- `EVIDENCIA-PROD` revalidada: counts estáveis; advisors **ERROR 2** (só exceções DEFINER)
- `cross-sell.md`: `avaliarCrossSell` sem consumidor de produção

### Código seguro
- Fatia pura `flow-predicates.ts` (+ testes) nos 2 bot-flows — Deno **21 passed** (predicates + step/holder/confirm)

## Round 9 — auditoria código × documentação
Cruzamento código + MCP prod. **Claims operacionais OK** (kill outbound-only, PV sem `bot_global`, agenda sem quiet, dryRun Fluxo B, caps 150/50/200, views 3 invoker + 2 DEFINER, helpers importados nos 2 bot-flows, nested AGENTS).

Correções factuais aplicadas:
- `wa-webhook.md`: ordem real V3 sombra → Cérebro → `runEngine()`; retentativa antes dos motores; contagens bot-flow; citação CTWA/rodízio
- `cerebro-fluxo-b.md` / `voz-sms.md` / `armadilhas` / `mapa-dominios` (ver hist. round 9)

## Round 8
- `ads-contraste`, `cerebro-mg-e-rodizio`, `minio-storage` → **inclusion: auto**
- `name` + `description` em steers que faltavam
- Nested AGENTS: `evolution-webhook`, `send-scheduled-messages`, `voice-dialer-webhook`, `src/components/whatsapp`
- Extração: `_shared/bot/holder-match.ts` + `confirmation-formatters.ts` (70 testes Deno)
- CI drift: valida name/description, mapa→steering, nested AGENTS
- Specs high-risk: `agentStatus` em `.config.kiro`

## Round 7 — engenharia (não só markdown)

### Views (MCP apply_migration + SQL local)
- `security_invoker=true`: `v_boletos_carteira`, `cadence_metrics_daily`, `igreen_recon_queue_progress`
- DEFINER **mantido de propósito**: `consultants_public`, `platform_facebook_audience_status` (documentado em `#security-auth`)
- Evidência pós-migrate: reloptions conferidos via SQL

### UI DNC
- VozTab, HandoffLeadsDialog, VoiceDashboardPanel, VoiceCallHistoryPanel, VoiceDncPanel, CloseAttendanceBatchDialog

### CI drift
- `scripts/check-agent-docs-drift.sh` · `npm run check:agent-docs` · job CI `agent-docs-drift`

### God-file (PR mínima segura)
- `_shared/bot/step-interaction.ts` + testes
- Import em whapi + evolution `bot-flow.ts`
- Deno: **62 passed** (step-interaction + bot-flow_test ambos canais)

## Round 6 — (anterior) evidência doc
… ver histórico abaixo / `#evidencia-prod`

### Novos steerings (com evidência prod embutida)
- `wa-webhook.md`
- `cerebro-fluxo-b.md`
- `voz-sms.md`
- `agendamentos-hub.md`
- `cross-sell.md`
- `EVIDENCIA-PROD.md` (snapshot SQL + advisors 199 sec / 792 perf)

### Nested AGENTS.md
- `supabase/functions/whapi-webhook/AGENTS.md`
- `supabase/functions/cadence-tick/AGENTS.md`
- `supabase/functions/pos-venda-auto-progress/AGENTS.md`
- `supabase/functions/_shared/cerebro/AGENTS.md`

### Anti-ruído specs
- `.kiro/specs/STATUS.md` (archived / active-ref / Evolution-first risk)

### Índice
- `AGENTS.md` árvore de decisão + índice + exceção kill switch vs pós-venda
- `mapa-dominios.json` (round 5, ainda válido; doc_status dos missing → ok)

## Evidência-chave (revalidar em `#evidencia-prod`)
- 1270 customers · 1115 sync · 1114 PV espera
- Caps B150/C50/G200 · janela reheat 08–20 · live on
- Voz: 685 calls (IK=9) · DNC 26 · dedup 1363
- Advisors: baseline de 5 views `SECURITY DEFINER` remediado em 3; 2 exceções seguem documentadas
- Skip 7d agenda: 1115

## Ainda aberto (pós-round 10 — não bloqueia nota de doc)
1. ~~P0 RPC~~ **feito** (`20260724140000`): cron admin + claim_scheduled só `service_role`. Restam 21 anon+DEFINER (P1–P3).
2. Mais fatias `bot-flow` (PRs pequenas, espelho Whapi↔Evolution).
3. Perf advisors (RLS initplan / índices) — só com medição.
4. Revisar quem no front lê `platform_facebook_audience_status`.
5. WARN security restante em RPCs `authenticated`+DEFINER (155) — mapa; não massa.

## Convenção
Regra nova → `regras-duras`/`armadilhas` + `mapa-dominios.json` + (se número) `EVIDENCIA-PROD.md`.
