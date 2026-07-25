---
inclusion: auto
name: erros-operacionais
description: Playbook sintoma→causa→ação para Velip (crédito/SMS/ligação), IA muda, OCR, Easy Panel, Supabase 401/500, automação que não manda, carteira, Portal/Club/Sync. Use quando o usuário perguntar por que falhou, parou, não chegou, não abre, sem crédito, ou “o que fazer”.
---

# Erros operacionais — playbook para a IA (não esquecer em 1 mês)

**Quando usar:** qualquer “parou / não mandou / não chegou / não abre / sem crédito / OCR falhou / Easy Panel / Supabase”.  
**Ordem:** sintoma → 1 SQL/log → ação. **Não** inventar; consultar prod.

Evidência prod (amostra 2026-07-25):
- Voz 30d: NA 424 · OK 276 · **IK 9**
- SMS 30d: DELIVRD 25 · UNDELIV 9 · **Blocked text#270** 6 · EXPIRED 2 · REJECTD 1
- Calls err: **BK_PROCON#250** 6 · number invalid#203 1
- Velip **não expõe saldo** na API v2 → painel Velip; código **não** pausa por crédito zerado

Domínios detalhados: `#voz-sms` `#wa-webhook` `#cerebro-fluxo-b` `#portal2-fluxo-canonico` `#agendamentos-hub` `#security-auth` `#deploy` `#wallet-stripe` `#armadilhas`.

---

## 0b) Alerta ativo no WhatsApp do dono (você não precisa lembrar)

Cron `super-admin-alerts` (~15 min) + `minio-quota-check` mandam **WhatsApp via Whapi** para `app_settings.super_admin_phone` (fallback: telefone do `superadmin_consultant_id`).

Helper: `_shared/superadmin-alert.ts` (`notifySuperAdminOpsAlert`). Dedup em `infra_metrics` (`ops_alert` / `minio_alert`).

| Dispara alerta | O que checa |
|---|---|
| 🚨 Bot global OFF | `bot_global_enabled=false` |
| ⚠️ Cadência OFF | `cadence_engine_enabled=false` |
| 🚨 Worker offline | `/health` Portal2 / Sync / Club (502, timeout, Redis DNS) |
| 🚨 Portal2 Redis/fila | health 200 mas `queue≠redis-bullmq` |
| ⚠️ Portal2 AI audit | `ai_audit.healthy=false` |
| 🚨 Velip crédito | erros credit/saldo ou `balance_after=0` failed |
| ⚠️ Pico Procon | ≥5 `BK_PROCON` /24h (não é crédito) |
| ⚠️ SMS undeliv | ≥5 UNDELIV/REJECTD/EXPIRED e ≥ DELIVRD /6h |
| 🚨 Leads `worker_offline` | ≥3 em 24h |
| ⚠️ Cap outreach | ≥20 skips de cap /6h |
| 🚨 Whapi sem AUTH | `/users/profile` falhou |
| 🚨/⚠️ MinIO | offline ou % ≥ limiar |

**NÃO** alerta Evolution `needs_reconnect` (Whapi é primário). Sem `super_admin_phone` / `whapi_token` → grava métrica `sent:false` e silencia.

## 0) Triagem em 60 segundos

| Usuário diz | Primeiro olhar |
|---|---|
| Não liga / SMS sumiu | `voice_call_logs` / `voice_sms_log` + painel Velip (crédito) |
| IA não responde no Zap | `bot_global` → `bot_paused` / handoff → Whapi `AUTH` → `ai_decisions` |
| Conta/doc não lê | `ocr_*_attempts` + pause `ocr_*` + Portal `IA_*` |
| Cadastro trava | Easy Panel health Portal2 / Club / Sync (URLs **diferentes**) |
| Site não abre | Cache/Chunk → CORS/401 → Supabase status → workers |
| Pizza não manda | toggles + prefs consultor + caps + janela + DNC |
| Ads / CPL estranho | `#armadilhas` #26 (nunca somar action_types Meta) |
| “Por que ninguém me avisou?” | `infra_metrics` `ops_alert` + cron `super-admin-alerts` |

```sql
-- Skips recentes
SELECT key, meta->>'reason' AS reason, meta, created_at
FROM automation_skip_log
WHERE created_at > now() - interval '2 days'
ORDER BY created_at DESC LIMIT 50;

-- Kill + cadência
SELECT bot_global_enabled, cadence_engine_enabled
FROM app_settings WHERE id = 'global';

-- Prefs (SEM ROW = tudo OFF)
SELECT * FROM consultant_automation_prefs WHERE consultant_id = :cid;
```

---

## 1) Velip — crédito, ligação, SMS

