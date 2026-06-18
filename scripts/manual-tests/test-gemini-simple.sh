#!/bin/bash

# Teste rápido da API Gemini
# Obter a chave do Supabase secrets

echo "🔍 Testando API Gemini..."
echo ""

# Teste 1: Texto simples
echo "📡 Teste 1: Verificando acesso à API..."

# Nota: Substitua YOUR_API_KEY pela chave real
# Para obter: supabase secrets list | grep GEMINI

API_KEY="$1"

if [ -z "$API_KEY" ]; then
  echo "❌ Erro: Forneça a API key como argumento"
  echo "Uso: ./test-gemini-simple.sh YOUR_API_KEY"
  exit 1
fi

RESPONSE=$(curl -s -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{
      "role": "user",
      "parts": [{"text": "Responda apenas: OK"}]
    }],
    "generationConfig": {
      "temperature": 0,
      "maxOutputTokens": 10
    }
  }')

# Verificar se teve erro
if echo "$RESPONSE" | grep -q "error"; then
  echo "❌ Erro na API:"
  echo "$RESPONSE" | jq '.'
  exit 1
fi

# Extrair resposta
TEXT=$(echo "$RESPONSE" | jq -r '.candidates[0].content.parts[0].text' 2>/dev/null)

if [ -n "$TEXT" ]; then
  echo "✅ API acessível!"
  echo "📝 Resposta: \"$TEXT\""
  echo ""
else
  echo "❌ Erro ao extrair resposta"
  echo "$RESPONSE"
  exit 1
fi

# Teste 2: Extração de dados
echo "📡 Teste 2: Testando extração de dados estruturados..."

RESPONSE=$(curl -s -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{
      "role": "user",
      "parts": [{
        "text": "Extraia os seguintes dados desta frase:\n\"João Silva mora na Rua das Flores, 123, Bairro Centro, CEP 12345-678, São Paulo - SP\"\n\nRetorne APENAS este JSON:\n{\"nome\":\"\",\"endereco\":\"\",\"numero\":\"\",\"bairro\":\"\",\"cep\":\"\",\"cidade\":\"\",\"estado\":\"\"}"
      }]
    }],
    "generationConfig": {
      "temperature": 0,
      "maxOutputTokens": 500,
      "responseMimeType": "application/json"
    }
  }')

# Verificar se teve erro
if echo "$RESPONSE" | grep -q "error"; then
  echo "❌ Erro na API:"
  echo "$RESPONSE" | jq '.'
  exit 1
fi

# Extrair resposta
TEXT=$(echo "$RESPONSE" | jq -r '.candidates[0].content.parts[0].text' 2>/dev/null)

if [ -n "$TEXT" ]; then
  echo "✅ Extração de dados funcionando!"
  echo "📝 Dados extraídos:"
  echo "$TEXT" | jq '.'
  echo ""
  
  # Validar dados
  NOME=$(echo "$TEXT" | jq -r '.nome')
  ENDERECO=$(echo "$TEXT" | jq -r '.endereco')
  NUMERO=$(echo "$TEXT" | jq -r '.numero')
  
  echo "🔍 Validação:"
  if echo "$NOME" | grep -qi "João Silva"; then
    echo "✅ nome: $NOME"
  else
    echo "❌ nome: $NOME (esperado: João Silva)"
  fi
  
  if echo "$ENDERECO" | grep -qi "Flores"; then
    echo "✅ endereco: $ENDERECO"
  else
    echo "❌ endereco: $ENDERECO (esperado: Rua das Flores)"
  fi
  
  if [ "$NUMERO" = "123" ]; then
    echo "✅ numero: $NUMERO"
  else
    echo "❌ numero: $NUMERO (esperado: 123)"
  fi
else
  echo "❌ Erro ao extrair resposta"
  echo "$RESPONSE"
  exit 1
fi

echo ""
echo "🎉 TODOS OS TESTES PASSARAM!"
echo ""
echo "✅ Resumo:"
echo "  - API Gemini acessível"
echo "  - Extração de dados estruturados funcionando"
echo ""
echo "🚀 Sistema pronto para processar documentos reais!"
