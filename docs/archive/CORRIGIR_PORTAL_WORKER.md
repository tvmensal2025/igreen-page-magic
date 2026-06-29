> ⚠️ **Histórico (até 28/06/2026).** Repo migrado para `tvmensal2025/igreen-page-magic`. Workers ativos aqui: `worker-portal-2`, `worker-igreen-sync`, `compress-worker`. Portal 1 (`worker-portal`) permanece em `tvmensal2025/viana-replica-vault`.

# 🔧 CORRIGIR PORTAL WORKER - GUIA COMPLETO

> **Solução definitiva para o portal worker funcionar 100%**
> 
> **Data:** 14 de abril de 2026  
> **Status:** 🔴 PROBLEMA IDENTIFICADO

---

## 🎯 PROBLEMA IDENTIFICADO

**Sintoma:** Portal worker VPS não está funcionando

**Causa provável:**
1. ❌ Worker VPS precisa rodar com `xvfb-run` ou `headless: true`
2. ❌ Configuração do Easypanel incorreta
3. ❌ URL do worker não está acessível
4. ❌ Secrets não configurados corretamente

---

## 📋 SOLUÇÃO COMPLETA

### **PASSO 1: Verificar Repositório do Portal Worker**

O portal worker está em um repositório separado:

**Repositório:** `tvmensal2025/whapi-connect-joy`  
**Pasta:** `/worker-portal`  
**Branch:** `main`  
**Caminho de Build:** `/worker-portal`

---

### **PASSO 2: Corrigir Configuração do Easypanel**

#### **2.1 Acessar Easypanel**

1. Ir para: https://easypanel.io
2. Login com suas credenciais
3. Selecionar projeto: `igreen`
4. Selecionar serviço: `portal-worker`

---

#### **2.2 Configurar GitHub**

**Aba: Source → Github**

```
Proprietário: tvmensal2025
Repositório: whapi-connect-joy
Ramo: main
Caminho de Build: /worker-portal
```

**✅ Salvar**

---

#### **2.3 Configurar Dockerfile**

**Aba: Source → Dockerfile**

O Dockerfile DEVE ter esta configuração:

```dockerfile
FROM node:20-slim

# Instalar dependências do Chromium + xvfb
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
    xvfb \
    fonts-liberation \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar package.json
COPY package*.json ./

# Instalar dependências
RUN npm ci --only=production

# Copiar código
COPY . .

# Expor porta
EXPOSE 3100

# Variáveis de ambiente padrão
ENV HEADLESS=1
ENV PORT=3100
ENV NODE_ENV=production

# Comando de inicialização com xvfb-run
CMD ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1280x900x24", "node", "server.mjs"]
```

**✅ Salvar**

---

#### **2.4 Configurar Variáveis de Ambiente**

**Aba: Environment**

Adicionar estas variáveis:

```bash
# Servidor
PORT=3100
NODE_ENV=production
HEADLESS=1

# Supabase (OBRIGATÓRIO)
SUPABASE_URL=https://zlzasfhcxcznaprrragl.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcxMTQ3MzYwMCwiZXhwIjoyMDI3MDQ5NjAwfQ.xxx

# Worker
WORKER_SECRET=igreen-worker-secret-2024

# iGreen
IGREEN_CONSULTOR_ID=124170

# Whapi (para enviar link)
WHAPI_TOKEN=seu-token-whapi
WHAPI_API_URL=https://gate.whapi.cloud

# Chromium
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

**✅ Salvar**

---

#### **2.5 Configurar Domínio**

**Aba: Domains**

Adicionar domínio:

```
Tipo: Subdomain
Subdomain: portal-worker
Domain: d9v83a.easypanel.host
```

**URL final:** `https://portal-worker.d9v83a.easypanel.host`

**✅ Salvar**

---

#### **2.6 Implantar (Deploy)**

1. Clicar em **"Implantar"** (botão verde no topo)
2. Aguardar build completar (~5 minutos)
3. Verificar logs em tempo real

**Logs esperados:**
```
🚀 Worker Portal iniciado na porta 3100
✅ Supabase configurado
🔄 Polling de leads pendentes ativado (5s)
📊 Dashboard disponível em /dashboard
```

---

### **PASSO 3: Verificar se Worker Está Online**

#### **3.1 Health Check**

```bash
curl https://portal-worker.d9v83a.easypanel.host/health
```

**Resposta esperada:**
```json
{
  "status": "ok",
  "service": "worker-portal",
  "version": "5.1.0",
  "supabaseConfigured": true,
  "queue": {
    "processed": 0,
    "failed": 0,
    "processing": 0,
    "waiting": 0
  }
}
```

---

#### **3.2 Dashboard Visual**

Abrir no navegador:
```
https://portal-worker.d9v83a.easypanel.host/dashboard
```

