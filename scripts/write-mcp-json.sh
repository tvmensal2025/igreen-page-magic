#!/usr/bin/env bash
# Gera .cursor/mcp.json com caminhos ABSOLUTOS (Cursor Linux nem sempre expande ${workspaceFolder}).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/.cursor/mcp.json"
ENV_FILE="${ROOT}/.env.mcp.local"
PROJECT_REF="zlzasfhcxcznaprrragl"

mkdir -p "${ROOT}/.cursor"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a && source "${ENV_FILE}" && set +a
fi

BLOCKS=()

BLOCKS+=("    \"supabase\": {
      \"url\": \"https://mcp.supabase.com/mcp?project_ref=${PROJECT_REF}\"
    }")

BLOCKS+=("    \"github\": {
      \"command\": \"bash\",
      \"args\": [\"${ROOT}/scripts/mcp-github.sh\"]
    }")

BLOCKS+=("    \"playwright\": {
      \"command\": \"npx\",
      \"args\": [\"-y\", \"@playwright/mcp@latest\", \"--headless\"]
    }")

BLOCKS+=("    \"context7\": {
      \"command\": \"npx\",
      \"args\": [\"-y\", \"@upstash/context7-mcp\"]
    }")

if [[ -n "${DATABASE_URI:-}" && "${DATABASE_URI}" != *"<"* && "${DATABASE_URI}" != *"SENHA"* ]]; then
  BLOCKS+=("    \"postgres\": {
      \"command\": \"bash\",
      \"args\": [\"${ROOT}/scripts/mcp-postgres.sh\"]
    }")
  POSTGRES_OK=1
else
  POSTGRES_OK=0
fi

BLOCKS+=("    \"analyzer\": {
      \"command\": \"bash\",
      \"args\": [\"${ROOT}/scripts/mcp-analyzer.sh\"]
    }")

BLOCKS+=("    \"sequential-thinking\": {
      \"command\": \"npx\",
      \"args\": [\"-y\", \"@modelcontextprotocol/server-sequential-thinking\"]
    }")

if [[ -n "${FIRECRAWL_API_KEY:-}" && "${FIRECRAWL_API_KEY}" != *"<"* && "${FIRECRAWL_API_KEY}" == fc-* ]]; then
  BLOCKS+=("    \"firecrawl\": {
      \"command\": \"bash\",
      \"args\": [\"${ROOT}/scripts/mcp-firecrawl.sh\"]
    }")
  FIRECRAWL_OK=1
else
  FIRECRAWL_OK=0
fi

{
  echo "{"
  echo "  \"mcpServers\": {"
  last=$(( ${#BLOCKS[@]} - 1 ))
  for i in "${!BLOCKS[@]}"; do
    if [[ $i -lt $last ]]; then
      echo "${BLOCKS[$i]},"
    else
      echo "${BLOCKS[$i]}"
    fi
  done
  echo "  }"
  echo "}"
} > "${OUT}"

echo "✅ Gerado ${OUT}"
echo "   supabase → OAuth hosted (Authorize em Settings → Tools & MCP)"
echo "   github   → ${ROOT}/scripts/mcp-github.sh"
echo "   playwright → npx @playwright/mcp"
echo "   context7 → npx @upstash/context7-mcp"
if [[ "${POSTGRES_OK}" -eq 1 ]]; then
  echo "   postgres → ${ROOT}/scripts/mcp-postgres.sh"
else
  echo "   postgres → omitido (preencha DATABASE_URI em .env.mcp.local)"
fi
echo "   analyzer → ${ROOT}/scripts/mcp-analyzer.sh"
echo "   sequential-thinking → npx @modelcontextprotocol/server-sequential-thinking"
if [[ "${FIRECRAWL_OK}" -eq 1 ]]; then
  echo "   firecrawl → ${ROOT}/scripts/mcp-firecrawl.sh"
else
  echo "   firecrawl → omitido (preencha FIRECRAWL_API_KEY fc-... em .env.mcp.local)"
fi
