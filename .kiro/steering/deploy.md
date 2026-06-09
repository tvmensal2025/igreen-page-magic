---
inclusion: always
---

# Deploy (jeito certo, já testado)

Este documento registra COMO o deploy funciona neste projeto. Seguir este
caminho sempre — não ficar tentando outras formas que não funcionam.

## Edge Functions (Supabase)

O deploy NÃO é feito localmente pelo CLI do Supabase. Ele roda pelo
**GitHub Actions**, no workflow `.github/workflows/deploy-edge-functions.yml`.

- O CLI local do Supabase **não está logado** e não há `SUPABASE_ACCESS_TOKEN`
  no ambiente. Não adianta tentar `supabase functions deploy` direto.
- O workflow do GitHub usa o secret `SUPABASE_ACCESS_TOKEN` (já configurado no
  repositório) e faz checkout do código **do repositório remoto** (branch
  `main`). Por isso é preciso commitar e dar push ANTES de disparar o deploy.
- O `project-ref` do Supabase é `zlzasfhcxcznaprrragl`.

### Passo a passo

1. Commitar as mudanças e dar push para `origin main`
   (o time trabalha direto na `main`; se o remoto tiver commits novos, fazer
   `git rebase origin/main` para manter histórico linear).
2. Disparar o workflow de deploy.

### Detalhe importante sobre o `gh` CLI

O `gh` CLI está logado como `tvmensal2025`, MAS o token dele é fine-grained e
**não enxerga este repositório via API** (dá 404 em `gh api` e em
`gh workflow run`). Não insistir no `gh workflow run`.

O que FUNCIONA é disparar via API REST usando o token que o **git credential
helper** guarda (token `gho_...`, mais amplo, que o `git push` usa). Comando
testado e aprovado:

```bash
GHTOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill 2>/dev/null | grep -i '^password=' | sed 's/password=//')

# Dispara o deploy de TODAS as funções (recomendado quando _shared/ mudou):
curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Authorization: token $GHTOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/tvmensal2025/igreen-official-portal/actions/workflows/deploy-edge-functions.yml/dispatches \
  -d '{"ref":"main","inputs":{"function_name":"all"}}'
# 204 = aceito
```

Para deployar só uma função, troque `"all"` pelo slug (ex.: `"upload-media"`).

### Acompanhar o resultado

```bash
GHTOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill 2>/dev/null | grep -i '^password=' | sed 's/password=//')

# Pega o run mais recente de workflow_dispatch:
curl -s -H "Authorization: token $GHTOKEN" \
  "https://api.github.com/repos/tvmensal2025/igreen-official-portal/actions/runs?event=workflow_dispatch&per_page=3" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); [print(r['id'], r['name'], r['status'], r['conclusion']) for r in d['workflow_runs']]"

# Status de um run específico (troque o ID):
curl -s -H "Authorization: token $GHTOKEN" \
  "https://api.github.com/repos/tvmensal2025/igreen-official-portal/actions/runs/<RUN_ID>" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'], d['conclusion'])"
```

Depois, confirmar no Supabase (MCP `list_edge_functions`) que as funções têm
`updated_at` recente.

## Migrations de banco

As migrations de banco são aplicadas direto via MCP do Supabase
(`apply_migration`) — isso vale na hora, sem precisar de deploy. Não confundir
com edge functions.

## Front-end (build)

Validar sempre com `npx tsc --noEmit` e `npx vite build` (ambos exit 0) antes
de commitar.

## Segurança — NÃO commitar

- `.kiro/settings/mcp.json` contém token do GitHub em texto puro. **Nunca
  incluir esse arquivo no commit.** Ao preparar commits com `git add -A`,
  rodar `git reset .kiro/settings/mcp.json` antes de commitar. (Esse token
  ainda precisa ser revogado no GitHub.)
