#!/usr/bin/env bash
# Wrapper MCP GitHub — usa o token do `gh` CLI (sem gravar PAT no mcp.json).
set -euo pipefail

export PATH="${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

GH_BIN="$(command -v gh || true)"
NPX_BIN="$(command -v npx || true)"
NPX_BIN="${NPX_BIN:-/usr/bin/npx}"

if [[ -z "${GH_BIN}" ]]; then
  echo "gh CLI não encontrado. Instale: https://cli.github.com/" >&2
  exit 1
fi

if ! "${GH_BIN}" auth status >/dev/null 2>&1; then
  echo "gh não autenticado. Rode: gh auth login" >&2
  exit 1
fi

export GITHUB_PERSONAL_ACCESS_TOKEN
if "${GH_BIN}" auth token >/dev/null 2>&1; then
  GITHUB_PERSONAL_ACCESS_TOKEN="$("${GH_BIN}" auth token)"
else
  GITHUB_PERSONAL_ACCESS_TOKEN="$("${GH_BIN}" auth status --show-token 2>&1 | sed -n 's/.*Token: //p' | head -1)"
fi

if [[ -z "${GITHUB_PERSONAL_ACCESS_TOKEN}" ]]; then
  echo "Não foi possível obter token do gh. Rode: gh auth login" >&2
  exit 1
fi

exec "${NPX_BIN}" -y @modelcontextprotocol/server-github@latest
