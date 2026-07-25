# Auditoria Final Completa — Plataforma iGreen (Kiro / Opus 5 Max)

Use este comando quando for a **última varredura** da plataforma antes de parar de mexer no código.
Responda em **pt-BR**. Modo **somente leitura + relatório**. **NÃO** edite, **NÃO** faça deploy, **NÃO** ligue toggle, **NÃO** envie WhatsApp/SMS/voz real, **NÃO** gaste Meta Ads.

Texto opcional após o comando = foco extra (ex.: `/auditoria-final-plataforma só CRM+pos-venda`).

---

## Como colar no Kiro (Opus 5 Max)

1. Abra o workspace `igreen-official-portal` (repo `igreen-page-magic`).
2. Cole o bloco **PROMPT** abaixo inteiro.
3. Modelo: **Opus 5 Max** (ou equivalente high/max thinking).
4. Peça subagentes em paralelo por domínio se o Kiro permitir.
5. Entrega obrigatória: relatório único com GO/NO-GO e evidências.

Arquivo canônico (mesma cópia): `docs/PROMPT-AUDITORIA-FINAL-OPUS.md`

---

# PROMPT

```text
Você é auditor sênior de produção (fullstack + ops + segurança) do iGreen Official Portal.
Esta é a AUDITORIA FINAL: varrer a plataforma DE FORA A FORA, começando pela UI do consultor
(Dashboard → CRM Lead → CRM Pós-venda → abas seguintes) e descendo até edges, workers,
crons, banco, secrets e alertas. Não deixe domínio de fora.

═══════════════════════════════════════════════════════════════════════════════
A) MODO E RESTRIÇÕES (INVIOLÁVEIS)
═══════════════════════════════════════════════════════════════════════════════

- SOMENTE LEITURA + RELATÓRIO. Zero patch, zero migration apply, zero deploy, zero toggle.
- Não invente arquivo, coluna, flag ou “deve existir”. Se não achar: DIGA “não encontrado”.
- Produção está LIGADA. Não dispare envio real (WA/SMS/voz/Meta). Preferir dryRun / SQL read.
- Responda em português (Brasil). Código/IDs/logs em inglês ok.
- Antes de editar mentalmente qualquer coisa: classifique o domínio e abra o steering.
- Whapi é canal primário; Evolution `needs_reconnect` ≠ Zap offline.
- Campanha/rodízio = UUID (`facebook_campaigns.id` → `customers.source_campaign_id`), nunca cidade/texto.
- CRM cadastro em análise ≠ lead em conversa ≠ Meta em análise (`src/lib/crmVsLeadAnalysis.ts`).
- Nome do cliente: só com fonte confiável (`safeFirstNameForAddress`). Na dúvida, sem “Oi Nome”.
- Nome do consultor ao lead: `resolvePublicConsultantLabel` (nunca `display_name || name` cru).
- Protocolo `2026-####` só no banco/admin — nunca appendar em mensagem WA.
- Caps A/B/C: A ilimitado; B `cap_b`; C `cap_c`; global B+C `cap_global_outreach`.
- Cliente de carteira NÃO recebe cadência A/B/C (`isClienteProibidoCadenciaABC`).
- Kill switch: `app_settings.bot_global_enabled` + `isBotGloballyEnabled`. Pós-venda ignora bot_global.
- Agenda humana (`send-scheduled-messages`) SEM quiet hours.
- Prefs consultor: sem row / pack OFF = skip daquele consultor (`consultant_automation_prefs`).

═══════════════════════════════════════════════════════════════════════════════
B) FONTES OBRIGATÓRIAS (LER ANTES DE CONCLUIR QUALQUER DOMÍNIO)
═══════════════════════════════════════════════════════════════════════════════

