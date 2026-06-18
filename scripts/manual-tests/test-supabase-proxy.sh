#!/bin/bash

# Script para testar se a Edge Function está usando as novas configurações

echo "🔍 Testando Edge Function do Supabase..."
echo ""

# Você precisa pegar o token do localStorage após fazer login
echo "⚠️  IMPORTANTE: Você precisa de um token de acesso válido"
echo ""
echo "Como obter o token:"
echo "1. Abra o DevTools (F12) no navegador"
echo "2. Vá na aba Console"
echo "3. Digite: JSON.parse(localStorage.getItem('sb-zlzasfhcxcznaprrragl-auth-token')).access_token"
echo "4. Copie o token"
echo ""
read -p "Cole o token aqui: " TOKEN
echo ""

if [ -z "$TOKEN" ]; then
    echo "❌ Token não fornecido. Abortando."
    exit 1
fi

SUPABASE_URL="https://zlzasfhcxcznaprrragl.supabase.co"
PROXY_URL="${SUPABASE_URL}/functions/v1/evolution-proxy"

echo "📋 Testando: GET /instance/fetchInstances"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$PROXY_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "path": "instance/fetchInstances",
    "method": "GET"
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "Status HTTP: $HTTP_CODE"
echo "Resposta: $BODY"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Edge Function está respondendo!"
    echo ""
    
    # Verificar se há erro na resposta
    if echo "$BODY" | grep -q "Configuração do serviço de conexão incompleta"; then
        echo "❌ ERRO: Variáveis de ambiente NÃO configuradas no Supabase!"
        echo ""
        echo "Você precisa configurar:"
        echo "  EVOLUTION_API_URL=https://igreen-evolution-api.d9v63q.easypanel.host"
        echo "  EVOLUTION_API_KEY=429683C4C977415CAAFCCE10F7D57E11"
        echo ""
        echo "Link: https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/settings/functions"
    elif echo "$BODY" | grep -q "timeout"; then
        echo "⚠️  Timeout ao conectar ao servidor Evolution API"
        echo "Possíveis causas:"
        echo "  1. Servidor Evolution API está lento"
        echo "  2. URL incorreta nas variáveis de ambiente"
        echo "  3. Firewall bloqueando a conexão"
    elif echo "$BODY" | grep -q "error"; then
        echo "❌ Erro na resposta:"
        echo "$BODY" | grep -o '"error":"[^"]*"'
    else
        echo "✅ Tudo funcionando! Resposta válida recebida."
        echo ""
        echo "Instâncias encontradas:"
        echo "$BODY" | head -c 500
    fi
else
    echo "❌ Erro HTTP: $HTTP_CODE"
    echo "Resposta: $BODY"
fi

echo ""
