# Task 9.5 — Confirmação final: Rafael/Whapi inalterados

> Documento de validação da **Tarefa 9.5** do spec `evolution-multiconsultor-pronto`.
> **Confirmação transversal (REQ 6):** a operação atual do Rafael no canal Whapi
> **não** é perturbada por nenhuma mudança deste spec.
> _Validates: Requirements 6.5, 6.6_
>
> Anexar ao PR como evidência final do gate "não perturbar Rafael/Whapi".

## Provenance

- **Timestamp (UTC):** 2026-05-31T18:41:02Z
- **Commit base (HEAD):** `426d5e63`
- **Comandos rodados a partir da raiz do repo** (`/home/dev/Documents/Igreen-oficial/igreen-official-portal`).
- **Rafael:** super-admin, id `0c2711ad-4836-41e6-afba-edd94f698ae3`, opera variantes A/B/D no **Whapi**.

---

## 0. TL;DR — automático vs. gate manual

A tarefa 9.5 tem **4 confirmações**. Três são confirmadas **automaticamente** aqui;
uma permanece como **gate humano** (baseline ao vivo, pois as funções **não foram
deployadas**).

| # | Confirmação | Tipo | Status |
|---|-------------|------|--------|
| 1 | Nenhum arquivo de `whapi-webhook` tocado | Automático (git) | ✅ PROVADO |
| 2 | Linhas do Rafael byte-idênticas pós-migração REQ 2 (sem backfill) | Automático (DB isolado) | ✅ PROVADO |
| 3 | Baseline A/B/D do Whapi responde idêntico (paridade estrutural do seletor) | Estrutural ✅ / E2E ao vivo ⛔ | ✅ estrutural / ⛔ gate humano |
| 4 | Isolamento multi-tenant preservado | Automático (RLS REQ 4 + IDOR REQ 5) | ✅ PROVADO (com 1 achado residual REQ 4 em triagem) |

> **Honestidade de escopo:** a migração REQ 2 e as guardas REQ 1/3/5 **não foram
> aplicadas/deployadas em produção** — todas são não auto-aplicáveis e aguardam
> aprovação humana (REQ 6.3). As confirmações abaixo valem sobre o changeset local
> (git) e sobre bancos **isolados** (PGlite). O baseline A/B/D ao vivo do Whapi é o
> único item que exige execução por uma pessoa.

---

## 1. Confirmação #1 — Nenhum arquivo de `whapi-webhook` foi tocado (REQ 6.6)

A premissa do spec é que o canal Whapi do Rafael **não pode ser perturbado**. Prova
por `git`, a partir da raiz do repo:

| Comando | Resultado | Interpretação |
|---|---|---|
| `git status --short -- supabase/functions/whapi-webhook/` | *(saída vazia)* | nenhuma alteração na árvore de trabalho |
| `git ls-files --others --exclude-standard -- supabase/functions/whapi-webhook/` | *(saída vazia)* | nenhum arquivo novo não-rastreado |
| `git diff --stat HEAD -- supabase/functions/whapi-webhook/` | *(saída vazia)* | diffstat zerado vs. `HEAD` |

Os três comandos retornam **saída vazia** (exit 0). Para descartar a hipótese de
"vazio porque o diretório não existe", confirmamos que o diretório **existe e está
versionado** com 13 arquivos rastreados — todos intocados:

```
$ git ls-files -- supabase/functions/whapi-webhook/
supabase/functions/whapi-webhook/_helpers.ts
supabase/functions/whapi-webhook/handlers/bot-flow.ts
supabase/functions/whapi-webhook/handlers/bot-flow_test.ts
supabase/functions/whapi-webhook/handlers/conversational/index.ts
supabase/functions/whapi-webhook/handlers/conversational/intent-classifier.ts
supabase/functions/whapi-webhook/handlers/conversational/intent-classifier_test.ts
supabase/functions/whapi-webhook/handlers/conversational/state-machine.ts
supabase/functions/whapi-webhook/handlers/conversational/state-machine_test.ts
supabase/functions/whapi-webhook/handlers/conversational/templates.ts
supabase/functions/whapi-webhook/handlers/step-namespace.ts
supabase/functions/whapi-webhook/handlers/step-namespace_test.ts
supabase/functions/whapi-webhook/handlers/types.ts
supabase/functions/whapi-webhook/index.ts
```

### Conjunto COMPLETO de arquivos alterados pelo spec (whapi-webhook ausente)

