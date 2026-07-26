# 08 — Riscos priorizados

**Nenhum P0 detectado nesta auditoria.**

## P1 — Ações recomendadas em breve

| ID | Área | Ação | Fonte |
|---|---|---|---|
| PERF-1 | Performance | Índice `customers(consultant_id)` + reduzir select PostgREST | `07` #1 |
| SEC-1 | Segurança | Ativar Leaked Password Protection no Supabase Auth | `06` |
| SEC-2 | Segurança | Documentar 2 views DEFINER remanescentes em security memory | `06` |
| SEC-3 | Segurança | Auditar 194 DEFINER fns; revogar EXECUTE de `authenticated` onde só backend chama | `06` |
| SEC-4 | Segurança | Adicionar `SET search_path = public, pg_temp` em DEFINER fns que ainda não têm | `06` |
| DOC-1 | Doc/Drift | Atualizar `EVIDENCIA-PROD.md` com números de hoje (213/846/43/194) | `09` |

## P2 — Melhorias sem urgência

| ID | Área | Ação | Fonte |
|---|---|---|---|
| PERF-2 | Performance | Índice parcial `customers(name_source) WHERE name IS NOT NULL` | `07` |
| PERF-3 | Performance | Auditar `auth_rls_initplan` nas top 5 tabelas | `07` |
| PERF-4 | Performance | Remover 17 duplicate indexes | `07` |
| PERF-5 | Performance | Índices em 56 unindexed FKs | `07` |
| SEC-5 | Segurança | Mover 2 extensions do `public` para `extensions` schema | `06` |
| SEC-6 | Segurança | Script auditor `verify_jwt=false` — validar guards em código | `06` |
| SEC-7 | Segurança | Revisar 7 tabelas RLS-enabled-sem-policy | `06` |
| SEC-8 | Segurança | Retention policy `_deleted_customers_backup` | `06` |
| CODE-1 | Código | Script `audit-shared-orphans` para `_shared` sem consumidor | `02` |
| CODE-2 | Código | ESLint `sonarjs` para complexidade (novo código apenas) | `02` |
| CODE-3 | Código | Limpeza `.tmp/` | `02` |

## P3 — Débito consciente (não urgente)

| ID | Ação |
|---|---|
| PERF-6 | Remover 156 unused indexes (após validação de janela) |
| PERF-7 | Consolidar 217 multiple_permissive_policies |
| CODE-4 | AUD-006: unificar `bot-flow.ts` Whapi ↔ Evolution (exige E2E dryRun completo) |
| CODE-5 | Migrar ~100 EFs para `buildCors` allowlist |

## Riscos zero (validados como OK)

- **Kill switch global** — implementado e ativo em `whapi-webhook` + `cadence-tick`.
- **Caps A/B/C** — motor lê valores reais do banco; A ilimitado, B=150, C=50, global=200.
- **Cliente vs Lead** — `isClienteProibidoCadenciaABC` aplicado no motor.
- **DNC / cross-channel** — 28 números em `voice_dnc_list`, motor respeita.
- **Nome cliente/consultor** — helpers canônicos usados nas edges críticas.
- **Janela BRT** — clamp geral + janela reheat, ambos aplicados.
- **Cascata de rollback** — 4 níveis funcionais.
- **Whapi primário** — canal correto em todos os motores.
- **Workers separados** — Portal 2 / Club / iGreen-sync isolados.
- **Nenhuma tabela `public` sem RLS**.

## Roadmap sugerido

**Sprint 1 (esta semana)**
- PERF-1 (índice `customers.consultant_id`) — 1 migration + medição.
- SEC-1 (Leaked Password Protection) — 1 clique dashboard.
- SEC-2 (memory update) — 1 chamada `security--update_memory`.
- DOC-1 (refresh evidencia-prod) — regenerar via `scripts/refresh-evidencia-prod-snippet.sql`.

**Sprint 2**
- SEC-3 + SEC-4 (DEFINER audit).
- PERF-2 + PERF-3.

**Backlog contínuo**
- P2 conforme surgirem em tarefas relacionadas.
- P3 só em janelas dedicadas com medição.
