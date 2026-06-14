#!/usr/bin/env bash
# Configura MCP servers do Cursor para este projeto.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Setup MCP — iGreen Official Portal    ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Scripts executáveis
chmod +x scripts/mcp-github.sh scripts/mcp-supabase.sh scripts/write-mcp-json.sh

# .cursor/mcp.json — caminhos ABSOLUTOS (Cursor Linux não expande ${workspaceFolder})
bash scripts/write-mcp-json.sh

# .env.local (frontend)
if [[ ! -f .env.local ]]; then
  cat > .env.local <<'EOF'
VITE_SUPABASE_URL=https://zlzasfhcxcznaprrragl.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo
EOF
  echo -e "${GREEN}✅ Criado .env.local (Supabase frontend)${NC}"
else
  echo -e "${YELLOW}⚠️  .env.local já existe (mantido)${NC}"
fi

# .env.mcp.local (fallback PAT — opcional)
if [[ ! -f .env.mcp.local ]]; then
  cp .env.mcp.local.example .env.mcp.local
  echo -e "${GREEN}✅ Criado .env.mcp.local (edite se OAuth falhar)${NC}"
else
  echo -e "${YELLOW}⚠️  .env.mcp.local já existe (mantido)${NC}"
fi

echo ""
echo -e "${BLUE}Verificando pré-requisitos...${NC}"

if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  echo -e "${GREEN}✅ GitHub CLI autenticado (MCP github pronto)${NC}"
else
  echo -e "${YELLOW}⚠️  GitHub MCP: rode 'gh auth login'${NC}"
fi

if command -v npx >/dev/null; then
  echo -e "${GREEN}✅ npx disponível (Playwright MCP)${NC}"
else
  echo -e "${YELLOW}⚠️  npx não encontrado${NC}"
fi

echo ""
echo -e "${BLUE}Próximos passos no Cursor:${NC}"
echo ""
echo "1. Recarregue a janela: Ctrl+Shift+P → 'Developer: Reload Window'"
echo "2. Abra Settings → Tools & MCP"
echo "3. Servidor 'supabase': clique **Needs authentication** / **Authorize**"
echo "   (login Supabase + org do project zlzasfhcxcznaprrragl)"
echo "4. Ative os toggles: supabase, github, playwright"
echo ""
echo -e "${YELLOW}Se ainda falhar:${NC} rode de novo \`bash scripts/write-mcp-json.sh\` e reload."
echo -e "${YELLOW}Linux/Cursor:${NC} não use \${workspaceFolder} — use caminhos absolutos."
echo ""
echo -e "${YELLOW}Teste rápido no chat:${NC}"
echo '  "Liste as tabelas do banco usando MCP Supabase"'
echo '  "Liste edge functions deployadas via MCP"'
echo ""
echo "Documentação completa: docs/MCP_SETUP.md"
echo ""