Ordem de carga (não pular):
1. `AGENTS.md` (protocolo + árvore de decisão)
2. `.kiro/steering/mapa-dominios.json` (inventário domínio→código)
3. `.kiro/steering/regras-duras.md` + `armadilhas.md` + `erros-operacionais.md`
4. `.kiro/steering/product.md` + `tech.md` + `structure.md` + `EVIDENCIA-PROD.md` (se existir)
5. Por domínio: steering da tabela abaixo + nested `AGENTS.md` se houver
6. Evidência prod: Supabase MCP (`execute_sql`, `get_advisors`, `list_edge_functions`, logs) quando disponível
7. Specs antigas: `.kiro/specs/STATUS.md` — várias são Evolution-first / archived; NÃO seguir como verdade

Helpers canônicos (NÃO reimplementar na análise — cite se forem violados):
- `src/lib/crmVsLeadAnalysis.ts` / `_shared` equivalentes
- `safeFirstNameForAddress` · `resolvePublicConsultantLabel`
- `consultant-automation-prefs` · `cliente-cadence-guard`
- `_shared/channel-sender.ts` · `_shared/bot/global-flag.ts`
- `_shared/deterministic-campaign-resolver.ts` · rodízio RPC `rodizio_assign_lead`
- `_shared/superadmin-alert.ts` · edges `super-admin-alerts` · `sync-ai-audit` · `portal2-ai-audit`

═══════════════════════════════════════════════════════════════════════════════
C) ORDEM DE VARREDURA UI → BACKEND (NÃO PULAR SEÇÃO)
═══════════════════════════════════════════════════════════════════════════════

Percorra nesta ordem. Para CADA item: (1) entrada UI/rota (2) hooks/queries (3) edges/RPCs
(4) tabelas (5) crons/workers (6) falhas conhecidas / armadilhas (7) evidência prod se possível.

### FASE 0 — Shell / Auth / SuperAdmin
- `/auth`, `ProtectedRoute`, roles consultor vs super_admin
- `/super-admin`: BotGlobalKillSwitch, InfraHealth, crons, secrets, advisors
- `/admin/saude-producao`, `/admin/saude-bot`
- RLS / JWT / CORS (`buildCors`) / `assertCronAuth` / `ENFORCE_CRON_AUTH`

### FASE 1 — Dashboard consultor (`/admin` tab dashboard)
- Cards de pizza A/B/C, countdown, caps, prefs “só desligados”
- Métricas leads/conversas, atalhos
- Inconsistência: número na UI ≠ query canônica / helper CRM vs lead
- `ConsultantAutomationPrefsCard` variant offOnly vs Configurações completo

### FASE 2 — WhatsApp / Chat / Captação
- Aba WhatsApp: Whapi health AUTH, envio manual, mídia MinIO
- Webhook: `whapi-webhook` (primário) vs `evolution-webhook` (legado) — paridade
- Dedupe `webhook_message_dedup`, throttle, idempotência outbound
- Ordem motores: V3 sombra → Cérebro/Fluxo B → `runBotFlow`
- Handoff / bot_paused / “esquecer handoff” / preview conversa
- CTWA / atribuição campanha UUID; sem protocolo na msg

### FASE 3 — CRM Lead (Kanban / captação / “em conversa”)
- Distinção pizza A vs CRM cadastro em análise vs Meta em análise vs bloqueado
- Steps: NEW → GREETED → AI_QUALIFYING → portal → OTP/facial/assinatura
- OCR conta/doc (Gemini); fatura = `/extractor/extract` NÃO `extract-receipt`
- Portal 2 worker Easy Panel; Redis BullMQ; `worker_offline` / `portal-offline-retry`
- Auditoria Portal2 (`portal2-ai-audit` / `portal2_audit_traces`)

### FASE 4 — CRM Pós-venda / Clientes iGreen / Sync carteira
- Aba clientes iGreen / sync; worker `worker-igreen-sync` (Evomi/proxy)
- Edge `sync-igreen-customers`; setting `igreen_sync_worker_url` (nunca portal2 URL)
- Pós-venda D30–D210 + retentativa; toggles `pos_venda_*` (ignora bot_global)
- Cliente proibido A/B/C; só pós-venda + agenda
- Auditoria Sync (`sync-ai-audit` / `sync_audit_traces`); alerta WA em falha
- Club worker separado (`club_*` ≠ `portal2_*`)

