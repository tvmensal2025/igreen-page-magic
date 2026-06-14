#!/usr/bin/env bash
# MCP Firecrawl — scraping/crawl de páginas web via API Firecrawl.
# Credenciais via .env.mcp.local (gitignored). Requer Node >= 22, então
# usamos o nvm para garantir a versão certa (a do sistema é v20).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/.env.mcp.local"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a && source "${ENV_FILE}" && set +a
fi

if [[ -z "${FIRECRAWL_API_KEY:-}" ]]; then
  echo "FIRECRAWL_API_KEY ausente em ${ENV_FILE}" >&2
  echo "Gere uma key em https://www.firecrawl.dev/app/api-keys (fc-...)" >&2
  exit 1
fi

# firecrawl-mcp exige Node >= 22; a versão do sistema é v20. Carrega o Node 22
# via nvm se disponível.
if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm use 22 >/dev/null 2>&1 || nvm use --lts >/dev/null 2>&1 || true
fi

export FIRECRAWL_API_KEY
exec npx -y firecrawl-mcp
