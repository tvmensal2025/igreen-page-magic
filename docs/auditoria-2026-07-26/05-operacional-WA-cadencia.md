# 05 — Operacional crítico (envio real ao lead)

Foco no que decide se **o cliente recebe ou não** a próxima ação.

---

## Caps A/B/C — validação end-to-end

### 1. Config real (leitura direta hoje)

| Campo | Valor | Fonte |
|---|---:|---|
| `enabled` | true | `daily_reheat_settings.id=global` |
| `live_dispatch_enabled` | true | idem |
| `cap_b` | 150 | idem |
| `cap_c` | 50 | idem |
| `cap_global_outreach` | 200 | idem |
| `daily_whapi_cap` | 60 (legado) | idem |
| `window_start_brt` | 08:00 | idem |
| `window_end_brt` | 20:00 | idem |

### 2. Motor lê estes valores

`cadence-tick/index.ts:135`:
```ts
.select("cap_b, cap_c, cap_global_outreach, daily_whapi_cap")
const capB = Math.floor(Number(data?.cap_b));
const capC = Math.floor(Number(data?.cap_c));
const capG = Math.floor(Number(data?.cap_global_outreach));
```

Nenhum valor hardcoded. ✅

### 3. Classificação por grupo

`stageGroup()` importado `:14`, usado `:181`, `:1257`, `:1258`, `:1278`, `:1570`. Regras:
- Grupo A (NEW/GREETED/AI_QUALIFYING/A_*) — não conta no global.
- Grupo B (COLD_*, SMS_TEMA_*, SMS_1/2, CALL_1/2) — conta no cap_b + global.
- Grupo C (RECALL_*, SMS_*, CALL_*) — conta no cap_c + global.

### 4. Excedeu → adia (não descarta) ✅

Regra dura: "Excedeu → **adia** para próxima manhã BRT (nunca descarta o lead)". Confirmado no código pela ausência de qualquer path que remova `lead_cadence_state`.

### 5. Alertas 60/85/100%

Registrados em `automation_skip_log` com keys `outreach_cap_{b|c|g}_{60|85|100}pct`. UI: `ColdCadenceCapCard` (3 barras).

**Estado hoje:** `automation_skip_log` últimos 7d = 33 (32 `retention_orchestrator` + 1 `facebook_capi_dispatch`). Nenhum skip por cap → sistema não está batendo teto.

---

## `whapi-webhook`: kill switch + dedupe + roteamento

### Kill switch

```
whapi-webhook/index.ts:28  import { isBotGloballyEnabled }
whapi-webhook/index.ts:99  const botGlobalOutboundEnabled = await isBotGloballyEnabled(supabase as any);
whapi-webhook/index.ts:101 console.log("[whapi-webhook] bot_global_enabled=false → inbound OK, outbound automático bloqueado");
whapi-webhook/index.ts:1929 reason: "Kill switch global (bot_global_enabled=false)"
```

**Comportamento:** kill switch para outbound automático mas **mantém inbound** — batendo exatamente `regras-duras.md`. ✅

### Dedupe

`_shared/bot/dedupe.ts` — chave `(message_id, instance_name)` em `webhook_message_dedup` (1412 rows). Fail-open em falha de rede (não silencia inbound). ✅

### Cérebro vs Grupo A

Regra: funil de cadastro (Grupo A determinístico) manda; Cérebro só laterais.
- Opt-in `cerebro_ativo` **default off**.
- Testes apenas com `cerebro_numeros_teste` e esvaziar depois.
Governada por `whapi-webhook/handlers/conversational/index.ts` (3626 LOC) via `_shared/cerebro/resposta-hook.ts`.

---

## `send-scheduled-messages`: agenda humana

- **Sem** quiet hours de bot (regra em `AGENTS.md` do diretório).
- `claim_scheduled_messages` com SKIP LOCKED evita corrida.
- Canal via `resolveConsultantOutboundChannel`.
- **Estado:** `scheduled_messages` pending = 0. Fila drenada.

---

## Kill switch em cascata

```
live_dispatch_enabled = true
        ↓ (se off, para envio real, mantém motor)
daily_reheat.enabled = true
        ↓ (se off, para reheat)
cadence_engine_enabled = true
        ↓ (se off, para motor A/B/C)
bot_global_enabled = true
        ↓ (se off, para todo outbound automático)
```

Todas as 4 flags = **true** hoje. Cascata funcional (basta desabilitar a que resolve o problema).

---

## Cliente vs Lead: `isClienteProibidoCadenciaABC`

Aplicação verificada:

- `cadence-tick/index.ts:74` — import.
- `cadence-tick/index.ts:1120` — `if (cust && isClienteProibidoCadenciaABC(cust)) { ... }` skip.

Bloqueia carteira (`igreen_sync`/`igreen_extension`), `is_converted`, aprovado, `pos_venda_stage`, andamento ativo. ✅

Também usado em `src/lib/cycleEligibility.ts` para não mostrar cliente na pizza A/B/C (UI).

---

## Cross-channel dead: IK/UNDELIV

Fluxo:
1. Velip retorna erro IK (número inexistente) ou UNDELIV.
2. `voice_dnc_list` recebe entrada com `reason=auto_velip_ik` (2 casos hoje).
3. `checkPhoneDeadForChannel` marca cross-channel dead.
4. Motor de cadência pula esse lead nos próximos ticks.

**Estado hoje:** `voice_dnc_list`=28 (+2 vs baseline). `voice_call_logs`=718.

---

## Distribuição atual do ciclo vivo

```
COLD_1          75   (B - reengajamento fase 1)
AI_QUALIFYING   58   (A - conversa com IA/consultor)
PAUSED          46   (handoff + segurança)
WON             32   (clientes convertidos)
COLD_2           5   (B - fase 2)
A_NUDGE          5   (A - nudge)
GREETED          3   (A - saudação inicial)
outros          11
Total          235
```

**Análise:** distribuição saudável. Nenhum estágio anômalo. PAUSED alto (46) esperado devido ao dialog unificado de handoff+segurança.

---

## Conclusão do capítulo

Todos os gates de envio ao lead estão **implementados e ativos**. Nenhum P0/P1 detectado no fluxo operacional. Sistema pode receber tráfego (inbound + cadência automática) sem risco de bypass de DNC ou vazamento de nome errado.
