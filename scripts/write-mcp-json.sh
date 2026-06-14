#!/usr/bin/env bash
# Gera .cursor/mcp.json com caminhos ABSOLUTOS (Cursor Linux nem sempre expande ${workspaceFolder}).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/.cursor/mcp.json"

mkdir -p "${ROOT}/.cursor"

ENV_FILE="${ROOT}/.env.mcp.local"
SUPABASE_BLOCK=""
if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a && source "${ENV_FILE}" && set +a
  if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" && "${SUPABASE_ACCESS_TOKEN}" == sbp_* ]]; then
    SUPABASE_BLOCK=$(cat <<SUPABASE_EOF
    "supabase": {
      "command": "${ROOT}/scripts/mcp-supabase.sh"
    },
SUPABASE_EOF
)
  fi
fi
if [[ -z "${SUPABASE_BLOCK}" ]]; then
  SUPABASE_BLOCK=$(cat <<SUPABASE_EOF
    "supabase": {
      "url": "https://mcp.supabase.com/mcp?project_ref=zlzasfhcxcznaprrragl"
    },
SUPABASE_EOF
)
fi

cat > "${OUT}" <<EOF
{
  "mcpServers": {
${SUPABASE_BLOCK}
    "github": {
      "command": "${ROOT}/scripts/mcp-github.sh"
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest", "--headless"]
    },
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    },
    "postgres": {
      "command": "${ROOT}/scripts/mcp-postgres.sh"
    },
    "analyzer": {
      "command": "${ROOT}/scripts/mcp-analyzer.sh"
    }
  }
}
EOF

echo "✅ Gerado ${OUT}"
if [[ -f "${ENV_FILE}" ]] && [[ -n "${SUPABASE_ACCESS_TOKEN:-}" && "${SUPABASE_ACCESS_TOKEN}" == sbp_* ]]; then
  echo "   supabase → ${ROOT}/scripts/mcp-supabase.sh (PAT em .env.mcp.local)"
else
  echo "   supabase → OAuth hosted (clique Authorize em Settings → Tools & MCP)"
fi
echo "   github   → ${ROOT}/scripts/mcp-github.sh"
echo "   playwright → npx @playwright/mcp"
echo "   context7 → npx @upstash/context7-mcp"
echo "   postgres → ${ROOT}/scripts/mcp-postgres.sh (DATABASE_URI em .env.mcp.local)"
echo "   analyzer → ${ROOT}/scripts/mcp-analyzer.sh (uvx mcp-server-analyzer)"
