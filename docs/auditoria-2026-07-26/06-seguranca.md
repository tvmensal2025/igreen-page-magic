# 06 — Segurança

Linter Supabase + inspeção schema/policies.

## Sumário do linter

**184 findings** (2026-07-26):

| Nível | Contagem | Categoria dominante |
|---|---:|---|
| ERROR | 2 | Security Definer View |
| WARN | ~180 | Function Search Path Mutable, DEFINER com EXECUTE p/ authenticated, Extension in Public, RLS Policy Always True, Leaked Password Protection |
| INFO | 7 | RLS Enabled No Policy |

## ERROR — 2 findings

**Views SECURITY DEFINER (0010):**
- `consultants_public`
- `platform_facebook_audience_status`

Ambas listadas como **exceções intencionais** em `.kiro/steering/EVIDENCIA-PROD.md`:
> ERROR 2 (só exceções intencionais): `consultants_public`, `platform_facebook_audience_status` (DEFINER / `security_invoker=false`)

**Baseline anterior** era ERROR 5; 3 delas remediadas com `security_invoker=true` (migration `20260724120000_views_security_invoker_safe.sql`): `v_boletos_carteira`, `cadence_metrics_daily`, `igreen_recon_queue_progress`.

**Recomendação P1:** documentar formalmente as 2 exceções restantes em `mem://security` (via `security--update_memory`) para o scanner não sinalizar como novo problema.

## WARN — categorias

Detalhe do linter (184 findings totais, ERROR 2, INFO 7 = WARN ~175):

### Function Search Path Mutable (~majority)
Funções PL/pgSQL sem `SET search_path`. Risco: schema hijack se atacante criar objetos em search_path do usuário.

**Ação P1:** varredura via script que aplique `SET search_path = public, pg_temp` em todas as `SECURITY DEFINER` do `public`.

### Signed-In Users Can Execute SECURITY DEFINER Function (0029)
Muitas dessas — funções DEFINER com `EXECUTE` para `authenticated`. Alto risco de escalação se a função não filtrar por `auth.uid()`.

**Total DEFINER em `public`:** 194 (leitura direta `pg_proc`).

**Ação P1 (não em massa):** usar `.kiro/steering/RPC-ANON-DEFINER-INVENTARIO.md` como base. Auditar caso a caso e revogar EXECUTE onde só backend chama.

### Extension in Public (0014)
2 extensões instaladas no schema `public`. Risco baixo; movê-las para `extensions` schema é boa prática.

### RLS Policy Always True (0024)
`USING (true)` ou `WITH CHECK (true)` em UPDATE/DELETE/INSERT. Auditoria anterior (`AUD-006`, `16-relatorio-final.md`) marcou como “USING(true) legítimas (catálogo, tour, service_role) — não mexer em massa”.

**Ação P2:** revisar caso a caso quando fizer mudança relacionada.

### Leaked Password Protection Disabled (WARN 184)
Supabase Auth pode validar senhas contra HaveIBeenPwned. Está **desabilitado**.

**Ação P1:** ativar em `Auth → Password Security` no dashboard.
Link: https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/auth/providers

## INFO — 7 findings

**RLS Enabled No Policy (0008)** — 7 tabelas têm RLS ligada mas nenhuma policy definida (bloqueia tudo por default). Provavelmente intencional para tabelas acessadas só por service_role.

**Ação P2:** validar que essas 7 tabelas realmente não precisam de acesso por role autenticado. Se sim, deixar como está.

## Estado da schema

```
Total policies (public):      437
Total tables (public):        217
Tables without RLS:            0    ← todas com RLS habilitada
SECURITY DEFINER functions:  194
```

## Secrets

- Nenhum secret encontrado hardcoded em código-fonte (grep amostrado em edges críticas).
- `verify_jwt = false` em 90 edges — todas devem validar auth em código:
  - `assertCronAuth` (cron endpoints)
  - `assertBotOutboundAllowed` (bot outbound)
  - Secret na URL (webhooks externos)
  - HMAC assinado (Stripe, Facebook)

**Ação P2:** script `scripts/audit-verify-jwt-false.mjs` que liste as 90 edges e valide que cada uma chama pelo menos um dos guards.

## RPCs anon com DEFINER

Já inventariado em `.kiro/steering/RPC-ANON-DEFINER-INVENTARIO.md`. Manter atualizado.

## PII em tabelas

Auditoria Onda 4 (2026-07-16) removeu PII de `sessionStorage` em `Admin.tsx` e `NetworkPanel.tsx`. `_deleted_customers_backup` existe com 4 colunas + 1 policy — backup histórico, sem PII sensível ativa.

**Ação P2:** confirmar TTL do `_deleted_customers_backup` (retention policy).

## Recomendações consolidadas

| ID | Ação | Prioridade |
|---|---|---|
| SEC-1 | Ativar Leaked Password Protection | P1 |
| SEC-2 | Documentar as 2 views DEFINER remanescentes em security memory | P1 |
| SEC-3 | Auditar 194 DEFINER fns; revogar EXECUTE onde só backend chama | P1 |
| SEC-4 | `SET search_path` em DEFINER que ainda não tem | P1 |
| SEC-5 | Mover 2 extensions para schema `extensions` | P2 |
| SEC-6 | Script `verify-jwt=false` audit | P2 |
| SEC-7 | Revisar 7 tabelas RLS-sem-policy | P2 |
| SEC-8 | Retention `_deleted_customers_backup` | P2 |