### FASE 5 — Cadência A/B/C / Motor / Reaquecimento / Textos
- `cadence-tick`, STAGE_MAP, caps, janela BRT, weekdays
- Prefs consultor + toggles + `cadence_engine_enabled`
- `daily-reheat` live_dispatch; Grupo B vs C (RECALL_*)
- Textos bot_flows / FluxoBuilder / textos `multichannelCadenceTexts`
- `automation_skip_log` reasons; quiet hours só bot
- Identity consultor / phone_dead / DNC

### FASE 6 — Agendamentos Hub
- Timeline multi-motor; `send-scheduled-messages` sem quiet hours
- Claim/rastreio; falhas de agenda vs Zap

### FASE 7 — Voz / SMS (Velip)
- `voice-dialer-*`, crédito (API sem saldo), #250 Procon ≠ crédito
- UNDELIV ≠ sms_sent; auto-DNC IK/EK/CK/BK
- Cross-channel dead phone

### FASE 8 — Meta Ads / Cérebro MG / Rodízio / Parceiros
- Wizard ads, waste guard, CAPI, sync metrics (`pickMetaConversations` — NÃO somar action_types)
- Cérebro autonomia: modo atual; não sugerir ligar targeting_patch/create_object sem pedido
- Rodízio parceiros RPC; QR/keyword/`short_code`; notify parceiro
- Hardening Ads: secrets, SSRF, cron auth estrito

### FASE 9 — Carteira / Stripe / Comissão
- wallet-*, débitos idempotentes, saldo consultor

### FASE 10 — Esteira multi-produto / Cross-sell / Solar 3D / Suporte remoto
- Esteira ≠ pós-venda WA
- Cross-sell: card/manual; NÃO massa; sombra Cérebro
- Solar 3D Google Solar
- Remote support código acesso

### FASE 11 — IA / Cérebro / Fluxo B / OCR / Knowledge
- Produção `responderComCerebro` ≠ simulador `fluxo-b-ai` dryRun
- Guarda / handoff / latência 25s
- Knowledge admin; áudios Sofia

### FASE 12 — Workers Easy Panel / MinIO / Infra
- Portal2 · Sync · Club (URLs separadas; typo d9v83a)
- MinIO quota/alertas Whapi
- Redis Portal2 (`igreen_evolution-api-redis`)
- Crons: inventário `cron.job` (1min/5min/15min); `super-admin-alerts-15min`
- Alertas ops: kill, workers, Velip, SMS undeliv, Whapi AUTH, caps, portal offline

### FASE 13 — Segurança transversal
- `verify_jwt` vs auth custom; secrets em chat/logs
- Advisors security/perf; RPC anon SECURITY DEFINER (`RPC-ANON-DEFINER-INVENTARIO`)
- Views DEFINER intencionais vs invoker
- CORS `*`; SSRF; webhook origin grace

### FASE 14 — Frontend qualidade / tema / rotas
- `src/App.tsx` + `#rotas-ui`; abas Admin.tsx
- Dual theme; naming; ChunkLoadError / SW recover
- Typecheck/lint hotspots se evidentes (sem “consertar”)

### FASE 15 — Docs drift / steering vs código
- `npm run check:agent-docs` se rodar local
- Specs archived Evolution-first
- `AUDITORIA-STEERING.md` vs realidade 2026-07-25+

═══════════════════════════════════════════════════════════════════════════════
D) CHECKLIST DE SINTOMAS (deve mapear cada um a status OK / RISCO / QUEBRADO)
═══════════════════════════════════════════════════════════════════════════════

Para cada sintoma: causa canônica + onde olhar + se ainda existe no código/prod.

1. Evolution needs_reconnect assusta como Zap offline
2. Misturar 3 “em análise”
3. Rodízio por cidade/keyword
4. “Oi Nome” com nome lixo
5. Protocolo na mensagem WA
6. Portal1 / URL sync no portal / typo Easy Panel
7. Quiet hours em agenda humana
8. Motor global ON = consultor ON (prefs)
9. Velip sem crédito “pausa sozinho”
10. sms_sent = entregue
11. Somar action_types Meta (CPL ~1/3)
12. Cliente carteira na pizza A/B/C
13. Worker offline Redis / 502 sem alerta
14. Alertas via Evolution em vez de Whapi
15. Pós-venda bloqueado por bot_global
16. Cross-sell em massa
17. V3 já decide turno (ainda sombra)
18. Fatura via extract-receipt
19. Cron sem assertCronAuth / 401 enforce
20. Club misturado com Portal2

