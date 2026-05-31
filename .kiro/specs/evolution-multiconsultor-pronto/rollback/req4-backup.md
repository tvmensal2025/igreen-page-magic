# REQ 4 — Backup das políticas RLS de `public.customers` (ANTES da mudança)

> **Tarefa 7.1** — Backup ANTES das políticas RLS de `customers`.
> _Requirements: 4.4, 6.1, 6.2, 6.3_
>
> Este artefato captura **verbatim** o estado de **todas** as políticas RLS de
> `public.customers` **antes** da migração do REQ 4 (adicionar `WITH CHECK` à
> política `Owner update customers`). Anexar ao PR e usar como base de rollback.
>
> ⚠️ **Nenhum objeto de banco foi modificado nesta tarefa.** Captura read-only.

## Metadados da captura

| Campo | Valor |
|-------|-------|
| Fonte (source) | Supabase production — `https://zlzasfhcxcznaprrragl.supabase.co` |
| Project ref | `zlzasfhcxcznaprrragl` |
| Database | `postgres` |
| Schema / Tabela | `public.customers` |
| RLS habilitado (`relrowsecurity`) | `true` |
| RLS forçado (`relforcerowsecurity`) | `false` |
| Timestamp da captura (UTC) | `2026-05-31 16:10:34.263083+00` |
| Método de captura | `pg_policy` JOIN `pg_class`/`pg_namespace` + `pg_get_expr` (USING/WITH CHECK) |
| Total de políticas capturadas | **9** |

### Query usada na captura (read-only)

```sql
SELECT
  pol.polname AS policy_name,
  CASE pol.polcmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
    WHEN '*' THEN 'ALL'
  END AS command,
  pol.polpermissive AS permissive,
  CASE
    WHEN pol.polroles = '{0}'::oid[] THEN ARRAY['public']
    ELSE ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(pol.polroles) ORDER BY rolname)
  END AS roles,
  pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
  pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expr
FROM pg_policy pol
JOIN pg_class cls ON cls.oid = pol.polrelid
JOIN pg_namespace ns ON ns.oid = cls.relnamespace
WHERE ns.nspname = 'public' AND cls.relname = 'customers'
ORDER BY pol.polname;
```

## 🎯 Estado atual do alvo da mudança — `Owner update customers`

> **DESTAQUE (estado pré-migração):** a política `Owner update customers` hoje tem
> `USING` **presente** e `WITH CHECK` **NULL**. Esta é exatamente a condição que o
> REQ 4 corrige. Com múltiplos consultores reais, a ausência de `WITH CHECK` permite
> que um dono reatribua `consultant_id` para outro consultor durante um `UPDATE`
> (IDOR / quebra de isolamento multi-tenant).

| Campo | Valor capturado |
|-------|-----------------|
| Policy name | `Owner update customers` |
| Command | `UPDATE` |
| Permissive | `true` (PERMISSIVE) |
| Roles | `authenticated` |
| `USING` (qual) | `(consultant_id = auth.uid())` ✅ **presente** |
| `WITH CHECK` (with_check) | `NULL` ⚠️ **AUSENTE → alvo da mudança** |

## Inventário completo das 9 políticas de `public.customers` (verbatim)

| # | Política | cmd | Permissive | Roles | USING (qual) | WITH CHECK (with_check) |
|---|----------|-----|------------|-------|--------------|--------------------------|
| 1 | `Admins read all customers` | SELECT | true | `authenticated` | `has_role(auth.uid(), 'admin'::app_role)` | `NULL` |
| 2 | `Assigned consultant select customers` | SELECT | true | `public` | `(assigned_consultant_id = auth.uid())` | `NULL` |
| 3 | `Assigned consultant update customers` | UPDATE | true | `public` | `(assigned_consultant_id = auth.uid())` | `(assigned_consultant_id = auth.uid())` |
| 4 | `Leader reads team customers` | SELECT | true | `authenticated` | `is_team_member(auth.uid(), consultant_id)` | `NULL` |
| 5 | `Owner delete customers` | DELETE | true | `authenticated` | `(consultant_id = auth.uid())` | `NULL` |
| 6 | `Owner insert customers` | INSERT | true | `authenticated` | `NULL` | `(consultant_id = auth.uid())` |
| 7 | `Owner select customers` | SELECT | true | `authenticated` | `(consultant_id = auth.uid())` | `NULL` |
| 8 | **`Owner update customers`** | **UPDATE** | **true** | **`authenticated`** | **`(consultant_id = auth.uid())`** | **`NULL` ⚠️ alvo** |
| 9 | `managers can read customers` | SELECT | true | `public` | `can_view_consultant(auth.uid(), consultant_id)` | `NULL` |

### Resultado bruto (JSON, verbatim da captura)

