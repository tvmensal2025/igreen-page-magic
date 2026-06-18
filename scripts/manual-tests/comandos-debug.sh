#!/bin/bash

# Comandos úteis para debug da migração Evolution API

echo "🔍 Comandos de Debug - Evolution API"
echo "======================================"
echo ""

# Cores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

EVOLUTION_URL="https://igreen-evolution-api.d9v63q.easypanel.host"
API_KEY="429683C4C977415CAAFCCE10F7D57E11"

echo -e "${YELLOW}1. Testar conexão com o servidor Evolution API${NC}"
echo "curl -X GET \"${EVOLUTION_URL}/instance/fetchInstances\" -H \"apikey: ${API_KEY}\""
echo ""

echo -e "${YELLOW}2. Criar uma instância de teste${NC}"
echo "curl -X POST \"${EVOLUTION_URL}/instance/create\" \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -H \"apikey: ${API_KEY}\" \\"
echo "  -d '{\"instanceName\":\"teste-$(date +%s)\",\"qrcode\":true,\"integration\":\"WHATSAPP-BAILEYS\"}'"
echo ""

echo -e "${YELLOW}3. Verificar estado de uma instância${NC}"
echo "curl -X GET \"${EVOLUTION_URL}/instance/connectionState/NOME_DA_INSTANCIA\" -H \"apikey: ${API_KEY}\""
echo ""

echo -e "${YELLOW}4. Deletar uma instância${NC}"
echo "curl -X DELETE \"${EVOLUTION_URL}/instance/delete/NOME_DA_INSTANCIA\" -H \"apikey: ${API_KEY}\""
echo ""

echo -e "${YELLOW}5. Testar com verbose (ver detalhes da conexão)${NC}"
echo "curl -v \"${EVOLUTION_URL}/instance/fetchInstances\" -H \"apikey: ${API_KEY}\""
echo ""

echo -e "${GREEN}✅ Servidor testado e funcionando!${NC}"
echo ""
echo "📝 Próximo passo: Configure as variáveis no Supabase"
echo "   EVOLUTION_API_URL=${EVOLUTION_URL}"
echo "   EVOLUTION_API_KEY=${API_KEY}"
echo ""
echo "🔗 Link: https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/settings/functions"