`git status --short` (tracked + untracked) lista todo o changeset do spec. Nenhuma
entrada está sob `whapi-webhook/`:

```
 M supabase/functions/.env.example
 M supabase/functions/ai-agent-router/index.ts
 M supabase/functions/ai-sales-agent/index.ts
 M supabase/functions/capture-extract/index.ts
 M supabase/functions/evolution-webhook/index.ts
 M supabase/functions/facebook-capi/index.ts
 M supabase/functions/upload-documents-minio/index.ts
 M vitest.config.ts
?? .kiro/specs/evolution-multiconsultor-pronto/
?? .tmp/pg-snapshot-validate/validate-req2-variant-d.mjs
?? .tmp/pg-snapshot-validate/validate-req4-rls.mjs
?? src/lib/flow-selectors/
?? src/lib/whatsapp/flow-selector.property.test.ts
?? src/lib/whatsapp/flow-selector.ts
?? src/test/caller-auth-assertOwnership.property.test.ts
?? src/test/caller-auth-per-function.example.test.ts
?? src/test/caller-auth-resolveCaller.property.test.ts
?? src/test/evolution-kill-switch-gate.property.test.ts
?? src/test/evolution-kill-switch-guard.test.ts
?? src/test/evolution-service-secret-hygiene.test.ts
?? supabase/functions/_shared/bot/kill-switch-gate.ts
?? supabase/functions/_shared/caller-auth.ts
?? supabase/migrations/20260601030000_owner_update_customers_with_check.sql
?? supabase/migrations/20260601030000_req2_seed_default_camila_flow_variant_d.sql
```

Entre os **webhooks**, apenas `evolution-webhook/index.ts` foi alterado. Diffstat de
edge functions (somente código de produção tocado):

```
 supabase/functions/.env.example                    |  8 ++++++
 supabase/functions/ai-agent-router/index.ts        | 10 +++++++
 supabase/functions/ai-sales-agent/index.ts         | 11 +++++++
 supabase/functions/capture-extract/index.ts        | 17 +++++++++--
 supabase/functions/evolution-webhook/index.ts      | 43 +++++++++++++++++++++++++---
 supabase/functions/facebook-capi/index.ts          | 14 +++++++++
 supabase/functions/upload-documents-minio/index.ts | 11 +++++--
 7 files changed, 105 insertions(+), 9 deletions(-)
```

**Conclusão:** `supabase/functions/whapi-webhook/**` é **byte-inalterado**. ✅

---

## 2. Confirmação #2 — Linhas do Rafael inalteradas após a migração REQ 2 (REQ 6.6)

A migração REQ 2 (`supabase/migrations/20260601030000_req2_seed_default_camila_flow_variant_d.sql`)
altera **apenas** a definição da função `seed_default_camila_flow` (passa a gravar
`variant => 'D'` no INSERT) e o DEFAULT de `consultants.active_variants` — afetando
**somente novas inserções**. Ela **não** replica o bloco de backfill de todos os
consultores.

> A migração **NÃO** está aplicada em produção (gated por aprovação humana —
> REQ 6.3). Esta confirmação roda num banco **isolado** (PGlite, Postgres real em
> WASM) — **nunca toca produção** — exatamente como a Tarefa 4.3.

Script: `.tmp/pg-snapshot-validate/validate-req2-variant-d.mjs`
Comando: `node validate-req2-variant-d.mjs` (a partir de `.tmp/pg-snapshot-validate/`)

O script semeia uma linha "Rafael-like" (id `0c2711ad-4836-41e6-afba-edd94f698ae3`)
com fluxos A/B/D ativos, tira snapshot, aplica o corpo **real** da migração forward,
e re-snapshot. Asserções relevantes (Step 1–3), verbatim da execução:

```
Step 1: seed Rafael (A/B/D ativos) ANTES da migração + snapshot
  OK Rafael possui 3 fluxos ativos (A/B/D) antes da migração

Step 2: aplica a migração forward 20260601030000_req2_seed_default_camila_flow_variant_d.sql
  OK migração aplicada sem erro
  OK migração é idempotente (segunda execução sem erro)
  OK migração NÃO replica backfill de todos os consultores (escopo: novos apenas)

Step 3: Rafael inalterado (snapshot pré/pós migração byte-idêntico)
  OK linhas do Rafael byte-idênticas pré/pós migração (nenhum backfill rodou)
  OK contagem de fluxos do Rafael inalterada (sem inserções)
```

