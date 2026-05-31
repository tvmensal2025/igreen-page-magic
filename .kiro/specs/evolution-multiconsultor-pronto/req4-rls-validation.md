# Task 7.3 — Validação do teste de integração RLS (`WITH CHECK` em `customers`)

> Documento de validação da **Tarefa 7.3** do spec `evolution-multiconsultor-pronto`.
> **Property 4 — UPDATE em `customers` não pode reatribuir `consultant_id`.**
> _Validates: Requirements 4.1, 4.2, 4.3_
>
> Anexar ao PR como evidência da integração RLS do REQ 4.

## Resumo

A migração forward `supabase/migrations/20260601030000_owner_update_customers_with_check.sql`
foi validada com um **teste de integração RLS** executado contra uma instância
**isolada** de Postgres (PGlite, Postgres real em WASM). O teste:

1. reconstrói `public.customers` com RLS habilitado e as **9 políticas de
   produção verbatim** (de `rollback/req4-backup.md`), incluindo os helpers
   `has_role`, `is_team_member`, `can_view_consultant`;
2. simula o role `authenticated` do Supabase com um `auth.uid()` dado, via
   `SELECT set_config('request.jwt.claim.sub', <uuid>, false)` + `SET ROLE authenticated`;
3. roda a matriz de ataque/acesso **antes e depois** de aplicar a migração, para
   documentar exatamente o que a cláusula `WITH CHECK` muda.

> ⚠️ **Isolamento total:** o teste roda numa instância PGlite em memória criada
> a cada execução. **Nunca toca produção** nem nenhuma base remota.

Script: `.tmp/pg-snapshot-validate/validate-req4-rls.mjs`
Comando: `node .tmp/pg-snapshot-validate/validate-req4-rls.mjs`

## Resultado

### GROUP A — asserções nomeadas da tarefa 7.3: **TODAS PASSAM** ✅

As 3 asserções que a tarefa enumera explicitamente passam no estado
**pós-migração** (alvo de produção):

| # | Cenário | Resultado |
|---|---------|-----------|
| 4.1 | Consultor A atualiza própria linha mantendo `consultant_id=A` | ✅ sucede (1 linha) |
| 4.2 | Consultor A tenta `consultant_id=B` (reatribuição direta) | ✅ rejeitado (`new row violates row-level security policy`); dono permanece A |
| 4.3 | Consultor designado atualiza linha atribuída | ✅ continua funcionando (política `Assigned consultant update customers` intacta) |
| 4.3 | Admin lê todos os clientes | ✅ vê as 3 linhas |
| 4.3 | Líder lê cliente do time (A) | ✅ vê a linha de A |
| 4.3 | Isolamento de leitura do dono A | ✅ A vê apenas a própria linha |

Sanidade da migração: a política `Owner update customers` passa a ter
`WITH CHECK (consultant_id = auth.uid())` e as **9 políticas** seguem presentes
(as outras 8 intactas).

### GROUP B — probe universal da Property 4: **1 ACHADO RESIDUAL** ⚠️

A Property 4 afirma de forma **universal**: *"qualquer UPDATE que tente definir
`consultant_id` para outro consultor é rejeitado"*. Uma sonda adversarial além
dos 3 exemplos nomeados encontrou um **contra-exemplo**:

```
Contra-exemplo (P4 universal):
  Como consultor A (auth.uid()=A), executar:
    UPDATE public.customers
       SET consultant_id = B,            -- reatribui para outro consultor
           assigned_consultant_id = A    -- e se coloca como "designado"
     WHERE id = <linha de A>;
  Resultado: affected=1 (ACEITO); dono resultante = B  ← reatribuição efetivada
```

Esse UPDATE **não** é bloqueado — nem antes nem depois da migração.

#### Causa raiz (verificada empiricamente)

O PostgreSQL combina por **OR** as cláusulas `WITH CHECK` de **todas as políticas
PERMISSIVE** de UPDATE. Em `public.customers` há **duas** políticas UPDATE
permissivas:

- `Owner update customers` → `WITH CHECK (consultant_id = auth.uid())` (adicionada pelo REQ 4)
- `Assigned consultant update customers` → `WITH CHECK (assigned_consultant_id = auth.uid())` (pré-existente, **preservada** pelo REQ 4)

A linha resultante `{consultant_id=B, assigned_consultant_id=A}` **falha** o
check do owner mas **satisfaz** o check do assigned (`assigned_consultant_id = A
= auth.uid()`). Como os checks são OR-ados, o UPDATE é aceito. A migração fecha
a **reatribuição direta** (4.2, com `assigned_consultant_id` nulo) mas **não**
fecha essa rota combinada.

#### Diff comportamental PRE vs POST (honestidade)

| Cenário | PRE-migração | POST-migração | Mudou? |
|---------|--------------|---------------|--------|
| A atualiza própria linha (mantém cid) | aceito (1) | aceito (1) | = |
| A reatribui cid→B (`assigned`=NULL) | **rejeitado** | **rejeitado** | = |
| A reatribui cid→B mantendo `assigned`=A | aceito → dono=B | aceito → dono=B | = |

