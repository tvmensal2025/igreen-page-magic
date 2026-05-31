# Tarefa 9.1 — Revisão dos Supabase Advisors (segurança + performance)

> Documento de revisão da **Tarefa 9.1** do spec `evolution-multiconsultor-pronto`.
> _Requirements: 4.1, 4.3, 6.1, 6.4_
>
> Execução **read-only** dos advisors de **segurança** e **performance** via Supabase MCP
> (`get_advisors type=security` e `type=performance`). **Nenhuma migração foi aplicada.**

## Estado capturado (baseline)

⚠️ **Importante — o que este baseline reflete.** A migração do REQ 4
(`supabase/migrations/20260601030000_owner_update_customers_with_check.sql`) é
**não auto-aplicável** e **ainda NÃO foi aplicada** ao banco de produção (gated por
aprovação humana — Req 6.1/6.3/6.4). Confirmado nesta sessão por duas evidências:

1. `pg_policies` da live DB: a política `Owner update customers` em `public.customers`
   tem `qual = (consultant_id = auth.uid())` e **`with_check = NULL`** (estado pré-REQ 4).
2. `list_migrations`: a versão `20260601030000` **não** consta na lista de migrações
   aplicadas.

Portanto, os findings abaixo representam o **estado atual da produção, sem o
`WITH CHECK` do REQ 4**.

## Resumo executivo

