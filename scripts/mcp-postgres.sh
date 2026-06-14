#!/usr/bin/env bash
# MCP Postgres (crystaldba/postgres-mcp) — diagnóstico de performance, índices,
# EXPLAIN, saúde de vacuum/locks. Roda em modo RESTRICTED (read-only) por padrão.
#
# Complementa o MCP Supabase: aqui o foco é "por que está lento?" e tuning,
# não escrita de dados. Credenciais via .env.mcp.local (gitignored).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/.env.mcp.local"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a && source "${ENV_FILE}" && set +a
fi

if [[ -z "${DATABASE_URI:-}" ]]; then
  echo "DATABASE_URI ausente em ${ENV_FILE}" >&2
  echo "Adicione a connection string do Postgres, ex.:" >&2
  echo '  DATABASE_URI=postgresql://postgres.<ref>:<senha>@aws-1-us-east-1.pooler.supabase.com:5432/postgres' >&2
  echo "(Database settings → Connection string → URI no painel Supabase)" >&2
  exit 1
fi

# restricted = transações read-only + limite de tempo. Seguro para produção.
# Troque para unrestricted só em dev se precisar de DDL/escrita.
ACCESS_MODE="${POSTGRES_MCP_ACCESS_MODE:-restricted}"

export DATABASE_URI
exec uvx postgres-mcp --access-mode="${ACCESS_MODE}"
