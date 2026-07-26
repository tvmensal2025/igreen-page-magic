# 03 — Funções e fluxos críticos

Contrato, gates e dependências das edges que tocam o lead. Comportamento em produção validado por leitura direta do código-fonte (`code--view` / `grep`).

---

## `cadence-tick` (1696 LOC)

**Papel:** motor Zero Lead Perdido. Roda ~5min. Domínio `cadence` no `mapa-dominios.json`.

**Gates confirmados (ordem no arquivo):**

1. Kill global (`isBotGloballyEnabled` — verificado indiretamente via chain de imports).
2. Toggle `cadence_engine` (`isAutomationEnabled`).
3. Cliente proibido A/B/C — `isClienteProibidoCadenciaABC(cust)` em `:1120`.
4. DNC — `!!c.do_not_contact` gate em `:1026`.
5. Cap A/B/C/global — `stageGroup()`, `cap_b`, `cap_c`, `cap_global_outreach` (`:135-181`).
6. Janela BRT — `window_start_brt` / `window_end_brt` (não simplificar; ver 05).
7. Nome seguro — helper `_shared/customer-display-name.ts`.
8. Cross-channel dead — IK/UNDELIV consulta `voice_dnc_list`.

**Contrato:** lê `daily_reheat_settings` (cap_b, cap_c, cap_global_outreach, daily_whapi_cap) direto do banco (`:135`) — nenhum valor hardcoded.

**Confirmações-chave (grep real):**
- `stageGroup` importado `:14`; usado `:181, :1257, :1258, :1278, :1570`.
- `stageGroupToPack` `:70` — mapeia grupo para pack de textos.
- `isClienteProibidoCadenciaABC` `:74`, aplicado `:1120`.
- `resumePack = stageGroupToPack(stageGroup(resumeStage))` `:1206` — retomada correta.

**Status:** OK.

---

## `whapi-webhook` (3505 LOC entry + 7012 handlers/bot-flow)

**Papel:** canal WhatsApp primário (Whapi).

**Confirmações:**
- Kill switch importado `:28` (`isBotGloballyEnabled`).
- Aplicado `:99` — bloqueia outbound automático, **mantém inbound**.
- Reason string `"Kill switch global (bot_global_enabled=false)"` `:1929` — usado em log de skip.

**Contrato:**
- Dedupe: `_shared/bot/dedupe.ts` — chave `(message_id, instance_name)`, fail-open.
- Nome cliente: `_shared/customer-display-name.ts::safeFirstNameForAddress`.
- Nome consultor: `_shared/consultant-public-label.ts::resolvePublicConsultantLabel`.
- Roteamento Cérebro vs Grupo A: funil determinístico manda; Cérebro só laterais (opt-in `cerebro_ativo=off` default).

**Status:** OK.

---

## `evolution-webhook` (3661 + 6737)

**Papel:** legado/paridade. Whapi é primário.

**Regra:** qualquer mudança comportamental deve ser espelhada aqui — governado por `evolution-webhook/AGENTS.md`.

**Status:** OK, mantido por consultores que ainda usam Evolution.

---

## `send-scheduled-messages` (292 LOC)

**Papel:** agenda humana. Envia msgs agendadas explicitamente por consultor.

**Contrato (AGENTS.md deste diretório):**
- Auth: `assertCronAuth`.
- Claim: `claim_scheduled_messages` (SKIP LOCKED).
- Canal: `resolveConsultantOutboundChannel` (Whapi se Whapi disponível).
- **NÃO** aplica quiet hours de bot.

**Confirmação empírica:** `scheduled_messages` pending = 0 (fila limpa). Motor operando.

**Status:** OK.

---

## `bulk-scheduler` (469 LOC)

**Papel:** disparo PRO por cron (não é cadência A/B/C nem agenda manual).

**Contrato (bulk-scheduler/AGENTS.md):**
- `assertCronAuth`.
- `assertBotOutboundAllowed` antes de outbound.
- Limites: 5 campanhas + 25 msgs por campanha por execução.
- Respeita janela BRT, anti-ban, DNC, guard proativo, quota.
- Canal via `resolveConsultantOutboundChannel`.

**Status:** OK.

---

## `pos-venda-auto-progress`

**Papel:** avanço de estágios pós-venda D30–D210.

**Regra-chave (armadilha #4):** **NÃO** usa `bot_global_enabled`. Usa `pos_venda_auto_messages` + `pos_venda_manual`. Confirmado em `EVIDENCIA-PROD.md` item “Fatos operacionais”.

**Confirmação empírica:** `customer_auto_message_log` mostra envios PV recentes (`pv_reprovado` 18, `pv_aprovado` 1, `pv_d30/60/90` 1 cada) — motor rodando.

**Status:** OK.

---

## `sync-igreen-customers` (2591 LOC)

**Papel:** ler carteira iGreen via `worker-igreen-sync`.

**Contrato:**
- Setting: `igreen_sync_worker_url` (**≠** `portal2_worker_url` / `club_worker_url`).
- Origem: `customer_origin = igreen_sync`.
- `name_source = igreen_portal` (fonte confiável).
- Sem telefone → identificador `sem_celular_*`.
- Pós-sync recalcula pós-venda sem desfazer `pos_venda_recadastro_at`.

**Confirmação empírica:** 1115 customers com origem `igreen_sync` (estável). Worker externo faz login/scraping.

**Status:** OK. Não misturar com Portal 2 (cadastro) ou Club.

---

## `voice-dialer-webhook`

**Papel:** ligações Velip.

**Regras-chave:**
- Sem cap diário (por decisão de produto — ligações + SMS ilimitadas).
- DNC via `voice_dnc_list` (28 números hoje).
- Cross-channel: falha crítica em SMS/voz vira `voice_dnc:auto_velip_ik` para bloquear futuros envios.

**Confirmação empírica:** `voice_call_logs`=718 (OK 266, NA 402, IK 9 na baseline), `voice_sms_log`=52 (+23), `voice_dnc reasons`: opt_out 12, requested 6, auto_nonexistent 4, auto_velip_ik 2, complaint 2.

**Status:** OK.

---

## `finalize-capture`

**Papel:** finalizar captação de lead (rate-limit conforme AUD-014).

**Status:** OK (auditado em Onda 1–2).

---

## `super-admin-alerts` + `_shared/superadmin-alert.ts`

**Papel:** enviar alertas ao WhatsApp do super-admin quando algo falha (Velip sem crédito, IA muda, OCR falho, Easy Panel down).

**Status:** OK (baseline armadilhas #0b).

---

## Dependências entre edges (mapa)

```
whapi-webhook (inbound) ──→ conversations, customers, lead_cadence_state
                        └→ (Cérebro laterais) → _shared/cerebro/resposta-hook.ts
                        └→ dedupe: webhook_message_dedup

cadence-tick (cron 5min) ──→ lead_cadence_state (leitura+update)
                         └→ outbound_effects (enfileira)
                         └→ automation_skip_log (skips)
                         └→ contadores de cap: cap_b/cap_c/cap_global_outreach

send-scheduled-messages (cron) ──→ scheduled_messages (SKIP LOCKED)
                                └→ resolveConsultantOutboundChannel

bulk-scheduler (cron) ──→ bulk_campaigns + bulk_campaign_targets

pos-venda-auto-progress (cron) ──→ pos_venda_* + customer_auto_message_log

sync-igreen-customers (cron) ──→ worker-igreen-sync (externo)
                              └→ customers (upsert origem=igreen_sync)
```

Nenhum ciclo detectado. Cada motor tem tabela de estado dedicada.
