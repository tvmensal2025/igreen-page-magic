> ⚠️ **Histórico (até 28/06/2026).** Repo migrado para `tvmensal2025/igreen-page-magic`. Workers ativos aqui: `worker-portal-2`, `worker-igreen-sync`, `compress-worker`. Portal 1 (`worker-portal`) permanece em `tvmensal2025/viana-replica-vault`.

# ✅ RESUMO - CORREÇÃO PORTAL WORKER

> **Tudo que você precisa fazer para o portal worker funcionar 100%**
> 
> **Data:** 14 de abril de 2026  
> **Status:** 📋 PRONTO PARA EXECUTAR

---

## 🎯 PROBLEMA

**Portal worker VPS não está funcionando**

**Causa:** Configuração incorreta do Dockerfile no Easypanel

---

## 🔧 SOLUÇÃO EM 6 PASSOS

### **PASSO 1: Acessar Easypanel** ⏱️ 1 minuto

1. Ir para: https://easypanel.io
2. Login
3. Selecionar projeto: **igreen**
4. Selecionar serviço: **portal-worker**

---

### **PASSO 2: Corrigir Dockerfile** ⏱️ 2 minutos

**Aba: Source → Dockerfile**

Substituir TODO o conteúdo por:

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

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3100

ENV HEADLESS=1
ENV PORT=3100
ENV NODE_ENV=production

# IMPORTANTE: xvfb-run para rodar Chromium sem display
CMD ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1280x900x24", "node", "server.mjs"]
```

**✅ Salvar**

---

### **PASSO 3: Verificar Variáveis de Ambiente** ⏱️ 2 minutos

**Aba: Environment**

Garantir que estas variáveis existem:

```bash
PORT=3100
NODE_ENV=production
HEADLESS=1
SUPABASE_URL=https://zlzasfhcxcznaprrragl.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
WORKER_SECRET=igreen-worker-secret-2024
IGREEN_CONSULTOR_ID=124170
WHAPI_TOKEN=seu-token-aqui
WHAPI_API_URL=https://gate.whapi.cloud
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

**✅ Salvar**

---

### **PASSO 4: Implantar (Deploy)** ⏱️ 5 minutos

1. Clicar no botão verde **"Implantar"** no topo
2. Aguardar build completar (~5 minutos)
3. Verificar logs em tempo real

**Logs esperados:**
```
✅ Chromium instalado
✅ xvfb instalado
🚀 Worker Portal iniciado na porta 3100
✅ Supabase configurado
🔄 Polling de leads pendentes ativado (5s)
```

---

### **PASSO 5: Testar Worker** ⏱️ 1 minuto

Abrir no navegador:
```
https://portal-worker.d9v83a.easypanel.host/health
```

**Resposta esperada:**
```json
{
  "status": "ok",
  "service": "worker-portal",
  "supabaseConfigured": true
}
```

**Dashboard:**
```
https://portal-worker.d9v83a.easypanel.host/dashboard
```

---

### **PASSO 6: Atualizar Supabase** ⏱️ 1 minuto

Ir para: https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/editor

**SQL Editor → New Query:**

```sql
-- Atualizar URL do worker
DELETE FROM settings WHERE key IN ('portal_worker_url', 'worker_secret');

INSERT INTO settings (key, value) VALUES
  ('portal_worker_url', 'https://portal-worker.d9v83a.easypanel.host'),
  ('worker_secret', 'igreen-worker-secret-2024');

-- Verificar
SELECT * FROM settings WHERE key IN ('portal_worker_url', 'worker_secret');
```

**✅ Run**

---

## 🧪 TESTE COMPLETO

### **Teste 1: Health Check** ✅

```bash
curl https://portal-worker.d9v83a.easypanel.host/health
```

**Deve retornar:** `{"status":"ok"}`

---

### **Teste 2: Dashboard** ✅

Abrir: https://portal-worker.d9v83a.easypanel.host/dashboard

**Deve mostrar:**
- Status do serviço
- Fila de processamento
- Últimas atividades

---

### **Teste 3: Adicionar Lead Manualmente** ✅

```bash
curl -X POST https://portal-worker.d9v83a.easypanel.host/submit-lead \
  -H "Authorization: Bearer igreen-worker-secret-2024" \
  -H "Content-Type: application/json" \
  -d '{"customer_id":"UUID-DO-CLIENTE"}'
```

**Deve retornar:** `{"success":true}`

---

### **Teste 4: Via WhatsApp** ✅

