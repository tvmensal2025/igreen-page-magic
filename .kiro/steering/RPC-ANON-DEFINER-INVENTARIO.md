---
inclusion: manual
name: rpc-anon-definer-inventario
description: Inventário RPCs DEFINER+anon — P0 revogado; P1–P3 residual (2026-07-24).
---

# Inventário — `SECURITY DEFINER` + `EXECUTE` para `anon`

**Projeto:** `zlzasfhcxcznaprrragl` · **Data:** 2026-07-24  
**Fontes:** `execute_sql` (pg_proc + grants) + `get_advisors` security  
**Advisor (pós-P0):** `anon_security_definer_function_executable` = **21** · `authenticated_…` ≈ **149** · ERROR views DEFINER = **2** (exceções)  
**Ação neste arquivo:** inventário + **P0 revogado** (ver status abaixo).

**Status P0 (2026-07-24):** ✅ **APLICADO** via MCP `apply_migration` `revoke_p0_anon_definer_rpcs`  
Migration local: `supabase/migrations/20260724140000_revoke_p0_anon_definer_rpcs.sql`  
Verificação: 6/6 com `anon=false`, `authenticated=false`, `service_role=true`. Advisor residual anon DEFINER: **21** (antes 27).


> DEFINER bypassa RLS das tabelas base. Se `anon` pode chamar via `/rest/v1/rpc/...` sem JWT, o risco é real mesmo com “ninguém usa no front”.

## P0 — crítico — ✅ REVOKE aplicado (anon/authenticated/public)

| RPC | Risco | Por quê |
|---|---|---|
| `admin_cron_run_now(p_job_name)` | **P0** | `EXECUTE` o `command` do job — quem chama como anon dispara cron arbitrário |
| `admin_cron_reschedule(...)` | **P0** | Altera schedule de pg_cron |
| `admin_cron_toggle(...)` | **P0** | Liga/desliga jobs |
| `admin_cron_list()` | **P0** | Lista jobs/comandos (recon) |
| `admin_cron_last_runs()` | **P0** | Detalhes de execução (recon) |
| `claim_scheduled_messages(p_limit)` | **P0** | Claim atômico de agenda (DEFINER) — anon pode “roubar” pending → `processing` |

**Remediação:** aplicada 2026-07-24. SQL histórico:  
`REVOKE EXECUTE ON FUNCTION … FROM anon, public;`  
manter `service_role` (e, se a UI autenticada precisar, `authenticated` + checagem `is_super_admin` no corpo).  
Crons de edge devem continuar via `assertCronAuth` + service role — **não** via RPC aberta.

## P1 — alto (mutação / vazamento sem ownership)

| RPC | Risco | Nota |
|---|---|---|
| `sync_objection_shortcut_all(...)` | **P1** | Atualiza QA em massa sem auth no corpo |
| `refresh_objection_shortcut(...)` | **P1** | Cria/atualiza atalho de objeção por `flow_id` |
| `ensure_qa_media_slots(...)` | **P1** | Escreve slots de mídia QA |
| `lead_research_sweep_bump(...)` | **P1** | Incrementa contadores de sweep |
| `generate_partner_protocol` / `_v2` | **P1** | Consome sequência de protocolo |
| `count_captured_leads_by_channel(p_consultant_id)` | **P1** | Lê agregados por UUID (IDOR se UUID vazado) |
| `filter_dispatched_phones(...)` | **P1** | Filtra phones de bulk por consultor (IDOR) |
| `has_role(_user_id, _role)` | **P1** | Oráculo de papel para qualquer UUID |

## P2 — médio (tem `is_super_admin(auth.uid())`, mas grant anon é errado)

Com JWT anon, `auth.uid()` é null → tende a `RAISE not_authorized`. Ainda assim: **revoke anon** (defesa em profundidade).

| RPC | Gate no corpo |
|---|---|
| `admin_clear_ban` | `is_super_admin(auth.uid())` |
| `admin_mark_instance_banned` | idem |
| `publish_flow_as_public` | idem |
| `sync_bot_flow_c_from_a` | checa caller/admin no corpo |

## P3 — ruído de advisor (triggers `RETURNS trigger`)

Não são API útil tipicamente; grant `EXECUTE` a `anon` ainda aparece no lint. Revoke é cosmético/higiene.

- `assign_pool_member_suffix`
- `cadence_ensure_state_from_customer`
- `cadence_on_inbound_message`
- `clear_attendance_auto_close_on_inbound`
- `enforce_customer_meta_ad_campaign_guard`
- `pause_cadence_on_manual_send`

## P4 — baixo

| RPC | Nota |
|---|---|
| `get_devtools_blocked()` | Lê flag global; impacto baixo |

## Views DEFINER (já tratado)

ERROR advisors restantes (**2**, intencionais): `consultants_public`, `platform_facebook_audience_status`. Ver `#security-auth`.

## O que **não** fazer sem pedido

- Não `REVOKE` em massa sem checklist (pode quebrar trigger/edge que chame com role errada)
- Não “consertar” os 155 `authenticated_security_definer_*` neste passo
- Não expor este inventário como licença para ligar motor ou mudar cron

## Histórico P0 (já aplicado)

Migration `20260724140000_revoke_p0_anon_definer_rpcs.sql` — 6 RPCs só `service_role`.

## Próximo passo opcional (só com OK explícito) — P1 writes

`REVOKE EXECUTE … FROM anon, PUBLIC` em writes sem gate no corpo (`sync_objection_shortcut_all`, `ensure_qa_media_slots`, `lead_research_sweep_bump`, …).  
Manter `authenticated` onde o front chama (`refresh_objection_shortcut`, `generate_partner_protocol`, `has_role`, count/filter) até haver ownership no corpo.  
Não é bloqueante para fechar o pack de documentação.
