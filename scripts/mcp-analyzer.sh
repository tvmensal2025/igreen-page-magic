#!/usr/bin/env bash
# MCP Analyzer (Ruff + Vulture) — análise estática de Python via uvx.
# Pacote: mcp-server-analyzer (https://github.com/Anselmoo/mcp-server-analyzer)
set -euo pipefail

if ! command -v uvx >/dev/null 2>&1; then
  echo "uvx não encontrado. Instale uv: https://docs.astral.sh/uv/" >&2
  exit 1
fi

exec uvx mcp-server-analyzer
