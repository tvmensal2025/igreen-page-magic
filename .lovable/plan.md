# Tetos diários — Grupo A sem limite

## Regra final


| Grupo                                            | Perfil                                | Teto/dia                             | Comportamento                                          |
| ------------------------------------------------ | ------------------------------------- | ------------------------------------ | ------------------------------------------------------ |
| **A — Novos leads (inbound)**                    | Cliente respondeu / clicou no anúncio | **SEM LIMITE**                       | Nunca bloqueia, nunca alerta por volume. Passa direto. |
| **B — Reengajamento (silêncio)**                 | Nós tocamos primeiro                  | **Ramp anti-ban** (D1=20 → D15+=200) | Excedente vai para amanhã 08:00.                       |
| **C — Reciclagem fria** (30/60/90d, 5m, 8m, 12m) | Lead antigo                           | **50**                               | Excedente vai para amanhã 08:00.                       |
| **TETO GLOBAL (só B+C)**                         | Outreach frio por instância           | **200/dia**                          | Freio anti-ban. **Grupo A não conta aqui.**            |


Consequência: com 200/dia de outreach frio (B+C), tocar 1000 leads leva ~5 dias úteis — lento de propósito, protege o número. O Grupo A responde sempre, sem restrição.

## Alertas de preenchimento (só B, C e global)

Dispara toast + registra em `automation_skip_log`. **Grupo A não gera alerta de volume.**

- **60% do teto** (B, C ou global) → aviso amarelo (`"Grupo B: 36/60 hoje"`).
- **85% do teto** → aviso laranja + banner em `/admin/motor` e `/admin/agendamentos`.
- **100% do teto** → hard stop **daquele grupo** (ou global de B+C) até 00:00 BRT; agendamentos remanescentes clampam para amanhã 08:00.

## O que muda no código

1. `**supabase/functions/_shared/whapi-throttle.ts**`
  - Aceita `group: "A"|"B"|"C"`.
  - `group === "A"` → **bypass total** (nunca conta, nunca bloqueia, nunca alerta).
  - Envs: `WHAPI_CAP_B` (ramp), `WHAPI_CAP_C=50`, `WHAPI_CAP_GLOBAL=200`.
2. **RPC `whapi_send_throttle**`
  - `ADD COLUMN group_key text NOT NULL DEFAULT 'B'`.
  - Conta `sent_today` só para B e C; ignora A.
  - Retorna `{ sent_today_group, sent_today_outreach, next_warn_level }`.
3. **Chamadas**
  - `cadence-tick`: passa `group` do `cadence_stage_config.group`.
  - `sofia-*` / `wa-inbound-*` / respostas ao cliente: `group: "A"` → bypass.
  - `daily_reheat` (quando ligar): `group: "C"`.
4. **UI — `ColdCadenceCapCard` (renomeado para OutreachCapCard)**
  - 3 barras: `B: 12/60 (ramp D5)` · `C: 3/50` · `Global outreach: 15/200`.
  - `A: ilimitado ✓` (só informativo, sem barra).
  - Aparece em `/admin/motor` e no topo de `/admin/agendamentos` quando ≥ 60%.
5. **Alertas**
  - Helper `checkOutreachCapAndAlert(group, sent, cap)` — nunca é chamado para A.

## Fora de escopo (não mexer)

- Motor A/B/C, elegibilidade, janela 08–20 BRT, kill switch.
- Ramp anti-ban existente (só B/C).
- Velip (voz/SMS) — sem cap.
- Jitter / intervalo mínimo — iguais.

## Detalhes técnicos (1 migration)

```sql
ALTER TABLE whapi_send_throttle
  ADD COLUMN IF NOT EXISTS group_key text NOT NULL DEFAULT 'B';
CREATE INDEX IF NOT EXISTS whapi_throttle_group_day_idx
  ON whapi_send_throttle (instance_id, group_key, (created_at::date));
```

- função `whapi_send_throttle(...)` passa a receber `group_key`; se `= 'A'`, retorna imediatamente sem gravar nem checar cap.

Defaults embutidos no código (`ramp/50/200`) para não quebrar se envs faltarem.
Testes em `whapi-throttle_test.ts`: bypass total de A, cap B, cap C, cap global de outreach, alertas 60/85/100.

Confirma esses valores (C=50, global outreach=200) para eu implementar?