> **Constatação importante:** mesmo a reatribuição direta (linha 2) já era
> rejeitada **antes** da migração, porque em PostgreSQL uma política UPDATE com
> `WITH CHECK` omitido usa a expressão `USING` como verificação pós-alteração
> implícita. Ou seja, para o caso `assigned_consultant_id IS NULL`, a migração é
> um **no-op comportamental** (embora torne a intenção explícita e robusta a
> mudanças futuras de outras políticas). O ganho de segurança real do REQ 4 é
> menor do que o requisito sugere, e a rota combinada acima permanece aberta.

## Triagem (decisão pendente do operador)

Conforme as regras de triagem de contra-exemplo, **não** alteramos os critérios
de aceitação por conta própria. O achado da GROUP B precisa de decisão humana.
Opções:

1. **Endurecer a migração** — em vez de só adicionar `WITH CHECK` ao owner,
   garantir que `consultant_id` não possa ser reatribuído por nenhuma política
   de UPDATE de não-admin. Ex.: a política `Assigned consultant update customers`
   poderia ter `WITH CHECK (assigned_consultant_id = auth.uid() AND consultant_id = (SELECT consultant_id FROM ... linha original))`
   — porém RLS não enxerga o valor *antigo* da linha; isso normalmente exige um
   **trigger `BEFORE UPDATE`** que rejeite mudança de `consultant_id` por não-admin
   (RLS sozinho não consegue comparar valor antigo vs. novo).
2. **Documentar como exceção aceita** — se o fluxo de negócio do "consultor
   designado" legitimamente precisa reatribuir, registrar a interação como
   exceção conhecida e ajustar a Property 4 / Req 4.2 (com aprovação).
3. **Restringir o role** — a política `Assigned consultant update customers` é
   `TO public`; reavaliar se deveria ser `authenticated` e/ou limitar as colunas
   atualizáveis (column-level privileges).

> **Nenhuma destas é aplicada automaticamente.** A migração do REQ 4 permanece
> não auto-aplicável e aguarda aprovação humana (Requisitos 6.1, 6.3, 6.4).

## Fidelidade do harness (honestidade sobre o que pôde/ não pôde ser executado)

A preocupação levantada na tarefa — *"RLS com `auth.uid()`/`SET ROLE` pode não
ser fielmente reproduzível sob PGlite"* — foi **verificada e refutada** para os
aspectos relevantes:

**Pôde ser executado fielmente (PGlite = Postgres real em WASM):**

- `CREATE ROLE authenticated` + `SET ROLE authenticated` aplicam o RLS como role
  não-privilegiado (o superusuário do PGlite faz bypass; o role `authenticated`
  **não**).
- `auth.uid()` reimplementado lendo `request.jwt.claim.sub` — idêntico à
  convenção do Supabase.
- **Importante:** os settings precisam ser de **sessão** (`set_config(..., false)`),
  não locais (`true`), porque o PGlite faz autocommit por statement e um setting
  `is_local=true` é descartado antes do próximo `query`. Com `is_local=false` o
  RLS enxerga o `auth.uid()` corretamente (verificado: com `true`, o dono nem
  enxergava a própria linha).
- Semântica `USING` vs `WITH CHECK`, rejeição com `new row violates row-level
  security policy`, e a **combinação OR de políticas permissivas** — todas
  reproduzidas fielmente (é exatamente isso que expôs o achado da GROUP B).

**Não reproduzido (e por que não é necessário aqui):**

- `auth.users` real / emissão de JWT do GoTrue — desnecessário; o que importa
  para RLS é o claim `sub`, que injetamos via `set_config`.
- Demais tabelas/políticas do schema fora de `customers` e seus helpers — fora
  de escopo da Property 4.

**Conclusão de fidelidade:** o teste é uma reprodução fiel da semântica RLS do
REQ 4 e **não** é um falso-positivo. As asserções nomeadas da tarefa passam
legitimamente; o achado da GROUP B é um gap real do REQ 4 (não um artefato do
PGlite), e está registrado para triagem humana.

## Como reproduzir

```bash
cd .tmp/pg-snapshot-validate
bun install            # instala @electric-sql/pglite (já no package.json)
node validate-req4-rls.mjs
```

Saída esperada (resumida): `GROUP A (required task assertions): ALL PASS` e
`GROUP B (Property-4 universal) — 1 RESIDUAL FINDING(S)` com o contra-exemplo da
rota `assigned_consultant_id`.

## Mapeamento de requisitos

- **4.1** — A mantém `consultant_id=A` no próprio UPDATE → sucede. ✅ (GROUP A)
- **4.2** — A tenta `consultant_id=B` (direto) → rejeitado. ✅ (GROUP A) /
  ⚠️ rota combinada via `assigned_consultant_id` permanece aberta (GROUP B,
  triagem pendente).
- **4.3** — Admin / líder / consultor designado mantêm acesso anterior. ✅ (GROUP A).
