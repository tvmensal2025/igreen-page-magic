# 19 — Go-live produção (análise)

**Data:** 2026-07-16  
**Projeto:** IGREEN (`zlzasfhcxcznaprrragl`) — ACTIVE_HEALTHY  
**Código:** working tree local (não commitado) em `fix/hardening-auditoria`  
**Regra:** não migrate/deploy neste documento — só plano.

---

## 0. Veredito

**Código local:** migration onda3 **corrigida** (2026-07-16) via Python + inventário real `cron.job`.  
**Produção:** ainda **sem** migrate/deploy. Pronto para go-live **após** PR + apply consciente (sem `ENFORCE_*` no dia 0).

Validação: `python3 docs/auditoria-completa/scripts/validate_onda3_cron.py`

---

## 1. Estado real da produção (lido agora)

| Item | Produção hoje |
|---|---|
| `app_settings.bot_global_enabled` | **true** |
| `settings.embed_internal_token` | **existe** (com valor) |
| `settings.service_shared_secret` | **não existe** |
| Policies `daily_reheat_*` | ainda `auth read daily_reheat_*` (abertas) — onda4 **não** aplicada |
| Índice `pending_outbound_media_due_partial_idx` | **não** existe (só `pending_idx` + PK) |
| Migrations onda3/onda4 no banco | **ausentes** (só no disco local) |

### Crons ativos (amostra relevante)

| Job em PROD | Header secret hoje |
|---|---|
| `bulk-scheduler-5min` | só `apikey` |
| `outbound-media-flush-3min` | só `apikey` |
| `portal-otp-watchdog-1m` | só `apikey` |
| `reactivation-cron-hourly` (+ `15min`) | só `apikey` |
| `process-followups-tick` (+ `10min`) | ver SQL (usa `jsonb_build_object`) |
| `cadence-tick-5min` (+ `every-5min`) | — |
| `faq-reengagement-nudge-hourly` | — |
| `send-scheduled-messages-2min` | — |
| `bot-followup-checker-daily` | — |
| `bot-loop-watchdog-2h` | — |
| `rodizio-metrics-10m` | — |
| `super-admin-alerts-hourly` | — |

**Mismatch crítico com onda3 local:**

| Nome na migration local | Nome real em prod |
|---|---|
| `bulk-scheduler-tick` | `bulk-scheduler-5min` |
| `outbound-media-flush-1min` | `outbound-media-flush-3min` |
| `faq-reengagement-nudge-5min` | `faq-reengagement-nudge-hourly` |
| `bot-followup-checker-30min` | `bot-followup-checker-daily` |
| `send-scheduled-messages-every-5min` | `send-scheduled-messages-2min` |
| `bot-loop-watchdog-15m` | `bot-loop-watchdog-2h` |
| `super-admin-alerts` | `super-admin-alerts-hourly` |
| (ausente) | `process-followups-tick` / `process-followups-10min` |
| (ausente) | `reactivation-cron-15min` |
| (ausente) | `cadence-tick-every-5min` |

Se aplicar onda3 como está: unschedule dos nomes errados = no-op; schedule de nomes novos = **duplicata**.

---

## 2. O que o código local já resolve (seguro de implantar com cuidado)

Sem `ENFORCE_*` e com crons ainda em grace:

| Mudança | Efeito em prod ao deployar EF/front |
|---|---|
| DNC fail-closed + gates nos senders | Bloqueia contato indevido; **não** quebra inbound |
| Evolution/Whapi grace + flag | Inbound continua; 401 só se setar flag |
| `assertCronAuth` em grace | Crons sem header **continuam** (só warn) |
| SuperAdmin `isSuperAdmin` | Admins comuns perdem UI SuperAdmin |
| messageSender fail-closed | Chat pode falhar se RLS/rede na checagem DNC |
| Solar token/probe | URLs públicas sem token param (esperado) |
| Workers secret ≥16 | **Redeploy worker sem secret forte = container não sobe** |

---

## 3. Bloqueadores para “fechar e ficar em produção”

### P0 — obrigatório antes de migrate cron

