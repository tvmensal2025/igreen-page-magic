# 07 — Banco, migrations e RLS

**Data:** 2026-07-16  
**Fonte:** 722 migrations em `supabase/migrations/` + tipos gerados  
**Modo:** somente leitura  

---

## 1. Escala SQL (inventário 04)

| Objeto | Contagem (ocorrências / únicos) |
|---|---|
| Migrations | 722 |
| CREATE FUNCTION | 277 ocorrências / ~180 nomes únicos |
| CREATE TRIGGER | 119 / ~118 nomes |
| CREATE POLICY | 508 ocorrências / ~440 policies “vivas” (heurística drop+create) |
| CREATE TABLE | ~191–206 |
| ENABLE RLS | ~191–207 |
| SECURITY DEFINER | 253 |
| search_path set | 194 |
| DEFINER sem search_path (heurística janela) | 71 |
| cron.schedule | 72 nomes |
| net.http_post refs | 94 |
| GRANT | 322 / REVOKE 79 |

---

## 2. Matriz crítica (heurística migrations)

Legenda isolamento: flags detectadas em snippets de policy (`auth.uid`, `consultant_id`, `is_super_admin`/`has_role`, `USING(true)`).

| Tabela | RLS enable | # policies | uid | consultant | super/admin | USING(true) | Risco preliminar |
|---|---|---:|---|---|---|---|---|
| customers | sim* | 9 | sim | sim | sim | ver nota | Isolamento por `consultant_id = auth.uid()` + policies admin/leader/assigned |
| conversations | sim* | 2 | sim | sim | sim | — | Owner + admins read all |
| captured_leads | sim | 2 | sim | sim | sim | não | Owner + super |
| consultants | sim | 7 | sim | sim | sim | sim (templates-like / anon read público) | Anon lê campos públicos — esperado landings |
| whatsapp_instances | sim | 10 | sim | sim | sim | sim (anon read connected?) | **Auditar** policy anon |
| user_roles | sim | 1 | sim | — | sim | não | Admins manage roles |
| wallet_transactions | sim | 2 | sim | sim | sim | não | Owner + admins |
| scheduled_messages | sim | 2 | sim | sim | sim | não | |
| bot_flow_steps | sim | 3 | sim | sim | sim | não | Auth lê modelo público |
| automation_toggles | sim | 2 | sim | — | sim | sim (auth read) | Qualquer autenticado lê toggles? |
| app_settings | sim | 2 | — | — | sim | — | Só super_admin |
| voice_dnc_list | sim | 1 | sim | sim | — | não | consultants manage own |
| bulk_campaigns | sim | 1 | sim | sim | — | não | |
| facebook_campaigns | sim | 2 | sim | sim | sim | não | |
| proposals | sim | 2 | sim | sim | sim | service | Token público via EF |
| solar_design_snapshots | sim | 2 | sim | sim | sim | service | |
| referral_partners | sim | 2 | sim | sim | — | service | |
| profiles / wallet_balances / messages | não no parser CREATE | 0 | — | — | — | — | Podem ser views/renomeadas — **cruzar com types.ts** |

\* `customers`/`conversations` podem ter sido criados antes do padrão `CREATE TABLE` atual; policies existem e RLS está ativo no histórico (ex. drop de `"Allow all for anon"` em `20260331091820_…`).

### Policies de `customers` (estado heurístico)

- Owner select/insert/update/delete (`consultant_id = auth.uid()`)
- Admins read all (`has_role(..., 'admin')`)
- Assigned consultant select/update
- Leader reads team
- managers can read

Evidência base: `20260331091820_85a8bcc4-…sql`, `20260409201901_79d4b529-…sql`, `20260606001609_0af7ba59-…sql`.

---

## 3. Tabelas com RLS e zero policy (heurística)

11 tabelas: locks/filas internas (`customer_processing_lock`, `webhook_message_dedup`, `outbound_message_log`, …).  
Com RLS e sem policy, **clientes JWT não acessam** (bom para tabelas só-service). Confirmar grants e uso exclusivo via service_role.

---

## 4. DNC no banco (forte)

Migration `20260715200000_enforce_do_not_contact_pause.sql`:

- Trigger `BEFORE INSERT OR UPDATE` força `bot_paused=true`, `bot_force_enabled=false` enquanto `do_not_contact=true`.
- Impede zerar pausa por fluxos de nota/atendimento/webhooks.
- Backfill de inconsistências históricas.

**Grau:** Confirmado no código SQL.

---

## 5. SECURITY DEFINER / search_path

- 253 DEFINER vs 194 search_path → gap residual (~71 na heurística de janela).
- Próximo passo: listar funções DEFINER sem `SET search_path = public` (ou `pg_catalog, public`) no corpo completo — candidatos a P1.

---

## 6. Crons e concorrência

72 `cron.schedule` nomeados + várias EFs watchdog.  
Riscos a validar na etapa agendamentos:

- Jobs duplicados (mesmo schedule em migrations sucessivas sem unschedule)
- Ausência de advisory lock
- Overlap de `cadence-tick` / `process-followups` / `bot-followup-checker`

---

## 7. Tipos gerados

`src/integrations/supabase/types.ts` (~383 KB) — cruzar colunas usadas no código vs ausentes exige script dedicado (próxima execução). Possível descompasso com 722 migrations.

---

## 8. Matriz CRUD resumida (intenção de design)

| Tabela | Leitura JWT | Insert JWT | Update JWT | Delete JWT | Isolamento consultor | Risco |
|---|---|---|---|---|---|---|
| customers | owner/assigned/admin | owner | owner/assigned | owner | sim (uid) | Médio se assigned mal definido |
| conversations | owner/admin | owner path | — | — | via customer | Médio |
| captured_leads | owner/super | owner | owner | owner | sim | Baixo–médio |
| facebook_campaigns | owner/admin | owner | owner | owner | sim | Alto se EF bypass |
| voice_dnc_list | own | own | own | own | sim | Crítico se bypass EF |
| app_settings | super | — | super | — | N/A (global) | Kill switch |
| automation_toggles | auth read? | admin | admin | — | global | Médio |

---

## 9. Pendências etapa 6

- [ ] Diff types.ts ↔ migrations (colunas órfãs)
- [ ] Listar DEFINER sem search_path (lista nominativa)
- [ ] Auditar policy anon em `whatsapp_instances` / `consultants`
- [ ] Verificar UNIQUE phone+consultant e duplicatas cross-consultant
- [ ] ON DELETE behaviors em FKs críticas