1. Enviar "Oi" para o WhatsApp
2. Enviar foto da conta
3. Confirmar dados
4. Enviar documentos
5. Aguardar finalização

**Verificar logs:**
```
https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/functions/evolution-webhook/logs
```

**Procurar por:**
```
✅ Lead completo: João Silva - disparando worker-portal
📡 Worker-portal resposta (200): {"success":true}
```

---

## 📊 CHECKLIST FINAL

### **Easypanel** ✅
- [ ] Dockerfile corrigido com `xvfb-run`
- [ ] Variáveis de ambiente configuradas
- [ ] Serviço implantado e rodando
- [ ] Logs mostram "Worker Portal iniciado"

### **Worker** ✅
- [ ] Health check retorna `200 OK`
- [ ] Dashboard acessível
- [ ] `supabaseConfigured: true`

### **Supabase** ✅
- [ ] Settings atualizados no banco
- [ ] `portal_worker_url` correto
- [ ] `worker_secret` correto

### **Testes** ✅
- [ ] Health check funciona
- [ ] Dashboard acessível
- [ ] Teste manual via curl funciona
- [ ] Teste via WhatsApp funciona

---

## 🎉 RESULTADO ESPERADO

Após seguir todos os passos:

```
✅ Worker online e funcionando
✅ Health check OK
✅ Dashboard acessível
✅ Automação rodando
✅ Navegador abrindo automaticamente
✅ Leads sendo processados
✅ Cliente recebe link do portal
```

---

## 🔍 VERIFICAÇÃO RÁPIDA

### **1. Worker está online?**
```bash
curl https://portal-worker.d9v83a.easypanel.host/health
```

### **2. Supabase configurado?**
```sql
SELECT * FROM settings WHERE key = 'portal_worker_url';
```

### **3. Fila está processando?**
```bash
curl https://portal-worker.d9v83a.easypanel.host/queue
```

### **4. Logs do Easypanel**
```
Easypanel → igreen → portal-worker → Logs
```

---

## 📞 LINKS IMPORTANTES

### **Easypanel:**
- Dashboard: https://easypanel.io
- Projeto: igreen → portal-worker

### **Worker:**
- Health: https://portal-worker.d9v83a.easypanel.host/health
- Dashboard: https://portal-worker.d9v83a.easypanel.host/dashboard
- Queue: https://portal-worker.d9v83a.easypanel.host/queue

### **Supabase:**
- Dashboard: https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl
- SQL Editor: https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/editor
- Logs Webhook: https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/functions/evolution-webhook/logs

### **GitHub:**
- Repositório: https://github.com/tvmensal2025/viana-replica-vault
- Commits: https://github.com/tvmensal2025/viana-replica-vault/commits/main

---

## 🚨 TROUBLESHOOTING RÁPIDO

### **Worker não inicia**
```bash
# Verificar logs no Easypanel
# Procurar por erros de instalação
```

### **Health check falha**
```bash
# Verificar se porta 3100 está exposta
# Verificar se serviço está rodando
```

### **Chromium não abre**
```bash
# Verificar se xvfb está instalado
# Verificar CMD no Dockerfile
```

### **Leads não processam**
```bash
# Verificar polling nos logs
# Verificar se SUPABASE_URL está configurado
```

---

## 📝 DOCUMENTAÇÃO COMPLETA

Para mais detalhes, consultar:

1. **CORRIGIR_PORTAL_WORKER.md** - Guia completo detalhado
2. **PASSO_A_PASSO_GITHUB.md** - Como sincronizar GitHub
3. **REGRAS_PORTAL_WORKER.md** - Regras e funcionamento
4. **EXEMPLOS_PORTAL_WORKER.md** - Exemplos de uso

---

## ⏱️ TEMPO TOTAL

**Estimativa:** 15 minutos

- Passo 1: 1 min
- Passo 2: 2 min
- Passo 3: 2 min
- Passo 4: 5 min (build)
- Passo 5: 1 min
- Passo 6: 1 min
- Testes: 3 min

---

## 🎯 PRÓXIMOS PASSOS

Após corrigir o portal worker:

1. ✅ Testar cadastro completo via WhatsApp
2. ✅ Verificar upload no MinIO
3. ✅ Verificar estrutura de pastas por consultor
4. ✅ Monitorar logs em produção

---

**Versão:** 1.0.0  
**Data:** 14 de abril de 2026  
**Status:** ✅ PRONTO PARA EXECUTAR

🚀 **SIGA OS 6 PASSOS E O PORTAL WORKER VAI FUNCIONAR!** 🚀
