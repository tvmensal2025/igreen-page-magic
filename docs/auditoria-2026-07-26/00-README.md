# Auditoria Completa — 2026-07-26

**Projeto Supabase:** `zlzasfhcxcznaprrragl`
**Escopo:** código + funções + regras + segurança + performance (full)
**Modo:** somente leitura. Nenhum arquivo de código alterado.
**Metodologia:** MCP Supabase (`execute_sql`, `linter`, `slow_queries`) + inspeção de código + comparação com `.kiro/steering/*`.

---

## Veredito executivo

Sistema **em produção e saudável nos fluxos críticos**:

- Kill switch global (`bot_global_enabled=true`) e cadência (`cadence_engine_enabled=true`) ativos e lidos por `_shared/bot/global-flag.ts`.
- Caps A/B/C aplicados corretamente em `cadence-tick`: A ilimitado, B=150, C=50, global=200.
- Whapi como canal primário; Evolution mantido como paridade/legado.
- Kill switch em cascata funcional (live_dispatch → daily_reheat → cadence_engine → bot_global).
- DNC/cross-channel (IK/UNDELIV) bloqueando envio via `voice_dnc_list` (28 números) + `do_not_contact` (21 clientes).
- Nome do cliente/consultor protegido por helpers canônicos.

**Riscos residuais** (nenhum P0 novo detectado nesta rodada):

- **P1 — Performance:** query PostgREST em `customers` sem filtro adequado consome **~72 min de CPU total** (25k chamadas, mean 128ms). Ver `07-performance.md`.
- **P1 — 2 views SECURITY DEFINER conhecidas** (`consultants_public`, `platform_facebook_audience_status`) — decisão intencional documentada; manter.
- **P2 — 194 funções SECURITY DEFINER** no schema `public`, muitas com `EXECUTE` para signed-in users (WARN 0029). Não corrigir em massa; mapa em `06-seguranca.md`.
- **P2 — Drift doc vs código:** encontrado 1 drift menor em `EVIDENCIA-PROD.md` (números defasados; hoje temos 213 edges, 846 migrations, 43 steering). Ver `09-drift-doc-vs-codigo.md`.

## Índice

| # | Arquivo | Conteúdo |
|---|---|---|
| 01 | [inventario](./01-inventario.md) | Números reais hoje (edges, migrations, LOC, god-files) |
| 02 | [codigo](./02-codigo.md) | Qualidade, god-files, duplicação Whapi↔Evolution |
| 03 | [funcoes-e-fluxos](./03-funcoes-e-fluxos.md) | Contrato de cada edge crítica |
| 04 | [conformidade-regras](./04-conformidade-regras.md) | `regras-duras.md` linha a linha vs código |
| 05 | [operacional-WA-cadencia](./05-operacional-WA-cadencia.md) | Envio real ao lead: caps, janela, kill switch |
| 06 | [seguranca](./06-seguranca.md) | Advisors, RLS, DEFINER, grants, secrets |
| 07 | [performance](./07-performance.md) | Slow queries reais + advisors perf |
| 08 | [riscos-e-recomendacoes](./08-riscos-e-recomendacoes.md) | Lista priorizada P0/P1/P2 |
| 09 | [drift-doc-vs-codigo](./09-drift-doc-vs-codigo.md) | Onde `.kiro/steering` diverge do prod |

## Top 5 recomendações acionáveis (ordem sugerida)

1. **Otimizar query `customers` por `consultant_id`** — impacto direto na UX admin. Migration com `CREATE INDEX customers(consultant_id)` + revisar select `*` no front. (`07`, item 1)
2. **Fechar 2 views DEFINER restantes** ou marcar formalmente como exceção em `security-memory`. (`06`, item 2)
3. **Refresh do `EVIDENCIA-PROD.md`** com números de hoje (213 edges / 846 migrations / 43 steering / 194 DEFINER fns). (`09`)
4. **Auditar as ~183 funções SECURITY DEFINER com `EXECUTE` para `authenticated`** — revogar EXECUTE onde só backend chama. (`06`, item 4)
5. **Habilitar Leaked Password Protection** no Supabase Auth (WARN 184). (`06`, item 5)

## O que esta auditoria confirma que está OK

- Caps A/B/C batem exatamente com `regras-duras.md` (A ilimitado / B=150 / C=50 / global=200).
- `isClienteProibidoCadenciaABC` importado em `cadence-tick:74` — cliente carteira nunca entra em A/B/C.
- `isBotGloballyEnabled` importado em `whapi-webhook:28` e usado em `:99` — kill switch respeitado, inbound continua.
- `daily_whapi_cap=60` mantido para legado (documentado como retrocompat).
- 0 tabelas `public` sem RLS habilitado.
- Distribuição de estágios coerente com operação diária (COLD_1=75, AI_QUALIFYING=58, PAUSED=46, WON=32).

## Como revalidar

```bash
# 1. Repetir queries em execute_sql
supabase--linter
supabase--slow_queries
# 2. Atualizar EVIDENCIA-PROD.md
scripts/refresh-evidencia-prod-snippet.sql
# 3. Comparar com este relatório (auditoria-2026-07-26)
```