| Categoria | Lint | Nível | Qtde | Relevante ao spec? |
|-----------|------|-------|------|--------------------|
| Segurança | [Public Bucket Allows Listing](https://supabase.com/docs/guides/database/database-linter?lint=0025_public_bucket_allows_listing) | WARN | 5 buckets | ❌ fora de escopo (security-hardening-lgpd) |
| Segurança | [Public Can Execute SECURITY DEFINER Function](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) | WARN | ~29 funções (role `anon`) | ❌ fora de escopo (security-hardening-lgpd) |
| Segurança | [Signed-In Users Can Execute SECURITY DEFINER Function](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) | WARN | ~60 funções (role `authenticated`) | ❌ fora de escopo (security-hardening-lgpd) |
| Segurança | [Leaked Password Protection Disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) | WARN | 1 | ❌ fora de escopo (security-hardening-lgpd) |
| Performance | [Auth RLS Initialization Plan](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan) | WARN | ~140+ políticas (9 em `customers`) | ⚠️ toca `customers` (ver abaixo) |
| Performance | [Multiple Permissive Policies](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies) | WARN | muitas (várias em `customers`) | ⚠️ toca `customers` (ver abaixo) |
| Performance | [Unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) | INFO | 15 | ❌ não relacionado ao spec |
| Performance | [Duplicate Index](https://supabase.com/docs/guides/database/database-linter?lint=0009_duplicate_index) | WARN | 10 tabelas | ⚠️ inclui `bot_flows` e `customers` (nota) |
| Performance | [Unused Index](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) | INFO | ~50 | ❌ não relacionado ao spec |
| Performance | [No Primary Key](https://supabase.com/docs/guides/database/database-linter?lint=0004_no_primary_key) | INFO | 2 | ❌ não relacionado ao spec |
| Performance | [Auth DB Connection Strategy is not Percentage](https://supabase.com/docs/guides/deployment/going-into-prod) | INFO | 1 | ❌ não relacionado ao spec |

**Conclusão geral:** nenhum finding **ERROR**. Todos são WARN/INFO. A maioria dos WARN
de segurança (SECURITY DEFINER em massa, buckets públicos, leaked-password) está
**explicitamente fora de escopo** deste spec enxuto — eles permanecem rastreados no
spec arquivado `security-hardening-lgpd` (ver seção "Fora de escopo" do `requirements.md`).

## Foco da tarefa: findings que tocam `public.customers` RLS

### 1. `auth_rls_initplan` (WARN) — 9 políticas de `customers`

O advisor sinaliza que estas políticas reavaliam `auth.<function>()` por linha (em vez de
`(select auth.<function>())`):

- `Owner select customers`
- `Owner insert customers`
- **`Owner update customers`** ← política alvo do REQ 4
- `Owner delete customers`
- `Admins read all customers`
- `Leader reads team customers`
- `Assigned consultant select customers`
- `Assigned consultant update customers`
- `managers can read customers`

Remediação: [0003_auth_rls_initplan](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan)
(trocar `auth.uid()` por `(select auth.uid())`).

### 2. `multiple_permissive_policies` (WARN) — `customers`

Políticas permissivas múltiplas para o mesmo role/ação. As que mais importam ao spec:

- **UPDATE / `authenticated`**: `{Assigned consultant update customers, Owner update customers}`
- SELECT / `authenticated`: `{Admins read all customers, Assigned consultant select customers, Leader reads team customers, Owner select customers, managers can read customers}`
- SELECT / `anon` (e `authenticator`, `cli_login_postgres`, `dashboard_user`, `supabase_privileged_role`): `{Assigned consultant select customers, managers can read customers}`

Remediação: [0006_multiple_permissive_policies](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).

> Nota: a presença de **duas** políticas UPDATE permissivas em `customers`
> (`Owner update customers` + `Assigned consultant update customers`) é exatamente a
> causa do achado residual da GROUP B documentado em `req4-rls-validation.md` (checks
> `WITH CHECK` combinados por OR). Isso é uma observação de **correção multi-tenant**, não
> uma recomendação do advisor de performance — mas vale registrar a sobreposição.

### 3. `duplicate_index` (WARN) — `customers` e `bot_flows`

- `public.customers`: `{idx_customers_source_campaign, idx_customers_source_campaign_id}` (índices idênticos).
- `public.bot_flows`: `{bot_flows_unique_active_variant, uniq_bot_flows_active_per_consultant_variant}` (índices idênticos).

Remediação: [0009_duplicate_index](https://supabase.com/docs/guides/database/database-linter?lint=0009_duplicate_index).

> Nota de relevância ao spec: o design dos REQ 2/REQ 3 apoia-se na constraint
> `uniq_bot_flows_active_per_consultant_variant` (≤ 1 fluxo ativo por consultor+variante)
> para garantir a seleção determinística de fluxo. O advisor aponta que existe um índice
> **duplicado** equivalente (`bot_flows_unique_active_variant`); a garantia de unicidade
> **continua válida** (ambos cobrem a mesma chave), então não há impacto de correção para
> os REQ 2/3 — apenas o índice redundante poderia ser removido por higiene. **Não fazer
> isso neste spec** (fora do escopo cirúrgico); apenas registrado.

## Mapeamento ao REQ 4 (`WITH CHECK` em `Owner update customers`)

Esta é a parte central da tarefa 9.1. Três perguntas:

### (a) O REQ 4 resolve algum finding dos advisors?

**Não.** Os advisors **não possuem nenhum lint que detecte a ausência de `WITH CHECK`**
em políticas de UPDATE (a falha IDOR que o REQ 4 fecha). O REQ 4 corrige uma lacuna de
**isolamento multi-tenant / correção** que os advisors **não enxergam**. Logo:

- Antes da migração (baseline atual): o advisor **não acusa** o gap do `WITH CHECK`.
- Depois da migração: nenhum finding existente é "resolvido" pelos advisors, porque
  nenhum finding apontava esse gap em primeiro lugar.

> Em outras palavras: a ausência de findings de segurança sobre o `UPDATE` de `customers`
> **não** significa que o isolamento estava ok — significa apenas que esse tipo de falha
> está fora da cobertura dos linters do Supabase. O REQ 4 segue sendo necessário.

### (b) O REQ 4 introduz algum finding NOVO?

**Não introduz nenhum finding novo.** A política `Owner update customers` **já está**
listada nos dois lints de `customers` relevantes (`auth_rls_initplan` e
`multiple_permissive_policies`), porque ambos são chaveados por **(tabela, política)** —
não pela cláusula. A migração do REQ 4 faz `DROP`/`CREATE` da **mesma** política mantendo
o **mesmo** `USING (consultant_id = auth.uid())` e adicionando
`WITH CHECK (consultant_id = auth.uid())`:

- `auth_rls_initplan`: a política continua sendo a mesma já sinalizada. A nova cláusula
  `WITH CHECK` usa `auth.uid()` direto (não `(select auth.uid())`), então **mantém** —
  não cria — o mesmo padrão de finding já existente para essa política. Sem novo
  `cache_key`.
- `multiple_permissive_policies`: o REQ 4 **preserva** ambas as políticas UPDATE
  (`Owner update customers` e `Assigned consultant update customers`). A contagem de
  políticas permissivas **não muda** → mesmo finding, sem novo.

**Resultado esperado pós-aplicação:** o conjunto de findings dos advisors permanece
**idêntico** ao baseline. O REQ 4 é neutro do ponto de vista dos advisors.

### (c) Oportunidade opcional (sem scope creep)

Como a política `Owner update customers` **já** aparece no `auth_rls_initplan`, e o REQ 4
vai recriá-la de qualquer forma, **se o operador quiser** poderia, na mesma migração,
escrever as cláusulas como `(select auth.uid())` em vez de `auth.uid()` — fechando
incidentalmente o WARN de initplan para essa política. **Recomendação deste documento:
NÃO fazer agora.** Motivos:

- O design do REQ 4 é deliberadamente **cirúrgico** (só adicionar `WITH CHECK`), e
  mudar a forma do `USING` aumenta o raio de teste/validação.
- O `auth_rls_initplan` é um WARN de **performance em escala**, não um risco de correção;
  com 1 consultor em produção hoje, o ganho é nulo no curto prazo.
- A otimização de `(select auth.<fn>())` é melhor tratada como uma passada **abrangente**
  em todas as ~140 políticas (um trabalho próprio), não embutida no REQ 4.

Registrado como sugestão para um eventual spec de performance/hardening separado.

## Itens fora de escopo (confirmação)

Os WARN de segurança abaixo são reconhecidos e **permanecem fora deste spec**, conforme a
seção "Fora de escopo (explícito)" do `requirements.md` (rastreados em
`security-hardening-lgpd`):

- **Public Bucket Allows Listing** (5 buckets: `ai-agent-media`, `consultant-photos`,
  `IMAGE`, `video igreen`, `whatsapp-media`) →
  [0025](https://supabase.com/docs/guides/database/database-linter?lint=0025_public_bucket_allows_listing).
- **SECURITY DEFINER executável por `anon`/`authenticated`** (revogação em massa) →
  [0028](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
  / [0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- **Leaked Password Protection Disabled** →
  [password-security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

> Observação: várias funções deste spec aparecem na lista de SECURITY DEFINER
> (`seed_default_camila_flow`, `seed_camila_flow_on_consultant_insert`, `seed_flow_d`),
> mas o endurecimento de EXECUTE dessas funções pertence ao `security-hardening-lgpd`,
> não a este spec.

## Veredito da tarefa 9.1

- ✅ Advisors de **segurança** e **performance** executados read-only; findings capturados como baseline.
- ✅ Baseline confirma o estado **pré-REQ 4** (`Owner update customers` sem `WITH CHECK`; migração `20260601030000` não aplicada).
- ✅ Findings de `customers` RLS revisados: `auth_rls_initplan` (9 políticas, incl. `Owner update customers`), `multiple_permissive_policies` (UPDATE com 2 políticas) e `duplicate_index` (`customers`, `bot_flows`).
- ✅ Mapeamento ao REQ 4: a migração **não resolve** nenhum finding (os advisors não cobrem o gap de `WITH CHECK`) e **não introduz** nenhum finding novo (mesma política já listada; comportamento dos advisors permanece idêntico).
- ✅ Sem ações destrutivas; nenhuma migração aplicada; aprovação humana preservada (Req 6.1/6.3/6.4).

## Como reproduzir

Via Supabase MCP (read-only):

- `get_advisors` com `type=security`
- `get_advisors` com `type=performance`
- (verificação do baseline) `SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='customers';`
- (verificação de não-aplicação) `list_migrations` → confirmar ausência da versão `20260601030000`.
