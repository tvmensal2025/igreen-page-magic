# 09 — Drift documentação vs código

Comparação `.kiro/steering/*` contra realidade hoje (2026-07-26).

## Confirmados sem drift ✅

| Arquivo | Regra | Estado |
|---|---|---|
| `regras-duras.md` | Caps A ilim / B 150 / C 50 / global 200 | Bate com banco |
| `regras-duras.md` | Kill switch `bot_global_enabled` + cascata 4 níveis | Confirmado em código |
| `regras-duras.md` | Whapi primário, Evolution legado/paridade | Confirmado |
| `regras-duras.md` | UUID de campanha, nunca keyword/cidade | Confirmado |
| `regras-duras.md` | Nome cliente/consultor com helper | Confirmado nos imports das edges |
| `regras-duras.md` | Janela clamp Seg-Sex 08-20 / Sáb 08-14 / Dom off | Documentação corrigida em sessão anterior |
| `regras-duras.md` | Cliente proibido A/B/C | `isClienteProibidoCadenciaABC` aplicado em `cadence-tick:1120` |
| `_shared/bot/AGENTS.md` | Fail-open dedupe | Confirmado |
| `send-scheduled-messages/AGENTS.md` | Sem quiet hours | Confirmado |
| `cadence-tick/AGENTS.md` | Ordem de gates | Confirmado no código |
| `bulk-scheduler/AGENTS.md` | Limites 5+25, `assertCronAuth`, `assertBotOutboundAllowed` | Confirmado |
| `sync-igreen-customers/AGENTS.md` | Worker separado, `customer_origin=igreen_sync` | Confirmado (1115 rows) |
| `whapi-webhook/AGENTS.md` | Não reescrever bot-flow sem pedido | Regra respeitada |
| `evolution-webhook/AGENTS.md` | Paridade obrigatória | Regra respeitada |

## Drift detectado

### D1 — `EVIDENCIA-PROD.md` desatualizado (P2)

| Campo | Doc (2026-07-24) | Real hoje | Δ |
|---|---:|---:|---:|
| Edges deployadas | 230 | 213 (locais) | doc conta deploy remoto (que pode ter órfãos) |
| Pastas edge locais | 210 | 213 | +3 |
| Migrations SQL | 823 | 846 | +23 |
| `_shared/*.ts` | 382 | 423 | +41 |
| Steering `.md` | 37+ | 43 | +6 |
| customers | 1270 | 1278 | +8 |
| conversations | 2821 | 2991 | +170 |
| lead_cadence_state | 226 | 235 | +9 |
| DEFINER fns | não mensurado | 194 | novo dado |
| Advisors ERROR | 2 | 2 | igual ✅ |
| Total policies public | não mensurado | 437 | novo dado |

**Ação:** rerodar `scripts/refresh-evidencia-prod-snippet.sql` e atualizar o arquivo. Adicionar seção “DEFINER fns / total policies”.

### D2 — Janela do reheat clássico vs clamp geral (não é bug, mas doc pode enganar)

`regras-duras.md` diz:
> **Janela do reheat clássico** (`daily_reheat_settings.window_start_brt` / `window_end_brt`): default **09:00–18:30**, usada só pelo daily-reheat legado — independente do clamp geral.

**Realidade em prod:** valores estão 08:00–20:00 (colidem com clamp geral).

**Ação (P2 doc):** adicionar nota "em prod hoje = 08:00–20:00, colide com clamp — intencional para uniformizar operação". Ou reverter valores para 09:00–18:30 se a diferença for desejável. Decisão de produto.

### D3 — `verify_jwt=false` cresceu 50%

- Auditoria 2026-07-16 → ~60 edges.
- Hoje → **90 edges**.

Não é doc-drift (não há doc de "manter em 60"), mas é sinal de expansão sem revisão sistemática. Todas devem ter guard em código.

**Ação:** documentar em `security-auth.md` que **toda nova edge com `verify_jwt=false` requer PR review dedicado** para confirmar guards.

### D4 — Distribuição de estágios divergente do baseline

Baseline (`EVIDENCIA-PROD.md`):
```
PAUSED / COLD_1 / AI_QUALIFYING = 59 / 59 / 57
```

Hoje:
```
COLD_1=75, AI_QUALIFYING=58, PAUSED=46, WON=32
```

Reflete correções feitas nas sessões recentes (destravar leads pausados, unificar handoff+segurança em dialog). Não é drift documental — é evolução esperada.

**Ação:** atualizar snapshot em `EVIDENCIA-PROD.md`.

## Steering docs sem código correspondente (a validar)

Não encontrei nenhum steering órfão nesta auditoria. Cada `.kiro/steering/*.md` mapeia para arquivos existentes em código. Boa organização.

## Docs históricos rotulados corretamente ✅

- `docs/auditoria-completa/` → `STATUS.md` marca como snapshot histórico.
- `docs/archive/` → rotulado como arquivo.
- `.kiro/specs/_done/` → convenção `_done` para specs concluídas.

## Ação consolidada P1

Executar `scripts/refresh-evidencia-prod-snippet.sql` e reescrever `EVIDENCIA-PROD.md` com:
1. Números de hoje (213/846/423/43).
2. Distribuição de stages atual.
3. Delta advisors (ERROR 2, WARN ~180, INFO 7).
4. Nova seção "DEFINER fns = 194, policies = 437".
5. Nota sobre janela reheat (colisão intencional com clamp).
