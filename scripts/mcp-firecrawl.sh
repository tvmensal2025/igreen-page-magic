#!/usr/bin/env bash
# MCP Firecrawl — scraping/crawl de páginas web via API Firecrawl.
# Requer Node >= 22. Credenciais via .env.mcp.local (gitignored).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/.env.mcp.local"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a && source "${ENV_FILE}" && set +a
fi

if [[ -z "${FIRECRAWL_API_KEY:-}" || "${FIRECRAWL_API_KEY}" == *"<"* ]]; then
  echo "FIRECRAWL_API_KEY ausente ou placeholder em ${ENV_FILE}" >&2
  echo "Gere uma key em https://www.firecrawl.dev/app/api-keys (fc-...)" >&2
  exit 1
fi

# firecrawl-mcp exige Node >= 22; Cursor usa o Node do sistema (v20) por padrão.
NODE22_NPX="${HOME}/.nvm/versions/node/v22.22.3/bin/npx"
if [[ ! -x "${NODE22_NPX}" ]]; then
  if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    nvm use 22 >/dev/null 2>&1 || nvm use --lts >/dev/null 2>&1 || true
    NODE22_NPX="$(command -v npx)"
  else
    NODE22_NPX="$(command -v npx)"
  fi
fi

export FIRECRAWL_API_KEY
exec "${NODE22_NPX}" -y firecrawl-mcp