1. ~~Reescrever migration onda3~~ ✅ (nomes reais + dedupe cadence-every / followups-10min)  
2. **Criar `settings.service_shared_secret`** (opcional no dia 0 — embed já basta para grace)  
3. **Separar branch/commit** de hardening vs `captacao-wa-media-attach`

### P1 — antes de marcar “produção fechada”

4. Apply **onda4** (RLS reheat + DEFINER + índice) — nomes batem; risco baixo  
5. Deploy EFs + front (Vite)  
6. Smoke DNC / SuperAdmin / solar / inbound WA  
7. Workers: confirmar `WORKER_SECRET` ≥16 **antes** do redeploy  

### P2 — depois (não no dia 0)

8. `ENFORCE_CRON_AUTH=true` só após logs sem warn de grace  
9. `ENFORCE_WEBHOOK_ORIGIN=true` só com `?secret=` nas URLs Evolution/Whapi  
10. AUD-006 unificar bot-flow (fora do go-live)

---

## 4. Plano de go-live (fases)

### Fase A — Pré-código (1h)

- [ ] Branch nova: `fix/hardening-onda1-4` (só hardening + docs + migrations)  
- [ ] Corrigir SQL onda3 para jobs **reais**  
- [ ] Commit + PR revisável  
- [ ] Confirmar `WORKER_SECRET` nos hosts  
- [ ] Confirmar env Edge: `EMBED_INTERNAL_SECRET` / `SERVICE_SHARED_SECRET` (se for usar)

### Fase B — Banco (risco médio só se onda3 errada)

- [ ] Apply **onda4 primeiro** (RLS/índice/DEFINER) — preferível  
- [ ] Apply **onda3 corrigida** (headers nos jobs reais)  
- [ ] Verificar: nenhum job duplicado; headers com `x-internal-secret`  
- [ ] **NÃO** ligar `ENFORCE_CRON_AUTH`

### Fase C — Código

- [ ] Deploy Edge Functions listadas (shared + ~25 EFs)  
- [ ] Deploy front (Admin/SuperAdmin/messageSender/NetworkPanel)  
- [ ] Redeploy workers **só** se secret ok  

### Fase D — Smoke (dry / 1 lead teste)

- [ ] Inbound Evolution + Whapi (mensagem teste)  
- [ ] Lead DNC → reactivation / followup / chat bloqueados  
- [ ] SuperAdmin: role admin comum negado; super_admin ok  
- [ ] Solar público sem token → 401/403  
- [ ] Cron: logs sem 401; opcional warn grace  
- [ ] Kill switch: Super Admin → `bot_global_enabled=false` pausa auto; reverter  

### Fase E — Endurecer (dia seguinte+)

- [ ] `ENFORCE_CRON_AUTH=true`  
- [ ] Secret nas URLs webhook → `ENFORCE_WEBHOOK_ORIGIN=true`  

---

## 5. Critério de aceite “em produção”

| Critério | OK quando |
|---|---|
| DNC | Lead `do_not_contact` não recebe auto nem chat |
| Inbound | WhatsApp Evolution/Whapi sem regressão |
| Crons | Rodam 1 ciclo sem 401; sem jobs duplicados |
| RLS reheat | Authenticated não lê fila alheia |
| Workers | Saudáveis com secret forte |
| Flags | `ENFORCE_*` ainda **false** no dia 0 (recomendado) |

---

## 6. O que NÃO fazer no go-live

- Aplicar onda3 **sem** reescrever nomes de jobs  
- Ligar `ENFORCE_*` no mesmo minuto do deploy  
- Redeploy worker com `change-me` / secret curto  
- Unificar bot-flow (AUD-006) no mesmo release  
- Assumir que `service_shared_secret` já existe (não existe)

---

## 7. Próxima ação recomendada

1. ~~Corrigir migration onda3~~ ✅  
2. Abrir branch/PR só de hardening  
3. Migrate onda4 → onda3 → deploy EF/front → smoke  
4. Só depois `ENFORCE_*`

**Sem o passo 2–3, produção ainda não muda.**
