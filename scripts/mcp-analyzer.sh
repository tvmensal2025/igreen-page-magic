#!/usr/bin/env bash
# MCP Analyzer (Ruff + Vulture) — análise estática de Python via uvx.
set -euo pipefail

export PATH="${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

UVX_BIN="$(command -v uvx || true)"
UVX_BIN="${UVX_BIN:-${HOME}/.local/bin/uvx}"

if [[ ! -x "${UVX_BIN}" ]]; then
  echo "uvx não encontrado. Instale uv: https://docs.astral.sh/uv/" >&2
  exit 1
fi

exec "${UVX_BIN}" mcp-server-analyzer
