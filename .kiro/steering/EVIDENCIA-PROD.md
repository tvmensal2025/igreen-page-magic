---
inclusion: manual
name: evidencia-prod
description: Snapshot auditado de produção e advisors.
---

# Evidência de produção — auditada

**Projeto:** `zlzasfhcxcznaprrragl` · **Data:** 2026-07-24 · **Revalidado:** 2026-07-24 (round 10 — MCP Supabase + advisors + Context7)  
**Fontes:** Supabase MCP (`execute_sql`, `get_advisors`) + inventário git + Context7 (`/websites/agents_md`, `/supabase/supabase`).

## Inventário repo
| Item | Valor |
|---|---|
| Pastas edge locais | 210 |
| Edges deployadas | 230 |
| Migrations SQL | 823 |
| Steering `.md` (após round 6) | 37+ |
| Cursor rules `.mdc` | 15 |
| Specs `.kiro/specs` | 23 pastas |
| `_shared/*.ts` | 382 |
| Components whatsapp | ~77–81 |
| Workers | `worker-portal-2`, `worker-club`, `worker-igreen-sync` |

## Flags / caps (vivos)
```
app_settings.id=global
  bot_global_enabled = true
  cadence_engine_enabled = true
  bot_engine_production_mode = false
  cadence_window = Seg–Sex 08–20, Sáb 08–14, Dom off

daily_reheat_settings.id=global
  enabled = true
  live_dispatch_enabled = true
  cap_b = 150
  cap_c = 50
  cap_global_outreach = 200
  daily_whapi_cap = 60
  window_start_brt = 08:00
  window_end_brt = 20:00

automation_toggles (amostra)
  cadence_engine = true
  daily_reheat = true
  pos_venda_auto_messages = true
  (dezenas de cadence_* = true)
```

## Customers / pós-venda / cadência
| Métrica | N |
|---|---|
| customers | 1270 |
| origem `igreen_sync` | 1115 |
| `do_not_contact` | 20 |
| `portal_submitted_at` set | 7 |
| pos_venda `espera` | 1114 |
| pos_venda `aprovado` | 1 |
| lead_cadence_state | 226 |
| PAUSED / COLD_1 / AI_QUALIFYING | 59 / 59 / 57 |
| conversations | 2821 |

### customer_auto_message_log (PV enviado)
`pv_reprovado` 18 · `pv_aprovado` 1 · `pv_d30` 1 · `pv_d60` 1 · `pv_d90` 1  
(media default rows: 10)

## Voz / outbound / atribuição
| Tabela | N |
|---|---|
| voice_call_logs | 685 (OK 266, NA 402, IK 9) |
| voice_sms_log | 29 |
| voice_campaigns | 29 |
| voice_dnc_list | 26 |
| outbound_message_log | 1295 |
| webhook_message_dedup | 1363 |
| campaign_match_log | 306 |
| rodizio_assignments | 28 |
| scheduled_messages | 2 (sent) |
| cross_sell_hint templates | 1 |

### voice_dnc reasons
opt_out 12 · requested 6 · auto_nonexistent 4 · auto_velip_ik 2 · complaint 2

## automation_skip_log (7 dias) — top
| key | n |
|---|---|
| send_scheduled_messages | 1115 |
| end_customer_attendance_auto | 446 |
| bulk_campaigns_runner | 446 |
| speed_to_lead_sla | 446 |
| process_followups | 446 |
| cadence_engine | 366 |
| reactivation_cron | 187 |
| daily_reheat | 112 |
| pos_venda_auto_messages | 22 |

## Advisors Supabase (MCP get_advisors)
### Security — revalidado 2026-07-24 (pós migration views)
- **ERROR 2** (só exceções intencionais): `consultants_public`, `platform_facebook_audience_status` (DEFINER / `security_invoker=false`)
- Baseline antigo era ERROR 5; remediados com `security_invoker=true`: `v_boletos_carteira`, `cadence_metrics_daily`, `igreen_recon_queue_progress`
- WARN ~192 (inclui muitos `SECURITY DEFINER` em RPCs com `EXECUTE` para `anon` — mapa; não “consertar em massa” sem pedido)
- Ver `#security-auth` + migration `20260724120000_views_security_invoker_safe.sql`
- Context7/Supabase: preferir `security_invoker=true` em views (Postgres 15+); DEFINER só com motivo documentado

### Performance — 792 findings (mapa; não remediado em massa)
- WARN: `auth_rls_initplan` 343 · `multiple_permissive_policies` 217 · `unused_index` 156 · `unindexed_foreign_keys` 56 · `duplicate_index` 17
- INFO: 215

> Não “consertar tudo” de perf sem medição. Views DEFINER acidentais sim (feito).

## Engenharia round 7 (além de doc)
- UI: labels DNC → “Não Perturbe / bloqueado / nunca mais contatar”
- CI: `scripts/check-agent-docs-drift.sh` + job `agent-docs-drift` + `npm run check:agent-docs`
- God-file: helpers puros → `_shared/bot/step-interaction.ts` (Whapi+Evolution); **62** testes Deno OK

## God-files (linhas) — barreira cognitiva (wc 2026-07-24 round 10)
1. types.ts 14263 (gerado)
2. whapi bot-flow **7012**
3. evolution bot-flow **6737**
4. evolution index 3636
5. whapi conversational/index 3626
6. whapi index 3505
7. multichannelCadenceTexts 2993
8. sync-igreen-customers 2591
9. AgendamentosHub 1912
10. cadence-tick 1518

## Fatos operacionais que a doc genérica erra se ignorar
1. Pós-venda **não** usa `bot_global_enabled` — só `pos_venda_auto_messages` + `pos_venda_manual`
2. Kill switch no Whapi: inbound continua; **outbound** automático para
3. Agenda humana **sem** quiet hours de bot
4. Janela reheat **em prod** = 08–20 (não assumir só 09–18:30 do texto legado)
5. Cross-sell card = manual; `avaliarCrossSell` no Cérebro **não tem consumidor** de produção (só export + sombra) — não “ligar massa”
6. Evolution ainda é canal **resolvido** para consultor Evolution saudável (`channel-sender`) — legado ≠ morto
7. Engine V3 no webhook hoje é **sombra** (observa/delega); não assumir que “assume o turno” sem ler `webhook-hook.ts`
8. Nested `AGENTS.md` = nearest wins (Context7 `/websites/agents_md`)

## Como revalidar
```
# via MCP Supabase (scripts/mcp-supabase.sh / tools Cursor)
execute_sql + get_advisors(security|performance)
# SQL pronto
scripts/refresh-evidencia-prod-snippet.sql
# mapa máquina + drift
.kiro/steering/mapa-dominios.json
npm run check:agent-docs
```