═══════════════════════════════════════════════════════════════════════════════
E) EVIDÊNCIA PROD (OBRIGATÓRIA SE MCP/SQL DISPONÍVEL)
═══════════════════════════════════════════════════════════════════════════════

Rodar / reportar (números reais, não memória):
- `app_settings`: bot_global, cadence_engine, super_admin_phone
- `daily_reheat_settings`: enabled, live_dispatch, caps
- Contagens: customers, lead_cadence_state por stage, pos_venda, do_not_contact
- `automation_skip_log` top keys 7d
- voice_call_logs / voice_sms_log status 7d
- `cron.job` active + schedules quentes (* / */5 / */15)
- `infra_metrics` ops_alert / minio_alert recentes
- `sync_audit_traces` / `portal2_audit_traces` counts
- Health HTTP: portal2 `/health`, sync `/health` (ai_audit, queue, egress)
- `get_advisors` security ERROR/WARN (não “consertar” DEFINER intencional)
- Edges críticas: updated_at / existência (whapi-webhook, cadence-tick, super-admin-alerts, sync-ai-audit)

Se MCP indisponível: declare LIMITAÇÃO e continue só com código.

═══════════════════════════════════════════════════════════════════════════════
F) MÉTODO DE TRABALHO (OPUS MAX)
═══════════════════════════════════════════════════════════════════════════════

1. Explore com subagentes em paralelo por FASE (UI, WA, CRM, Sync/PV, Cadência, Ads, Voz, Infra/Sec).
2. Cada finding: severidade · domínio · sintoma · evidência (path:linha ou SQL) · impacto prod · recomendação (sem implementar).
3. Severidades: P0 (perda dinheiro/envio errado/segurança) · P1 (quebra jornada) · P2 (risco/ops) · P3 (dívida/doc).
4. Não proponha “ligar autonomia Ads / massa / novo motor” sem pedido explícito do humano.
5. Se doc e código divergem: marque DOC_DRIFT e diga qual dos dois parece verdade (com âncora).

═══════════════════════════════════════════════════════════════════════════════
G) FORMATO DO RELATÓRIO FINAL (ÚNICO ARTEFATO)
═══════════════════════════════════════════════════════════════════════════════

# Auditoria Final iGreen — <data>

## 0. Veredito executivo
- GO / GO COM RESSALVAS / NO-GO para “parar de mexer”
- Top 5 riscos reais agora
- O que está saudável (não só o que está ruim)

## 1. Mapa UI percorrido
Tabela: Aba/Rota → ok/risco → nota curta (Dashboard, WhatsApp, CRM Lead, CRM PV, Motor, Ads, Voz, Agenda, SuperAdmin, …)

## 2. Findings P0 / P1 / P2 / P3
Para cada: ID · título · domínio · evidência · impacto · ação sugerida (humano decide)

## 3. Checklist sintomas (20 itens) — status

## 4. Evidência prod (números)

## 5. Crons e carga
Comentar se algum cron é perigoso/redundante; NÃO pedir remoção em massa sem critério

## 6. Segurança / advisors

## 7. Workers Easy Panel
Portal2 · Sync · Club · Redis · MinIO · alertas WA

## 8. DOC_DRIFT

## 9. O que NÃO precisa mexer (lista explícita)

## 10. Próximos 7 dias (só se P0/P1)
Máximo 5 itens, ordenados, sem scope creep

Fim. Sem implementação nesta sessão.
```

---

## Notas para o humano

- Esta auditoria é **read-only**. Depois do relatório Opus, você decide o que (se algo) entra em código.
- Segredos que vazaram em chat: rotacionar fora desta auditoria.
- Comando Cursor espelho: `/auditoria-final-plataforma`
