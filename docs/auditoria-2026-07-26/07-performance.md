# 07 — Performance

Baseado em `supabase--slow_queries` (pg_stat_statements) e advisors.

## Top 3 slow queries reais

### 1. `customers` por `consultant_id` (variante completa) — **P1**

- **Calls:** 25.128
- **Mean:** 128.51 ms
- **Total:** 3.229.290 ms = **~54 min de CPU acumulados**
- **Query:** PostgREST full-select em `customers` filtrando `consultant_id = $1`.
- **Fingerprint:** 40+ colunas incluindo endereço completo, cashback, andamento_igreen, tipo_produto.

**Diagnóstico:**
- Não há evidência de índice em `customers(consultant_id)` (não confirmado nesta rodada).
- Front-end faz select `*` implícito (PostgREST) — trafega ~40 colunas mesmo quando UI usa 5–10.

**Ação P1:**
1. Confirmar índice: `SELECT * FROM pg_indexes WHERE tablename='customers' AND indexdef LIKE '%consultant_id%'`.
2. Se ausente: migration `CREATE INDEX idx_customers_consultant_id ON public.customers(consultant_id);`.
3. Reduzir select no front: passar `select=` explícito no `.from('customers').select(...)`.

### 2. `customers` por `consultant_id` (variante enxuta) — **P1**

- **Calls:** 9.968
- **Mean:** 117.24 ms
- **Total:** 1.168.624 ms = **~19 min**
- 15 colunas selecionadas. Mesma causa: falta índice + volume alto.

Mesma ação da #1 resolve.

### 3. `customers` por `name_source IN (...)` — **P2**

- **Calls:** 7.586
- **Mean:** 111.98 ms
- **Total:** 849.485 ms = **~14 min**
- Query lê `name, name_source, phone_whatsapp` onde `name_source = ANY($1)` AND `name IS NOT NULL`.
- Provavelmente usada pelo audit de "nomes safe/unsafe".

**Ação P2:** index parcial `CREATE INDEX idx_customers_name_source_notnull ON public.customers(name_source) WHERE name IS NOT NULL;`.

## Advisors — baseline (`EVIDENCIA-PROD.md`)

Snapshot 2026-07-24 (não re-executado hoje — auditoria de leitura pura):

| Categoria | Count |
|---|---:|
| `auth_rls_initplan` | 343 |
| `multiple_permissive_policies` | 217 |
| `unused_index` | 156 |
| `unindexed_foreign_keys` | 56 |
| `duplicate_index` | 17 |
| INFO | 215 |
| **Total** | **792 findings** |

**Regra:** não corrigir em massa sem medição. Priorizar via `slow_queries`.

## Top 20 tabelas por volume estimado de acesso

Da leitura direta:

| Tabela | Rows | Alta rotatividade? |
|---|---:|---|
| `types.ts gerado` | — | (Postgres) |
| `conversations` | 2991 | Sim (inbound WA) |
| `customers` | 1278 | Sim (queries multi-consultor) |
| `webhook_message_dedup` | 1412 | Sim (webhook por msg) |
| `outbound_message_log` | 1329 | Sim (log envio) |
| `voice_call_logs` | 718 | Sim (Velip) |
| `lead_cadence_state` | 235 | Sim (motor 5min) |
| `automation_skip_log` (7d) | 33 | Baixa hoje |

## Recomendações consolidadas (por impacto)

| ID | Ação | Impacto estimado | Prioridade |
|---|---|---|---|
| PERF-1 | Índice `customers(consultant_id)` + trim de select PostgREST | ↓ ~73 min CPU/período | **P1** |
| PERF-2 | Índice parcial `customers(name_source) WHERE name IS NOT NULL` | ↓ ~14 min CPU | P2 |
| PERF-3 | Auditar `auth_rls_initplan` nas top 5 tabelas (customers, conversations, lead_cadence_state, outbound_message_log, webhook_message_dedup) | Latência RLS ↓ | P2 |
| PERF-4 | Remover 17 duplicate indexes | Espaço + write speed | P2 |
| PERF-5 | Adicionar índices em 56 unindexed FKs | Latência FK check ↓ | P2 |
| PERF-6 | Remover 156 unused indexes (após validação) | Espaço + write speed | P3 |
| PERF-7 | Consolidar 217 multiple_permissive_policies | Latência RLS ↓ | P3 |

## Como validar cada melhoria

```sql
-- Antes: pega baseline
EXPLAIN (ANALYZE, BUFFERS)
SELECT ... FROM customers WHERE consultant_id = 'uuid';

-- Aplica migration com CREATE INDEX
-- Depois: repete o EXPLAIN e compara buffers/tempo
```

Documentar o antes/depois em cada migration de performance.