Resultado global: **ALL ASSERTIONS PASSED** (exit 0).

As asserções citadas provam, sobre a migração REQ 2:

- **Byte-identidade:** o snapshot do consultor + fluxos A/B/D do Rafael é
  `JSON.stringify`-idêntico antes e depois da migração (`rafaelAfter === rafaelBefore`).
- **Nenhum backfill rodou:** a contagem de fluxos do Rafael permanece 3 (sem
  inserções) e uma checagem estática confirma que a migração não contém bloco
  `FOR r IN SELECT id FROM public.consultants ... seed_default_camila_flow(r.id)`.
- **Idempotência preservada:** o `SELECT` de reuso de fluxo ativo no topo do seed
  garante no-op para quem já tem fluxo ativo (caso do Rafael).

**Conclusão:** as linhas A/B/D do Rafael permanecem byte-idênticas; o escopo da
migração é "novos consultores apenas". ✅

---

## 3. Confirmação #3 — Baseline A/B/D do Whapi responde idêntico (REQ 6.5, 6.6)

A correção REQ 3 (resolução determinística de fluxo) no `evolution-webhook` usa um
seletor **estruturalmente idêntico** ao que o Whapi já roda em produção. A paridade
1:1 está documentada e provada em `req3-dual-channel-validation.md` (seção 1):
mesmo `variant` default, mesmas cláusulas `.eq("is_active",true).eq("variant",variant)`,
mesmo `.order("created_at",{ascending:true}).limit(1)`, mesmo `activeFlows?.[0] || null`.
A **única** diferença é o `consultant_id` filtrado (instância Evolution vs.
`superAdminConsultantId` fixo no Whapi) — esperada e correta.

Como o seletor do Evolution **espelha** o do Whapi e **nenhum arquivo do
`whapi-webhook` foi tocado** (seção 1), não há divergência de comportamento a
introduzir no canal do Rafael. A paridade do seletor é validada automaticamente pela
Property 2 (model-based contra o oráculo do whapi), 5 props × 300 runs — ver
`req3-dual-channel-validation.md` seção 3.

### Honestidade: o baseline A/B/D ao vivo é um gate humano

⛔ O **baseline A/B/D ao vivo** do Rafael no canal Whapi **NÃO** foi executado aqui.
Isso exige funções **deployadas** + observação do canal Whapi real + **aprovação
humana explícita** (REQ 6.2, 6.3, 6.5). A mudança do REQ 1 e REQ 3 **não foi
deployada**. O checklist de execução manual está em:

- `req1-dual-channel-validation.md` §4.2 (baseline Whapi A/B/D — REQ 1)
- `req3-dual-channel-validation.md` §4.2 (baseline Whapi A/B/D — REQ 3)

**Conclusão:** paridade estrutural do seletor confirmada automaticamente; a
confirmação **comportamental ao vivo** (respostas idênticas ao baseline) permanece
como gate humano obrigatório antes do rollout. ✅ estrutural / ⛔ E2E manual.

---

## 4. Confirmação #4 — Isolamento multi-tenant preservado (REQ 6.4)

O isolamento multi-tenant é endereçado por dois workstreams, ambos validados em
banco/teste isolado (sem tocar produção):

### 4.1 REQ 4 — `WITH CHECK` no UPDATE de `customers` (camada RLS)

Script: `.tmp/pg-snapshot-validate/validate-req4-rls.mjs` (PGlite isolado, 9 políticas
de produção verbatim, role `authenticated` simulado). Resultado das asserções
nomeadas (GROUP A), verbatim:

```
Step 4: GROUP A — REQUIRED task-named assertions (post-migration target)
  OK 4.1 consultant A updates own row keeping consultant_id=A -> succeeds (1 row)
  OK 4.2 consultant A reassign own row to consultant_id=B -> rejected; owner unchanged (=A)
  OK 4.3 assigned consultant update of assigned row still works (policy intact)
  OK 4.3 admin still reads all customers (3 rows)
  OK 4.3 leader still reads team (A) customer
  OK 4.3 owner A still sees only its own row (isolation preserved)

GROUP A (required task assertions): ALL PASS
```

- A reatribuição direta de `consultant_id` para outro consultor é **rejeitada**; o
  isolamento de leitura do dono, do admin e do líder é **preservado**.