### Crédito / saldo zerado (CRÍTICO)
| | |
|---|---|
| **Sintoma** | Liga/SMS falha; UI saldo “—”; gasto some se callback trouxer custo |
| **Causa** | API v2 **não retorna saldo** (`GetUserID`). **Não há gate** no código que pause por crédito |
| **Onde** | Painel Velip; `voice-dialer-health`; `voice_call_logs.velip_saldo_after` / `velip_cost`; erros `#250` / `BK_PROCON#250` |
| **Fazer** | Recarregar crédito no **painel Velip**; retestar 1 SMS/1 call |
| **NÃO** | Esperar `bot_global` ou pause automática por saldo Velip (não existe) |

### Ligação falhou
| Código | Significado | Ação |
|---|---|---|
| **OK** | Atendeu | Normal; pode pausar cadência |
| **NA** | Não atendeu | Retry / SMS fallback se toggle |
| **IK** | Inexistente | Auto-DNC; **não** religar |
| **EK** | Inválido | Auto-DNC |
| **BK** | Não perturbe / Procon | Auto-DNC (`BK_PROCON#250`) |
| **CK** | Bloqueado operadora | Tratar como morto (`isReprovedVelipCode`) |
| — | `velip_not_configured` | Secret `VELIP_API_TOKEN` |

Cross-channel: IK/EK/CK/BK **ou** ≥2 UNDELIV SMS/72h → `phone_dead:*` / `voice_dnc_list` → não gastar saldo.

### SMS “mandou mas não chegou”
| | |
|---|---|
| **Sintoma** | Motor `sms_sent:ID` mas celular só 1 msg |
| **Causa** | Velip **aceitou** (`voice_sms_log.status=sent`) mas operadora não entregou / anti-spam em **rajada**; só `DELIVRD` = entregue |
| **Onde** | `voice_sms_log`: `delivery_status` null vs `DELIVRD` / `UNDELIV` / `REJECTD` / `EXPIRED` |
| **Erros permanentes** | `Blocked text#270`, `#240` mobile invalid, `#203` number invalid → `isPermanentSmsFailure` |
| **Fazer** | Esperar recibo; em teste **não** disparar 6 SMS em 4 min; no C real os SMS são dias/meses apart |
| **NÃO** | Assumir bug do Grupo C se `sms_sent` + IDs distintos |

### Velip off / webhook
- `velipConfigured()===false` → `velip_not_configured`
- Webhook: `?auth=` (`VELIP_WEBHOOK_AUTH`); sem assinatura HMAC
- Tokens: nunca logar; só Edge env

Detalhe: `#voz-sms`.

---

## 2) IA parou de responder / Cérebro / stuck

Ordem Whapi: V3 sombra → Cérebro → `runBotFlow` (`#wa-webhook`).

| Sintoma | Causa | Onde | Ação |
|---|---|---|---|
| Mudo total | `bot_global_enabled=false` | `app_settings` / `BotGlobalKillSwitch` | Ligar; inbound já salvo |
| Mudo 1 consultor | `ai_agent_config` OFF / prefs | prefs + config IA | “Minhas automações” + IA |
| Humano assumiu | `bot_paused` / `assigned_human_id` | customers + handoff UI | Voltar pizza / despausar |
| Cérebro timeout | >25s → handoff vazio | log teto 25s; `ai_decisions` | Humano; latência LLM |
| Guarda barrrou | `shouldHandoff` / texto vazio | `ai_decisions` phases cerebro | Ver motivo Guarda |
| Stuck idle | `bot-stuck-recovery` | toggle + quiet_hours | Esperar janela / 3 rescues → manual |
| Simulador ≠ prod | `fluxo-b-ai` dryRun | `#cerebro-fluxo-b` | Prod = `responderComCerebro` |

Pauses comuns: `ocr_*_max_retries`, `ai_handoff_duvidas`, `lead_pediu_humano`, `*_retry_exhausted`, `opt_out`, `low_confidence_handoff`.

---

## 3) OCR / Portal / Easy Panel

### OCR
| Sintoma | Causa | Ação |
|---|---|---|
| “Não li a conta” | OCR fail / foto ruim | Nova foto; após ~2 retries → handoff |
| Doc na hora da conta | salvage | Ainda precisa da **conta** |
| `IA_REPROVADA_CONTA` | Usou `extract-receipt` | Fatura = `POST /extractor/extract` |
| `IA_CONTA_ILEGIVEL` | <2/4 campos | Nova foto / humano |
| Sem Gemini key | `GEMINI_API_KEY` | Secret edge |

### Easy Panel (3 workers ≠ misturar)
| Worker | Setting | Health |
|---|---|---|
| Portal 2 | `portal2_worker_url` | `/health` cadastro |
| Club | `club_worker_url` (~3102) | `/health` + Evomi se CF 403 |
| Sync carteira | `igreen_sync_worker_url` | `https://igreen-worker-igreen.d9v63q.easypanel.host/health` mode `tor+playwright+…` |

**NÃO** copiar typo `d9v83a` / localhost / URL do portal no sync.

