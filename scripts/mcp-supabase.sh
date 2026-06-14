#!/usr/bin/env bash
# MCP Supabase — carrega credenciais de .env.mcp.local (gitignored).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/.env.mcp.local"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a && source "${ENV_FILE}" && set +a
fi

PROJECT_REF="${SUPABASE_PROJECT_REF:-zlzasfhcxcznaprrragl}"
READ_ONLY="${SUPABASE_MCP_READ_ONLY:-false}"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "SUPABASE_ACCESS_TOKEN ausente em ${ENV_FILE}" >&2
  echo "Gere um PAT (sbp_...): https://supabase.com/dashboard/account/tokens" >&2
  exit 1
fi

# service_role (JWT eyJ...) NÃO funciona no MCP oficial — só PAT (sbp_...).
if [[ "${SUPABASE_ACCESS_TOKEN}" == eyJ* ]]; then
  echo "ERRO: SUPABASE_ACCESS_TOKEN parece ser service_role (JWT eyJ...)." >&2
  echo "O MCP Supabase exige PAT (sbp_...) da conta, não a chave do projeto." >&2
  echo "Gere em: https://supabase.com/dashboard/account/tokens" >&2
  exit 1
fi

ARGS=(-y "@supabase/mcp-server-supabase@latest" "--project-ref=${PROJECT_REF}")
if [[ "${READ_ONLY}" == "true" ]]; then
  ARGS+=("--read-only")
fi

export SUPABASE_ACCESS_TOKEN
exec npx "${ARGS[@]}"
