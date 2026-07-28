---
inclusion: auto
name: deploy
description: Como fazer deploy de edge functions via GitHub Actions neste repo.
---

# Deploy (jeito certo, já testado)

Este documento registra COMO o deploy funciona neste projeto. Seguir este
caminho sempre — não ficar tentando outras formas que não funcionam.

## Edge Functions (Supabase)

O deploy NÃO é feito localmente pelo CLI do Supabase. Ele roda pelo
**GitHub Actions**, no workflow `.github/workflows/deploy-edge-functions.yml`.

- O CLI local do Supabase **não está logado** e não há `SUPABASE_ACCESS_TOKEN`
  no ambiente. Não adiantar `supabase functions deploy` direto.
- O workflow usa o secret `SUPABASE_ACCESS_TOKEN` e faz checkout do código
  **do repositório remoto** (branch `main`). Commit + push ANTES do dispatch.
- `project-ref`: `zlzasfhcxcznaprrragl`.
- **Repo:** `tvmensal2025/igreen-page-magic` (não usar o antigo
  `igreen-official-portal` parado).

### Gates do workflow (2026-07 — endurecido)

`workflow_dispatch` **exige todos**:

| Input | Regra |
|---|---|
| `expected_sha` | SHA completo **40 hex** = `GITHUB_SHA` do dispatch |
| `function_names` | Slugs separados por vírgula **ou** `all` |
| `confirm_production` | deve ser `true` |
| `confirm_all` | se `function_names=all`, digite exatamente `DEPLOY_ALL` |

Também: só `refs/heads/main`, CI verde no mesmo SHA, `environment: production`,
allowlist de slugs no workflow.

**Docs antigos com `inputs.function_name` (singular) ou curl sem
`expected_sha` / `confirm_production` estão OBSOLETOS — vão falhar.**

> Validação `all`: só o token exato `all` (ou `,all,` na lista). Slugs como
> `manual-step-send` são válidos — não usar match `*all*`.

### Passo a passo

1. Commit + push em `origin main` (rebase se o remoto avançou).
2. Pegue o SHA: `git rev-parse HEAD` (40 chars).
3. Dispare o workflow com os inputs acima.

### Disparo via API (token git credential)

```bash
SHA=$(git rev-parse HEAD)
GHTOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill 2>/dev/null | grep -i '^password=' | sed 's/password=//')

# Ex.: só as edges do hardening satélite:
curl -sS -o /tmp/dispatch.json -w "%{http_code}\n" -X POST \
  -H "Authorization: token $GHTOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/tvmensal2025/igreen-page-magic/actions/workflows/deploy-edge-functions.yml/dispatches \
  -d "{\"ref\":\"main\",\"inputs\":{\"expected_sha\":\"$SHA\",\"function_names\":\"lead-research-sweep-cron,inbound-media-retry-cron,production-health-snapshot,speed-to-lead-check,portal-offline-retry,flow-d-stuck-watchdog,flow-engine-v3-rollout-cron,recover-stuck-otp\",\"confirm_production\":\"true\",\"confirm_all\":\"\"}}"
# 204 = aceito

# Deploy de TODAS (cuidado):
# confirm_all deve ser exatamente DEPLOY_ALL
curl -sS -o /tmp/dispatch.json -w "%{http_code}\n" -X POST \
  -H "Authorization: token $GHTOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/tvmensal2025/igreen-page-magic/actions/workflows/deploy-edge-functions.yml/dispatches \
  -d "{\"ref\":\"main\",\"inputs\":{\"expected_sha\":\"$SHA\",\"function_names\":\"all\",\"confirm_production\":\"true\",\"confirm_all\":\"DEPLOY_ALL\"}}"
```

O `gh workflow run` pode falhar (token fine-grained sem escopo no repo). Preferir
o curl acima com o token do credential helper.

### Acompanhar

```bash
GHTOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill 2>/dev/null | grep -i '^password=' | sed 's/password=//')

curl -s -H "Authorization: token $GHTOKEN" \
  "https://api.github.com/repos/tvmensal2025/igreen-page-magic/actions/runs?event=workflow_dispatch&per_page=3" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); [print(r['id'], r['name'], r['status'], r['conclusion']) for r in d['workflow_runs']]"
```

Confirmar no Supabase MCP `list_edge_functions` o `updated_at` recente.

### Smoke pós-deploy (crons com assertCronAuth)

Com `ENFORCE_CRON_AUTH=true`:

1. Sem secret → **401**
2. Com `x-service-secret` / `x-internal-secret` (de `settings`) → **200**

Não testar em massa endpoints que enviam WA/SMS.

## Migrations de banco

Aplicar via MCP Supabase (`apply_migration` / `execute_sql` para `cron.alter_job`).
Vale na hora — **não** precisa de deploy de edge. Não confundir com functions.

Ordem segura quando endurecer cron:

1. Migration/SQL dos **headers** no `cron.job`
2. Deploy das edges com `assertCronAuth`
3. Smoke 401/200

## Front-end (build)

`npx tsc --noEmit` e `npx vite build` (exit 0) antes de commitar mudanças de UI.

## Segurança — NÃO commitar

- `.kiro/settings/mcp.json` e `.env.mcp.local` — secrets. Nunca no commit.
- Ao `git add -A`, rodar `git reset` nesses arquivos antes do commit.
