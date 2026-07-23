# Runbook E2E seguro (TestSprite + dryRun + allowlist)

## Objetivo
Validar UI e motores **sem** WhatsApp a clientes reais. Live só nos fones:
`5511989000650` e `5511973125846`.

## Glossário rápido
Ver [GLOSSARIO_MOTORES_ABC.md](./GLOSSARIO_MOTORES_ABC.md).

- **Grupo A/B/C** = escada `cadence-tick` (`A_*` → `COLD_*` → `RECALL_*`)
- **Daily reheat** = motor diário separado (filas A/B do dia)
- **`flow_variant` B / fluxo-b-ai** ≠ Grupo B da cadência

## Pré-requisitos
1. `.env.mcp.local` com `E2E_EMAIL`, `E2E_PASSWORD`, `TESTSPRITE_API_KEY`, `SUPABASE_ANON_KEY` (gitignored).
2. Preview app em `http://localhost:8081` (ou porta do runner).
3. Plano FE reescrito: `testsprite_tests/testsprite_frontend_test_plan.json` (IDs críticos TC001–003,007,008,010,013,016).
4. Gate opt-in no código: `E2E_STRICT_OUTBOUND` em `outbound-gate.ts` (default off em produção).

## Camada 1 — UI TestSprite
```bash
set -a && source .env.mcp.local && set +a
node scripts/run-testsprite-stage2.mjs
```
Asserts alinhados ao produto: QR/wa.me, shell `/admin`, Captação+Bloqueado.

## Camada 2 — Dry-run
- `fluxo-b-ai` com `dryRun` / skill vendedora E2E
- `daily-reheat-cron` com `{ "dryRun": true }` ou preview
- Simulador telefone `5500000…` → `bot_test_outbound`

## Camada 3 — Live allowlist (só se pedido)
1. Deploy das edges que usam `assertBotOutboundAllowed` (cadence, followups, reheat, etc.).
2. Secret nas edges: `E2E_STRICT_OUTBOUND=true` + allowlist.
3. Customers sandbox Rafael (`is_sandbox=true`, ainda `bot_paused` até o smoke):
   - `ff2a1198-…` / `5511989000650`
   - `2911151e-…` / `5511973125846`
4. Despausar **só** o lead do smoke; 1 mensagem; remarcar pause.

## Não fazer
- Mass-send / novo motor sem pedido
- Desligar `bot_global_enabled` por causa de TestSprite
- Commitar `.env.mcp.local` ou senha EasyPanel (rotacionar se vazou)