**Deve mostrar:**
- Status do serviço
- Fila de processamento
- Últimas atividades

---

### **PASSO 4: Configurar URL no Supabase**

#### **4.1 Atualizar Settings no Banco**

Ir para: https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/editor

**SQL Editor → New Query:**

```sql
-- Remover configurações antigas
DELETE FROM settings 
WHERE key IN ('portal_worker_url', 'worker_secret', 'portal_worker_secret');

-- Inserir novas configurações
INSERT INTO settings (key, value) VALUES
  ('portal_worker_url', 'https://portal-worker.d9v83a.easypanel.host'),
  ('worker_secret', 'igreen-worker-secret-2024');

-- Verificar
SELECT key, value 
FROM settings 
WHERE key IN ('portal_worker_url', 'worker_secret')
ORDER BY key;
```

**Resultado esperado:**
```
portal_worker_url | https://portal-worker.d9v83a.easypanel.host
worker_secret     | igreen-worker-secret-2024
```

---

#### **4.2 Configurar Secrets no Supabase (Opcional)**

Ir para: https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/settings/functions

**Edge Functions → Secrets:**

```bash
PORTAL_WORKER_URL=https://portal-worker.d9v83a.easypanel.host
WORKER_SECRET=igreen-worker-secret-2024
```

**✅ Save**

---

### **PASSO 5: Testar Manualmente**

#### **5.1 Adicionar Lead na Fila**

```bash
curl -X POST https://portal-worker.d9v83a.easypanel.host/submit-lead \
  -H "Authorization: Bearer igreen-worker-secret-2024" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "UUID-DO-CLIENTE-AQUI"
  }'
```

**Resposta esperada:**
```json
{
  "success": true,
  "message": "Lead adicionado na fila (posição 1)",
  "customer_id": "uuid",
  "position": 1,
  "queue": {
    "processing": null,
    "waiting": 1,
    "totalProcessed": 0
  }
}
```

---

#### **5.2 Verificar Fila**

```bash
curl https://portal-worker.d9v83a.easypanel.host/queue
```

**Resposta esperada:**
```json
{
  "currentJob": {
    "customer_id": "uuid",
    "startedAt": "2026-04-14T..."
  },
  "queueLength": 0,
  "waiting": [],
  "stats": {
    "processed": 1,
    "failed": 0,
    "processing": 1,
    "waiting": 0
  }
}
```

---

#### **5.3 Verificar Logs no Easypanel**

1. Ir para: Easypanel → igreen → portal-worker
2. Clicar em **"Logs"**
3. Procurar por:

```
🎯 Processando lead: uuid
📊 Dados do cliente carregados
🌐 Abrindo portal iGreen...
✅ Portal carregado
📝 Preenchendo formulário...
✅ Formulário preenchido
🎉 Automação concluída!
```

---

### **PASSO 6: Testar via WhatsApp**

#### **6.1 Finalizar Cadastro**

1. Enviar "Oi" para o WhatsApp
2. Enviar foto da conta de energia
3. Confirmar dados
4. Enviar documentos (RG/CNH)
5. Confirmar dados do documento
6. Aguardar finalização

---

#### **6.2 Verificar Logs do Webhook**

Ir para: https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/functions/evolution-webhook/logs

**Procurar por:**
```
✅ Lead completo: João Silva (uuid) - disparando worker-portal
📡 Worker-portal resposta (200): {"success":true,...}
```

---

#### **6.3 Verificar Status no Banco**

```sql
SELECT 
  id,
  name,
  status,
  conversation_step,
  error_message,
  updated_at
FROM customers
WHERE phone_whatsapp = '5511987654321'
ORDER BY created_at DESC
LIMIT 1;
```

**Status esperado:**
- `portal_submitting` → Processando
- `awaiting_otp` → Aguardando código
- `registered_igreen` → Finalizado ✅

---

## 🔧 TROUBLESHOOTING

### **Problema 1: Worker não inicia**

**Erro:** `Cannot find module 'playwright'`

**Solução:**
```bash
# No Dockerfile, adicionar:
RUN npm install playwright-chromium
```

---

### **Problema 2: Chromium não abre**

**Erro:** `Failed to launch browser`

**Solução:**
```bash
# Verificar se xvfb está instalado
RUN apt-get install -y xvfb

# Comando deve ser:
CMD ["xvfb-run", "--auto-servernum", "node", "server.mjs"]
```

---

### **Problema 3: Health check falha**

**Erro:** `Connection refused`

**Solução:**
1. Verificar se porta 3100 está exposta no Dockerfile
2. Verificar se serviço está rodando no Easypanel
3. Verificar logs do container

---

### **Problema 4: Worker não processa leads**

