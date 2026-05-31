# REQ 4 — Rollback da migração `WITH CHECK` em `Owner update customers`

> **Tarefa 7.4** — Documentar o rollback da migração REQ 4.
> _Requirements: 4.4, 6.2_
>
> Este artefato descreve o procedimento de **rollback** da migração do REQ 4, que
> recria a política `Owner update customers` **sem** a cláusula `WITH CHECK`
> (somente `USING (consultant_id = auth.uid())`), restaurando exatamente o estado
> pré-migração capturado em [`req4-backup.md`](./req4-backup.md).
>
> ⚠️ **NÃO AUTO-APLICÁVEL.** O rollback exige **aprovação humana explícita** e não
> deve ser aplicado automaticamente (`apply_migration` somente após sinal verde do
> operador — _Requirement 6.2_).

## Migração revertida

| Campo | Valor |
|-------|-------|
| Migração (forward) | `supabase/migrations/20260601030000_owner_update_customers_with_check.sql` |
| Spec / Tarefa | `evolution-multiconsultor-pronto` / Tarefa 7.2 |
| Objeto alterado | Política RLS `Owner update customers` em `public.customers` |
| Mudança aplicada pelo forward | Adicionou `WITH CHECK (consultant_id = auth.uid())` mantendo o `USING` |
| Backup do estado anterior | [`req4-backup.md`](./req4-backup.md) (9 políticas capturadas verbatim, `pg_policy`) |

### O que a migração forward fez (para contexto)

A migração `20260601030000_owner_update_customers_with_check.sql` executou um
DROP/CREATE focado na política `Owner update customers`:

```sql
DROP POLICY "Owner update customers" ON public.customers;

CREATE POLICY "Owner update customers" ON public.customers
  FOR UPDATE TO authenticated
  USING (consultant_id = auth.uid())
  WITH CHECK (consultant_id = auth.uid());   -- ← adicionado pelo forward
```

O rollback desfaz **apenas** a adição do `WITH CHECK`, recriando a política com o
`USING` original e **sem** `WITH CHECK` (estado `WITH CHECK = NULL`).

## SQL de rollback (exato)

> Restaura `Owner update customers` ao estado pré-migração (item #8 do inventário
> em `req4-backup.md`): `USING` presente, `WITH CHECK` ausente (`NULL`).

```sql
DROP POLICY "Owner update customers" ON public.customers;

CREATE POLICY "Owner update customers" ON public.customers
  FOR UPDATE TO authenticated
  USING (consultant_id = auth.uid());
```

> Observação: a política é recriada **sem** nenhuma cláusula `WITH CHECK`. Em
> PostgreSQL, uma política `UPDATE` sem `WITH CHECK` faz com que a verificação
> pós-alteração recaia sobre a expressão `USING` apenas para a leitura da linha —
> ou seja, o valor resultante de `consultant_id` deixa de ser validado, que é
> exatamente o comportamento pré-migração (e a vulnerabilidade que o forward
> corrige). Isto é intencional: o rollback **restaura o estado anterior**, não um
> estado mais seguro.

## Escopo — somente 1 das 9 políticas é tocada

Tanto a migração forward (7.2) quanto este rollback tocam **exclusivamente** a
política `Owner update customers`. As outras **8 políticas** de `public.customers`
permanecem **intactas** em ambos os sentidos (forward e rollback):

| # | Política | cmd | Tocada pelo forward/rollback? |
|---|----------|-----|-------------------------------|
| 1 | `Admins read all customers` | SELECT | ❌ intacta |
| 2 | `Assigned consultant select customers` | SELECT | ❌ intacta |
| 3 | `Assigned consultant update customers` | UPDATE | ❌ intacta |
| 4 | `Leader reads team customers` | SELECT | ❌ intacta |
| 5 | `Owner delete customers` | DELETE | ❌ intacta |
| 6 | `Owner insert customers` | INSERT | ❌ intacta |
| 7 | `Owner select customers` | SELECT | ❌ intacta |
| 8 | **`Owner update customers`** | **UPDATE** | ✅ **revertida (remove `WITH CHECK`)** |
| 9 | `managers can read customers` | SELECT | ❌ intacta |

O acesso de **admin**, **líder**, **manager** e **consultor designado** (`Assigned
consultant update customers`) é preservado pelo rollback, pois nenhuma dessas
políticas é alterada (_Requirement 4.3_).

## Verificação pós-rollback (sugerida)

Confirmar que a política voltou ao estado pré-migração (sem `WITH CHECK`):

```sql
SELECT
  pol.polname AS policy_name,
  pg_get_expr(pol.polqual, pol.polrelid)      AS using_expr,
  pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expr
FROM pg_policy pol
JOIN pg_class cls ON cls.oid = pol.polrelid
JOIN pg_namespace ns ON ns.oid = cls.relnamespace
WHERE ns.nspname = 'public'
  AND cls.relname = 'customers'
  AND pol.polname = 'Owner update customers';
```

Resultado esperado após o rollback:

| policy_name | using_expr | with_check_expr |
|-------------|------------|-----------------|
| `Owner update customers` | `(consultant_id = auth.uid())` | `NULL` |

Confirmar também que o total de políticas de `public.customers` permanece **9** e
que as outras 8 estão inalteradas (cf. inventário em `req4-backup.md`).

## Notas de segurança / processo

- **Não auto-aplicável:** o rollback exige **aprovação humana explícita**; não
  executar via `apply_migration` sem o sinal verde do operador (_Requirement 6.2_).
- **Backup como fonte da verdade:** o estado-alvo do rollback é exatamente o item #8
  capturado em [`req4-backup.md`](./req4-backup.md).
- **Trade-off de segurança:** ao remover o `WITH CHECK`, um consultor dono volta a
  poder reatribuir `consultant_id` durante um `UPDATE` (IDOR / quebra de isolamento
  multi-tenant). Reverter **somente** se o `WITH CHECK` estiver bloqueando updates
  legítimos e não houver correção forward viável de imediato.
- **Validação antes do rollout:** validar com roles simuladas
  (`set_config('request.jwt.claim.sub', ...)` / `SET ROLE authenticated`) num banco
  isolado/branch antes de aplicar em produção.
- **Sem impacto no Whapi/Rafael:** a mudança é estritamente de RLS de `customers`;
  não toca nenhum arquivo de webhook nem o caminho do Whapi (isolamento
  multi-tenant preservado — _Requirements 6.5, 6.6_).
