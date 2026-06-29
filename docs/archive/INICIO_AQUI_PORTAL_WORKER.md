> ⚠️ **Histórico (até 28/06/2026).** Repo migrado para `tvmensal2025/igreen-page-magic`. Workers ativos aqui: `worker-portal-2`, `worker-igreen-sync`, `compress-worker`. Portal 1 (`worker-portal`) permanece em `tvmensal2025/viana-replica-vault`.

# 🚀 COMECE AQUI - CORRIGIR PORTAL WORKER

> **Guia rápido e direto para fazer o portal worker funcionar**
> 
> **Data:** 14 de abril de 2026  
> **Tempo:** 15 minutos

---

## ⚡ AÇÃO RÁPIDA - 6 PASSOS

### **1️⃣ ACESSAR EASYPANEL** (1 min)

```
https://easypanel.io
→ Login
→ Projeto: igreen
→ Serviço: portal-worker
```

---

### **2️⃣ CONFIGURAR REPOSITÓRIO NO EASYPANEL** (2 min)

**Aba: Source → Github**

**✅ CONFIGURAÇÃO CORRETA:**

```
Proprietário: tvmensal2025
Repositório: viana-replica-vault
Ramo: main
Caminho de Build: /worker-portal
```

**✅ Salvar**

**Nota:** O código do portal worker agora está na pasta `/worker-portal` deste repositório!

---

### **3️⃣ CORRIGIR DOCKERFILE** (2 min)

**Aba: Source → Dockerfile**

**COPIAR E COLAR ESTE CÓDIGO:**

```dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium chromium-driver xvfb \
    fonts-liberation libnss3 libxss1 libasound2 \
    libatk-bridge2.0-0 libatk1.0-0 libcups2 \
    libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 \
    libnspr4 libx11-xcb1 libxcomposite1 \
    libxdamage1 libxrandr2 xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3100

ENV HEADLESS=1
ENV PORT=3100
ENV NODE_ENV=production

CMD ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1280x900x24", "node", "server.mjs"]
```

**✅ Salvar**

---

### **4️⃣ VERIFICAR VARIÁVEIS** (2 min)

**Aba: Environment**

**GARANTIR QUE EXISTEM:**

```
PORT=3100
HEADLESS=1
SUPABASE_URL=https://zlzasfhcxcznaprrragl.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
WORKER_SECRET=igreen-worker-secret-2024
IGREEN_CONSULTOR_ID=124170
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

**✅ Salvar**

---

### **5️⃣ IMPLANTAR** (5 min)

**Clicar no botão verde "Implantar"**

Aguardar build completar (~5 minutos)

**Logs esperados:**
```
✅ Chromium instalado
✅ xvfb instalado
🚀 Worker Portal iniciado na porta 3100
```

---

### **5️⃣ TESTAR** (1 min)

**Abrir no navegador:**
```
https://portal-worker.d9v83a.easypanel.host/health
```

**Deve mostrar:**
```json
{"status":"ok","supabaseConfigured":true}
```

---

### **6️⃣ ATUALIZAR SUPABASE** (1 min)

**Ir para:**
```
https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/editor
```

**SQL Editor → Executar:**

```sql
DELETE FROM settings WHERE key IN ('portal_worker_url', 'worker_secret');

INSERT INTO settings (key, value) VALUES
  ('portal_worker_url', 'https://portal-worker.d9v83a.easypanel.host'),
  ('worker_secret', 'igreen-worker-secret-2024');
```

**✅ Run**

---

## ✅ PRONTO!

### **Verificar se funcionou:**

1. **Health check:**
   ```
   https://portal-worker.d9v83a.easypanel.host/health
   ```
   Deve retornar: `{"status":"ok"}`

2. **Dashboard:**
   ```
   https://portal-worker.d9v83a.easypanel.host/dashboard
   ```
   Deve abrir página com status

3. **Teste via WhatsApp:**
   - Enviar "Oi"
   - Enviar foto da conta
   - Finalizar cadastro
   - Worker deve processar automaticamente

---

## 🔍 VERIFICAÇÃO RÁPIDA

### **✅ Tudo funcionando se:**

- [ ] Health check retorna `200 OK`
- [ ] Dashboard acessível
- [ ] Logs mostram "Worker Portal iniciado"
- [ ] Settings no Supabase atualizados
- [ ] Teste via WhatsApp funciona

---

## 🚨 SE NÃO FUNCIONAR

### **Problema: Health check falha**

**Solução:**
1. Verificar logs no Easypanel
2. Procurar por erros
3. Verificar se serviço está rodando

---

### **Problema: Chromium não abre**

**Solução:**
1. Verificar se Dockerfile tem `xvfb-run`
2. Verificar CMD no final do Dockerfile
3. Reimplantar serviço

---

### **Problema: Leads não processam**

**Solução:**
1. Verificar se `SUPABASE_URL` está configurado
2. Verificar logs do worker
3. Verificar settings no banco

---

## 📚 DOCUMENTAÇÃO COMPLETA

Para mais detalhes:

1. **RESUMO_CORRECAO_PORTAL_WORKER.md** - Resumo executivo
2. **CORRIGIR_PORTAL_WORKER.md** - Guia completo detalhado
3. **REGRAS_PORTAL_WORKER.md** - Como funciona
4. **PASSO_A_PASSO_GITHUB.md** - Sincronizar GitHub

---

## 📞 LINKS RÁPIDOS

### **Easypanel:**
- https://easypanel.io

### **Worker:**
- Health: https://portal-worker.d9v83a.easypanel.host/health
- Dashboard: https://portal-worker.d9v83a.easypanel.host/dashboard

### **Supabase:**
- Dashboard: https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl
- SQL Editor: https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/editor

---

## ⏱️ TEMPO TOTAL: 15 MINUTOS

```
1. Acessar Easypanel:     1 min
2. Corrigir Dockerfile:   2 min
3. Verificar variáveis:   2 min
4. Implantar:             5 min
5. Testar:                1 min
6. Atualizar Supabase:    1 min
7. Verificação final:     3 min
─────────────────────────────────
TOTAL:                   15 min
```

---

## 🎯 RESULTADO FINAL

```
✅ Worker online
✅ Health check OK
✅ Dashboard funcionando
✅ Automação rodando
✅ Navegador abrindo
✅ Leads processando
✅ Cliente recebe link
```

---

**Versão:** 1.0.0  
**Data:** 14 de abril de 2026  
**Status:** 🚀 PRONTO PARA USAR

🚀 **SIGA OS 6 PASSOS E ESTÁ PRONTO!** 🚀