```json
[
  {"policy_name":"Admins read all customers","command":"SELECT","permissive":true,"roles":"{authenticated}","using_expr":"has_role(auth.uid(), 'admin'::app_role)","with_check_expr":null},
  {"policy_name":"Assigned consultant select customers","command":"SELECT","permissive":true,"roles":"{public}","using_expr":"(assigned_consultant_id = auth.uid())","with_check_expr":null},
  {"policy_name":"Assigned consultant update customers","command":"UPDATE","permissive":true,"roles":"{public}","using_expr":"(assigned_consultant_id = auth.uid())","with_check_expr":"(assigned_consultant_id = auth.uid())"},
  {"policy_name":"Leader reads team customers","command":"SELECT","permissive":true,"roles":"{authenticated}","using_expr":"is_team_member(auth.uid(), consultant_id)","with_check_expr":null},
  {"policy_name":"Owner delete customers","command":"DELETE","permissive":true,"roles":"{authenticated}","using_expr":"(consultant_id = auth.uid())","with_check_expr":null},
  {"policy_name":"Owner insert customers","command":"INSERT","permissive":true,"roles":"{authenticated}","using_expr":null,"with_check_expr":"(consultant_id = auth.uid())"},
  {"policy_name":"Owner select customers","command":"SELECT","permissive":true,"roles":"{authenticated}","using_expr":"(consultant_id = auth.uid())","with_check_expr":null},
  {"policy_name":"Owner update customers","command":"UPDATE","permissive":true,"roles":"{authenticated}","using_expr":"(consultant_id = auth.uid())","with_check_expr":null},
  {"policy_name":"managers can read customers","command":"SELECT","permissive":true,"roles":"{public}","using_expr":"can_view_consultant(auth.uid(), consultant_id)","with_check_expr":null}
]
```

## DDL reconstruída (estado ANTES) — para rollback / referência

> As declarações abaixo recriam o estado **pré-migração** capturado acima.
> Use-as como base do rollback do REQ 4. A única política que a migração 7.2
> altera é `Owner update customers`; todas as demais devem permanecer **intactas**.

```sql
-- 1) Admins read all customers
CREATE POLICY "Admins read all customers" ON public.customers
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 2) Assigned consultant select customers
CREATE POLICY "Assigned consultant select customers" ON public.customers
  FOR SELECT TO public
  USING (assigned_consultant_id = auth.uid());

-- 3) Assigned consultant update customers  (PRESERVAR INTACTA)
CREATE POLICY "Assigned consultant update customers" ON public.customers
  FOR UPDATE TO public
  USING (assigned_consultant_id = auth.uid())
  WITH CHECK (assigned_consultant_id = auth.uid());

-- 4) Leader reads team customers
CREATE POLICY "Leader reads team customers" ON public.customers
  FOR SELECT TO authenticated
  USING (is_team_member(auth.uid(), consultant_id));

-- 5) Owner delete customers
CREATE POLICY "Owner delete customers" ON public.customers
  FOR DELETE TO authenticated
  USING (consultant_id = auth.uid());

-- 6) Owner insert customers
CREATE POLICY "Owner insert customers" ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (consultant_id = auth.uid());

-- 7) Owner select customers
CREATE POLICY "Owner select customers" ON public.customers
  FOR SELECT TO authenticated
  USING (consultant_id = auth.uid());

-- 8) Owner update customers  ← ALVO DA MUDANÇA (estado ANTES: WITH CHECK ausente)
CREATE POLICY "Owner update customers" ON public.customers
  FOR UPDATE TO authenticated
  USING (consultant_id = auth.uid());
  -- NOTA: sem WITH CHECK no estado atual (NULL)

-- 9) managers can read customers
CREATE POLICY "managers can read customers" ON public.customers
  FOR SELECT TO public
  USING (can_view_consultant(auth.uid(), consultant_id));
```

## Rollback do REQ 4 (referência — detalhado na tarefa 7.4)

Para reverter a migração do REQ 4, recriar `Owner update customers` **sem** a
cláusula `WITH CHECK` (somente `USING`), restaurando exatamente o estado #8 acima:

```sql
DROP POLICY "Owner update customers" ON public.customers;
CREATE POLICY "Owner update customers" ON public.customers
  FOR UPDATE TO authenticated
  USING (consultant_id = auth.uid());
```

## Notas de segurança / processo

- Captura **read-only**: nenhuma política, tabela ou objeto de banco foi alterado.
- Backup tirado **ANTES** de qualquer aplicação da migração do REQ 4 (gate do _Requirement 6.2_).
- A migração do REQ 4 (tarefa 7.2) é **única, focada e não auto-aplicável** — exige
  aprovação humana explícita antes de `apply_migration` (_Requirements 6.1, 6.3_).
- Todas as 8 políticas além de `Owner update customers` devem permanecer **intactas**
  para preservar o acesso de admin, líder, manager e consultor designado (_Requirement 4.3_).
