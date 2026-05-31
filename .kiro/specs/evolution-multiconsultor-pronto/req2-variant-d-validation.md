# Task 4.3 — Validação do seed na variante D (Property 3)

> Teste de **integração** para a Task 4.3 do spec `evolution-multiconsultor-pronto`.
> Anexar este arquivo ao PR da migração REQ 2 como evidência das asserções
> **Property 3 / Requisitos 2.1, 2.2, 2.3** (e 6.6 — Rafael inalterado).
>
> `// Feature: evolution-multiconsultor-pronto, Property 3: Consultor novo nasce provisionado na variante D`

## Resumo

A migração forward
`supabase/migrations/20260601030000_req2_seed_default_camila_flow_variant_d.sql`
foi validada contra um **banco isolado** (PGlite, Postgres embarcado em WASM),
seguindo exatamente o padrão documentado em
[`flow-diagram-view/migration-15-3-validation.md`](../flow-diagram-view/migration-15-3-validation.md)
e implementado em `.tmp/pg-snapshot-validate/`. **Nenhum** objeto de produção é
tocado — o teste sobe um Postgres efêmero, recria o schema relevante, aplica o
corpo real da migração e roda as asserções.

Todas as asserções passaram (`ALL ASSERTIONS PASSED`, exit code 0).

> **Re-execução de confirmação final (Task 9.3 — 2026-05-31).** Esta mesma
> validação de banco isolado foi **re-executada** como confirmação final do
> REQ 2 (Task 9.3, Requisitos 2.1 e 2.2):
>
> ```bash
> node .tmp/pg-snapshot-validate/validate-req2-variant-d.mjs
> # -> ALL ASSERTIONS PASSED (exit code 0)
> ```
>
> Resultado reconfirmado: um consultor novo nascido **após** a migração forward
> do REQ 2 tem **exatamente 1 `bot_flow` ativo `variant='D'`** e
> `consultants.active_variants` **contém `'D'`** (Step 4). Idempotência (Step 5),
> Rafael inalterado (Step 3) e rollback (Step 6) também reconfirmados.
>
> **Honestidade de escopo:** isto confirma o comportamento da migração em um
> Postgres **isolado** (PGlite) que executa fielmente o trigger
> `trg_seed_camila_flow` + a função `seed_default_camila_flow` e a constraint
> única parcial — **não** é uma confirmação em produção. A migração REQ 2 **não**
> está aplicada em produção; o rollout em produção permanece um passo
> **gated por aprovação humana** (ver `Rollout & Rollback` no `design.md`).

## Property 3 (do design)

*Para qualquer* consultor recém-criado, após o provisionamento
(trigger → `seed_default_camila_flow`), existe **exatamente um** `bot_flow` ativo
com `variant = 'D'` e `consultants.active_variants` inclui `'D'`; re-executar o
seed para o mesmo consultor **não cria fluxo adicional** (idempotência) e **não
altera** linhas de consultores pré-existentes.

**Validates: Requirements 2.1, 2.2, 2.3.**

## Por que PGlite (banco isolado) e não produção

- A restrição da Task 4.3 exige um banco **isolado** (PGlite snapshot ou branch
  Supabase) e proíbe tocar produção.
- O harness PGlite já é usado e versionado no repo (`.tmp/pg-snapshot-validate/`,
  mantido fora do `.gitignore`) e **executa plpgsql `SECURITY DEFINER`, RLS e
  triggers** — confirmado rodando o validador pré-existente (`validate.mjs`)
  nesta sessão. Logo, o trigger `trg_seed_camila_flow` e a função
  `seed_default_camila_flow` (que são o coração do REQ 2) rodam de verdade no
  banco isolado, sem mocks.

## Pré-condição (baseline)

Snapshot reproduzido fielmente da base ativa:

- `public.consultants` com `active_variants` **DEFAULT `ARRAY['A'::text]`**.
- `public.bot_flows` com `variant` **DEFAULT `'A'`** e `CHECK (variant IN
  ('A','B','C','D','E'))`.
- Índice único parcial `uniq_bot_flows_active_per_consultant_variant` em
  `(consultant_id, variant) WHERE is_active` (no máx. 1 fluxo ativo por
  consultor+variante).
- `public.seed_default_camila_flow(uuid)` no corpo **anterior** à migração
  (`INSERT INTO public.bot_flows` **sem** `variant`), verbatim de
  [`rollback/req2-backup.md`](./rollback/req2-backup.md).
- Trigger `trg_seed_camila_flow` → `seed_camila_flow_on_consultant_insert()`
  (AFTER INSERT em `consultants`), verbatim da migração `20260515102705`.
- Linha "Rafael-like" (id `0c2711ad-4836-41e6-afba-edd94f698ae3`) com **3 fluxos
  ativos A/B/D** semeados ANTES da migração.

## Asserções verificadas

### Step 2 — Migração aplica e é focada

