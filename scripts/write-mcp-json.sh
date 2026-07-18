#!/usr/bin/env bash
# Gera .cursor/mcp.json com caminhos ABSOLUTOS + PATH completo (Cursor Linux).
# Corrige MCPs "vermelhos" por discovery falhando (npx/bash sem PATH).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/.cursor/mcp.json"
ENV_FILE="${ROOT}/.env.mcp.local"
PROJECT_REF="zlzasfhcxcznaprrragl"
VELIP_URL="https://vox20.velip.com.br/mcpserver/velip"
HOME_DIR="${HOME:-/home/dev}"
NODE_BIN="/usr/bin"
# PATH mínimo + local (uvx, gh extras)
MCP_PATH="${HOME_DIR}/.local/bin:${NODE_BIN}:/bin:/usr/local/bin"

mkdir -p "${ROOT}/.cursor"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a && source "${ENV_FILE}" && set +a
fi

# Preservar token Velip do mcp.json atual se .env não tiver
if [[ -z "${VELIP_MCP_TOKEN:-}" && -f "${OUT}" ]]; then
  VELIP_MCP_TOKEN="$(python3 - "${OUT}" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    h = (d.get("mcpServers") or {}).get("velip", {}).get("headers") or {}
    auth = h.get("Authorization") or ""
    if auth.lower().startswith("bearer "):
        print(auth.split(" ", 1)[1].strip())
except Exception:
    pass
PY
)"
fi

# Preferir OAuth hosted no Cursor (URL) — menos vermelho que stdio+npx.
# PAT fica disponível no .env para CLI/supabase scripts.
python3 - "${OUT}" "${ROOT}" "${PROJECT_REF}" "${MCP_PATH}" "${HOME_DIR}" "${VELIP_URL}" "${VELIP_MCP_TOKEN:-}" "${DATABASE_URI:-}" "${FIRECRAWL_API_KEY:-}" <<'PY'
import json, sys
out, root, project_ref, mcp_path, home, velip_url, velip_token, database_uri, firecrawl = sys.argv[1:10]

env_base = {
    "PATH": mcp_path,
    "HOME": home,
}

servers = {}

# 1) Supabase — OAuth hosted (Authorize no Cursor)
servers["supabase"] = {
    "url": f"https://mcp.supabase.com/mcp?project_ref={project_ref}"
}

# 2) GitHub — wrapper com PATH
servers["github"] = {
    "command": "/usr/bin/bash",
    "args": [f"{root}/scripts/mcp-github.sh"],
    "env": env_base,
}

# 3) Playwright
servers["playwright"] = {
    "command": "/usr/bin/npx",
    "args": ["-y", "@playwright/mcp@latest", "--headless"],
    "env": env_base,
}

# 4) Context7
servers["context7"] = {
    "command": "/usr/bin/npx",
    "args": ["-y", "@upstash/context7-mcp"],
    "env": env_base,
}

# 5) Analyzer (uvx) — já estava verde
servers["analyzer"] = {
    "command": "/usr/bin/bash",
    "args": [f"{root}/scripts/mcp-analyzer.sh"],
    "env": env_base,
}

# 6) Sequential thinking
servers["sequential-thinking"] = {
    "command": "/usr/bin/npx",
    "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    "env": env_base,
}

# 7) Postgres opcional
if database_uri and "<" not in database_uri and "SENHA" not in database_uri:
    servers["postgres"] = {
        "command": "/usr/bin/bash",
        "args": [f"{root}/scripts/mcp-postgres.sh"],
        "env": env_base,
    }

# 8) Firecrawl opcional
if firecrawl.startswith("fc-"):
    servers["firecrawl"] = {
        "command": "/usr/bin/bash",
        "args": [f"{root}/scripts/mcp-firecrawl.sh"],
        "env": env_base,
    }

# 9) Velip
if velip_token and "SEU_TOKEN" not in velip_token:
    servers["velip"] = {
        "url": velip_url,
        "headers": {"Authorization": f"Bearer {velip_token}"},
    }

# 10) Fallback Supabase PAT (stdio) — só se quiser forçar; mantemos também como supabase-pat
# Não adicionamos por padrão para evitar conflito com OAuth.

payload = {"mcpServers": servers}
open(out, "w").write(json.dumps(payload, indent=2) + "\n")
print("servers=", list(servers))
PY

# Espelha no Kiro
KIRO_OUT="${ROOT}/.kiro/settings/mcp.json"
if [[ -d "${ROOT}/.kiro/settings" ]]; then
  cp "${OUT}" "${KIRO_OUT}"
  echo "✅ Espelhado ${KIRO_OUT}"
fi

echo "✅ Gerado ${OUT}"
echo "   supabase → OAuth hosted (Authorize em Settings → Tools & MCP)"
echo "   demais → /usr/bin/npx|/usr/bin/bash + PATH completo"
echo ""
echo "Próximo passo: Ctrl+Shift+P → Developer: Reload Window"
echo "Depois em Tools & MCP → supabase → Authorize"