| Sintoma | Ação |
|---|---|
| `worker_offline` | Rebuild Easy Panel; secret + URL; `portal-offline-retry` |
| Club CF blocked | Evomi `CLUB_PROXY_*` |
| OTP/facial | `portal-otp-watchdog`; `submit-otp`; não fail permanente em 502/503 |
| Sync WAF 503 | Proxy Evomi + sticky; rebuild `server.mjs` |

---

## 4) Supabase / “não abre” / cron 401

Checklist **plataforma não abre** (estreito → largo):

1. Hard refresh / `?sw-recover` (ChunkLoadError)
2. Toast timeout 15s REST / 90s functions → edge lenta ≠ Zap
3. Login 401 → re-login JWT
4. CORS → `buildCors` / `ALLOWED_ORIGINS`
5. Whapi `AUTH` (**não** Evolution `needs_reconnect`)
6. Health Portal / Club / Sync Easy Panel
7. Crons 401 → `ENFORCE_CRON_AUTH` + `x-service-secret` / Bearer service_role (`assertCronAuth`)
8. Edge 500 → logs função; preferir `200 {skipped}` a 5xx
9. Deploy: Actions `tvmensal2025/igreen-page-magic` + `updated_at` edges
10. Advisors: MCP `get_advisors` (não “consertar” views DEFINER intencionais)

401 edge (Context7/Supabase): missing/invalid JWT vs código retornou 401 — classificar nos logs.

Auth cron: `x-service-secret` → `x-internal-secret` → Bearer service_role → legacy só se não enforce.

Detalhe: `#security-auth` `#deploy` `#edge-functions`.

---

## 5) Automação “não manda” (A/B/C / agenda)

Cadeados: toggle → `bot_global` / settings → **`consultant_automation_prefs`** → DNC/handoff → DDD → caps/janela → canal.

| String / lugar | Significado |
|---|---|
| `automation_disabled` | Toggle OFF |
| `cadence_disabled` | `cadence_engine_enabled=false` |
| `bot_globally_disabled` | Kill (inbound salva) |
| `consultant_pref_off` | Pack A/B/C/PV/reminders OFF ou sem row |
| `quiet_hours` | Bot 21:30–08 BRT — **agenda humana NÃO** |
| `outside_window` / `weekend` | Reheat `weekdays_only` / janela |
| `outreach_cap_*` | Cap B/C/global — **adia**, não descarta |
| `phone_dead:*` / `invalid_phone` | Canal morto / sem celular |
| `identity_missing:consultor` | Sem label/fone consultor |
| `retention_orchestrator` | Outro motor tocou (cooldown) |

Agenda: toggle `send_scheduled_messages`; só DNC bloqueia; **sem** quiet / **sem** exigir `bot_global`.

Caps: A ∞ · B `cap_b` · C `cap_c` · B+C ≤ `cap_global_outreach`.

---

## 6) Carteira / Ads / mídia

| Sintoma | Ação |
|---|---|
| Pagou Stripe, saldo não sobe | Webhook `wallet-stripe-webhook` + RPC credit (líquido − fee) |
| Campanha não cria | `debt_cents` / mínimo saldo `#wallet-stripe` |
| CPL ~⅓ do Ads Manager | **Nunca** somar action_types — `#armadilhas` #26 |
| Mídia some | MinIO 5s → fallback Storage; nunca data-URL no DB |

---

## 7) Frases prontas (responder ao dono)

- **“Velip sem crédito”:** “A API não mostra saldo aqui — abre o painel Velip, recarrega e testa 1 SMS. O sistema não pausa sozinho por crédito.”
- **“Só 1 SMS do C”:** “Os 6 saíram na Velip; a operadora entregou 1 (anti-spam em rajada). No C real os SMS são espaçados.”
- **“IA mudou”:** “Checa kill switch, handoff, Whapi AUTH e se o pack do consultor está ligado.”
- **“Easy Panel”:** “São 3 workers (portal/club/sync). Health de cada um — não misturar URL.”
- **“Supabase erro / não abre”:** “Cache → login → logs da edge → crons 401 (secret) → workers.”

---

## 8) NÃO FAÇA (resumo)

1. Tratar Evolution `needs_reconnect` como Zap offline  
2. Esperar pause automática por saldo Velip  
3. Religar após IK/EK/BK/CK ou DNC  
4. Misturar URLs Portal/Club/Sync  
5. Quiet hours na agenda humana  
6. Global ON = consultor ON  
7. Somar métricas Meta de conversa  
8. Apagar toggle/migration “pra limpar”  
9. Ligar envio em massa novo sem pedido + `dryRun`

---

## 9) UIs / edges de saúde

`/admin/saude-bot` · `/admin/saude-producao` · SuperAdmin Saúde ·  
`production-health-snapshot` · `admin-cron-status` · `minio-quota-check` · `voice-dialer-health` · `facebook-campaign-healthcheck`
