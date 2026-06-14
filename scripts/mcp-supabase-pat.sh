#!/usr/bin/env bash
# Fallback MCP Supabase via PAT (quando OAuth do hosted MCP falhar).
# Token: https://supabase.com/dashboard/account/tokens
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/.env.mcp.local"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a && source "${ENV_FILE}" && set +a
fi

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "SUPABASE_ACCESS_TOKEN ausente." >&2
  echo "Crie ${ENV_FILE} com:" >&2
  echo '  SUPABASE_ACCESS_TOKEN=sbp_...' >&2
  echo "Ou use o MCP hosted (OAuth) em .cursor/mcp.json — recomendado." >&2
  exit 1
fi

PROJECT_REF="${SUPABASE_PROJECT_REF:-zlzasfhcxcznaprrragl}"
READ_ONLY="${SUPABASE_MCP_READ_ONLY:-false}"

ARGS=(-y "@supabase/mcp-server-supabase@latest" "--project-ref=${PROJECT_REF}")
if [[ "${READ_ONLY}" == "true" ]]; then
  ARGS+=("--read-only")
fi

exec npx "${ARGS[@]}"
