#!/usr/bin/env bash
# MCP TestSprite — análise e testes automatizados via TestSprite cloud.
# Requer Node >= 22. Credenciais via .env.mcp.local (gitignored).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/.env.mcp.local"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a && source "${ENV_FILE}" && set +a
fi

# Aceita TESTSPRITE_API_KEY ou API_KEY (nome que o pacote espera)
API_KEY_VALUE="${TESTSPRITE_API_KEY:-${API_KEY:-}}"

if [[ -z "${API_KEY_VALUE}" || "${API_KEY_VALUE}" == *"<"* || "${API_KEY_VALUE}" == *"your-api-key"* ]]; then
  echo "TESTSPRITE_API_KEY ausente ou placeholder em ${ENV_FILE}" >&2
  echo "Gere uma key em https://www.testsprite.com/dashboard/settings/apikey" >&2
  exit 1
fi

# TestSprite exige Node >= 22; Cursor usa o Node do sistema (v20) por padrão.
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

export API_KEY="${API_KEY_VALUE}"
# Sem subcomando: sobe MCP via stdio (o subcomando "server" sobe HTTP e quebra o Cursor)
exec "${NODE22_NPX}" -y "@testsprite/testsprite-mcp@latest"
