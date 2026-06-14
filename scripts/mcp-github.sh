#!/usr/bin/env bash
# Wrapper MCP GitHub — usa o token do `gh` CLI (sem gravar PAT no mcp.json).
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI não encontrado. Instale: https://cli.github.com/" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "gh não autenticado. Rode: gh auth login" >&2
  exit 1
fi

export GITHUB_PERSONAL_ACCESS_TOKEN
if gh auth token >/dev/null 2>&1; then
  GITHUB_PERSONAL_ACCESS_TOKEN="$(gh auth token)"
else
  # gh < 2.7 não tem `auth token`; usa --show-token (gh 2.4+).
  GITHUB_PERSONAL_ACCESS_TOKEN="$(gh auth status --show-token 2>&1 | sed -n 's/.*Token: //p' | head -1)"
fi

if [[ -z "${GITHUB_PERSONAL_ACCESS_TOKEN}" ]]; then
  echo "Não foi possível obter token do gh. Rode: gh auth login" >&2
  exit 1
fi

exec npx -y @modelcontextprotocol/server-github@latest