**Erro:** Fila vazia, mas leads com `data_complete` no banco

**Solução:**
```bash
# Verificar polling
curl https://portal-worker.d9v83a.easypanel.host/status

# Deve mostrar:
# "Polling de leads pendentes ativado (5s)"
```

---

### **Problema 5: Supabase não configurado**

**Erro:** `supabaseConfigured: false`

**Solução:**
1. Verificar variáveis de ambiente no Easypanel
2. Adicionar `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`
3. Reimplantar serviço

---

## 📊 PASSO A PASSO PARA GITHUB

### **OPÇÃO 1: Usar Repositório Existente**

Se o código do portal worker já está em `tvmensal2025/whapi-connect-joy`:

```bash
# 1. Clonar repositório
git clone https://github.com/tvmensal2025/whapi-connect-joy.git
cd whapi-connect-joy/worker-portal

# 2. Verificar arquivos
ls -la

# Deve ter:
# - server.mjs
# - playwright-automation.mjs
# - package.json
# - Dockerfile

# 3. Fazer correções necessárias
# (editar Dockerfile conforme PASSO 2.3)

# 4. Commit e push
git add -A
git commit -m "🔧 fix: Corrigir Dockerfile para usar xvfb-run"
git push origin main

# 5. No Easypanel, clicar em "Implantar" para rebuild
```

---

### **OPÇÃO 2: Criar Novo Repositório**

Se precisar criar do zero:

```bash
# 1. Criar pasta local
mkdir portal-worker-igreen
cd portal-worker-igreen

# 2. Inicializar Git
git init
git branch -M main

# 3. Criar arquivos necessários
# (copiar de whapi-analysis/worker-portal/)

# 4. Criar repositório no GitHub
# Ir para: https://github.com/new
# Nome: portal-worker-igreen
# Visibilidade: Private

# 5. Adicionar remote
git remote add origin https://github.com/tvmensal2025/portal-worker-igreen.git

# 6. Commit inicial
git add -A
git commit -m "🎉 feat: Portal worker inicial"
git push -u origin main

# 7. Configurar no Easypanel
# Proprietário: tvmensal2025
# Repositório: portal-worker-igreen
# Ramo: main
# Caminho de Build: /
```

---

## 📝 CHECKLIST FINAL

### **Easypanel** ✅
- [ ] Repositório configurado: `tvmensal2025/whapi-connect-joy`
- [ ] Branch: `main`
- [ ] Caminho de Build: `/worker-portal`
- [ ] Dockerfile com `xvfb-run`
- [ ] Variáveis de ambiente configuradas
- [ ] Domínio configurado: `portal-worker.d9v83a.easypanel.host`
- [ ] Serviço implantado e rodando

### **Supabase** ✅
- [ ] Settings atualizados no banco
- [ ] `portal_worker_url` = URL do Easypanel
- [ ] `worker_secret` = Token correto
- [ ] Secrets configurados (opcional)

### **Testes** ✅
- [ ] Health check retorna `200 OK`
- [ ] Dashboard acessível
- [ ] Teste manual via curl funciona
- [ ] Teste via WhatsApp funciona
- [ ] Logs mostram automação rodando

---

## 🎉 RESUMO

### **Problema:**
Portal worker VPS não está funcionando

### **Causa:**
- Dockerfile sem `xvfb-run`
- Configuração incorreta no Easypanel
- URL não atualizada no Supabase

### **Solução:**
1. ✅ Corrigir Dockerfile para usar `xvfb-run`
2. ✅ Configurar variáveis de ambiente
3. ✅ Atualizar URL no Supabase
4. ✅ Testar manualmente
5. ✅ Testar via WhatsApp

### **Resultado esperado:**
```
✅ Worker online
✅ Health check OK
✅ Dashboard acessível
✅ Automação funcionando
✅ Navegador abrindo automaticamente
```

---

## 📞 LINKS ÚTEIS

### **Easypanel:**
- Dashboard: https://easypanel.io
- Projeto: igreen
- Serviço: portal-worker

### **Worker:**
- URL: https://portal-worker.d9v83a.easypanel.host
- Health: https://portal-worker.d9v83a.easypanel.host/health
- Dashboard: https://portal-worker.d9v83a.easypanel.host/dashboard

### **Supabase:**
- Dashboard: https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl
- SQL Editor: https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/editor
- Settings: https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/settings/database

### **GitHub:**
- Repositório: https://github.com/tvmensal2025/whapi-connect-joy
- Pasta: /worker-portal

---

**Versão:** 1.0.0  
**Data:** 14 de abril de 2026  
**Status:** 📋 GUIA COMPLETO - PRONTO PARA EXECUTAR

🔧 **SIGA OS PASSOS E O PORTAL WORKER VAI FUNCIONAR 100%!** 🔧