- Migração aplica sem erro e é **idempotente** (`CREATE OR REPLACE` +
  `ALTER ... SET DEFAULT` re-executáveis).
- **Estática:** a migração **não** contém bloco de backfill
  (`FOR r IN SELECT id FROM public.consultants ... seed_default_camila_flow(r.id)`).
  Escopo confirmado: **apenas novas inserções**.

### Step 3 — Rafael inalterado (Req 6.6)

- Snapshot das linhas do Rafael (registro do consultor + todos os `bot_flows`)
  **byte-idêntico** pré/pós migração (comparação por `JSON.stringify`).
- Contagem de fluxos do Rafael inalterada (3 → 3). Nenhuma inserção/atualização.

### Step 4 — Consultor novo nasce em D (Req 2.1, 2.2)

Inserindo um consultor novo **sem** especificar `active_variants` (recebe o
DEFAULT pós-migração), o trigger provisiona via `seed_default_camila_flow`:

- **Exatamente 1** `bot_flow` ativo (Req 2.1).
- Esse fluxo é `variant = 'D'` (Req 2.1).
- `consultants.active_variants` **contém `'D'`** (Req 2.2) — de fato `ARRAY['D']`,
  pelo novo DEFAULT.
- O fluxo semeado tem os **6 passos** esperados (comportamento preservado).

### Step 5 — Idempotência (Req 2.3)

Re-chamando `seed_default_camila_flow(<mesmo consultor>)`:

- Retorna o **mesmo `flow_id`** (reuso do fluxo ativo via `SELECT` inicial).
- **Não** cria fluxo adicional (1 → 1).
- **Não** duplica passos (6 → 6).

### Step 6 — Rollback restaura função/coluna

Aplicando o rollback verbatim de
[`rollback/req2-rollback.md`](./rollback/req2-rollback.md):

- O `INSERT` da função volta a **não gravar `variant`**; corpo da função
  **byte-idêntico** ao estado pré-migração.
- `DEFAULT` de `active_variants` restaurado para `ARRAY['A'::text]`.
- **Confirmação empírica:** um consultor inserido **após** o rollback volta a
  nascer com `bot_flow` `variant='A'` e `active_variants = ARRAY['A']`.

## Como reproduzir

```bash
# uma vez (instala PGlite no harness versionado):
bun install --cwd .tmp/pg-snapshot-validate

# rodar o validador da Property 3:
node .tmp/pg-snapshot-validate/validate-req2-variant-d.mjs
```

Saída esperada (resumida):

```
== Validate REQ 2 (seed variante D) — Property 3 on isolated DB ==

Step 1: seed Rafael (A/B/D ativos) ANTES da migração + snapshot
  OK Rafael possui 3 fluxos ativos (A/B/D) antes da migração
Step 2: aplica a migração forward ...
  OK migração aplicada sem erro
  OK migração é idempotente (segunda execução sem erro)
  OK migração NÃO replica backfill de todos os consultores (escopo: novos apenas)
Step 3: Rafael inalterado ...
  OK linhas do Rafael byte-idênticas pré/pós migração (nenhum backfill rodou)
  OK contagem de fluxos do Rafael inalterada (sem inserções)
Step 4: consultor NOVO nasce na variante D ...
  OK (2.1) consultor novo tem exatamente 1 bot_flow ativo
  OK (2.1) o bot_flow ativo do consultor novo é variant='D'
  OK (2.2) consultants.active_variants do consultor novo contém 'D'
  OK (2.1) fluxo semeado do consultor novo tem 6 passos
Step 5: idempotência ...
  OK (2.3) re-chamada retorna o MESMO flow_id (reuso de fluxo ativo)
  OK (2.3) re-chamada NÃO cria fluxo adicional
  OK (2.3) re-chamada NÃO duplica passos
Step 6: rollback ...
  OK rollback: o INSERT da função NÃO grava mais variant
  OK rollback: corpo da função byte-idêntico ao estado pré-migração
  OK rollback: DEFAULT de active_variants restaurado para ARRAY['A'::text]
  OK rollback: consultor pós-rollback volta a nascer em variant='A'
  OK rollback: active_variants pós-rollback volta a ser ARRAY['A']

== validation complete ==
ALL ASSERTIONS PASSED
```

## Mapeamento de requisitos

- **2.1** — Consultor novo provisionado na variante D (`bot_flow` `variant='D'`).
  Comprovado em Step 4.
- **2.2** — `active_variants` inclui `'D'`. Comprovado em Step 4.
- **2.3 / idempotência** — re-seed não duplica; rollback documentado restaura o
  comportamento anterior. Comprovado em Steps 5 e 6.
- **6.6** — comportamento do Rafael preservado (linhas byte-idênticas; nenhum
  backfill). Comprovado em Steps 2 e 3.

## Arquivo do teste

`.tmp/pg-snapshot-validate/validate-req2-variant-d.mjs`
(tag `// Feature: evolution-multiconsultor-pronto, Property 3` no topo).