- ⚠️ **Achado residual (GROUP B):** existe uma rota combinada
  (`consultant_id=B` + `assigned_consultant_id=A`) que não é bloqueada, devido ao
  OR das cláusulas `WITH CHECK` de políticas permissivas. Está **documentado para
  triagem humana** em `req4-rls-validation.md` (não alteramos critérios de aceitação
  por conta própria). Isso **não** afeta o Rafael (single-tenant no Whapi) nem o
  isolamento de leitura; é um gap do endurecimento de UPDATE, registrado e pendente
  de decisão do operador.

### 4.2 REQ 5 — Guarda IDOR nas 5 edge functions `service_role`

A guarda (`_shared/caller-auth.ts`: `resolveCaller` + `assertOwnership`) impede que
um consultor leia/modifique recurso de outro informando apenas o id. Testes
(Properties 5 e 6 + exemplos por função), verbatim:

```
$ npx vitest run \
    src/test/caller-auth-resolveCaller.property.test.ts \
    src/test/caller-auth-assertOwnership.property.test.ts \
    src/test/caller-auth-per-function.example.test.ts

 ✓ src/test/caller-auth-per-function.example.test.ts (33 tests) 116ms
 ✓ src/test/caller-auth-resolveCaller.property.test.ts (1 test) 204ms
 ✓ src/test/caller-auth-assertOwnership.property.test.ts (8 tests) 226ms

 Test Files  3 passed (3)
      Tests  42 passed (42)
```

- **Property 5** (`resolveCaller`): classifica `service`/`jwt`/`401` corretamente,
  sem efeito colateral no ramo 401.
- **Property 6** (`assertOwnership`): autoriza apenas dono, admin ou serviço; `403`
  para recurso de outro consultor; `400` para id ausente/malformado/inexistente; sem
  mutação nos ramos de negação.
- A chamada interna `evolution-webhook → ai-agent-router` continua funcionando via
  `x-service-secret` (modo `service`).

**Conclusão:** o isolamento multi-tenant é preservado/endurecido tanto na RLS
(REQ 4) quanto nas edge functions service_role (REQ 5); nenhuma mudança afeta o
caminho do Whapi do Rafael. ✅ (com o achado residual REQ 4 em triagem documentada).

---

## 5. Mapeamento de requisitos

| Req | Como é coberto | Status |
|---|---|---|
| **6.5** — validar no Evolution + confirmar não-regressão no Whapi antes do rollout | Não-regressão estrutural do Whapi provada via git (seção 1) + paridade 1:1 do seletor (seção 3); baseline A/B/D ao vivo no checklist manual | ✅ estrutural / ⛔ E2E manual |
| **6.6** — preservar comportamento do Rafael (A/B/D no Whapi) | `whapi-webhook` byte-untouched (seção 1); linhas do Rafael byte-idênticas pós-migração REQ 2 (seção 2); seletor idêntico ao do Whapi (seção 3) | ✅ verificado automaticamente / ⛔ baseline ao vivo manual |
| **6.4** — preservar isolamento multi-tenant em todas as mudanças | RLS REQ 4 GROUP A (seção 4.1) + IDOR REQ 5 Properties 5/6 (seção 4.2) | ✅ verificado (achado residual REQ 4 em triagem) |

---

## 6. Resumo

- **Automaticamente confirmado:**
  1. `supabase/functions/whapi-webhook/**` byte-untouched (3 comandos git vazios; 13
     arquivos rastreados intactos; ausente do changeset completo do spec).
  2. Linhas A/B/D do Rafael (id `0c2711ad-…-698ae3`) byte-idênticas pré/pós migração
     REQ 2, sem backfill (DB isolado — `ALL ASSERTIONS PASSED`).
  3. Paridade estrutural 1:1 do seletor REQ 3 Evolution ↔ Whapi (Property 2 verde).
  4. Isolamento multi-tenant preservado: RLS REQ 4 GROUP A (ALL PASS) + IDOR REQ 5
     (42/42 testes verdes).
- **Permanece como gate humano (não executável aqui):** o **baseline A/B/D ao vivo**
  do Whapi do Rafael (respostas idênticas), porque as funções **não foram
  deployadas** e o rollout é não auto-aplicável (REQ 6.2/6.3/6.5).
- **Achado residual aberto (não bloqueia o Rafael):** rota combinada de UPDATE no
  REQ 4 (`consultant_id` + `assigned_consultant_id`) — documentada para triagem
  humana em `req4-rls-validation.md`.
