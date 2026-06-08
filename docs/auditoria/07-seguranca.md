# 07 — Segurança

> Última atualização: 08/06/2026

---

## Resumo Executivo

O sistema possui uma camada de segurança **sólida no backend** (caller-auth, anti-ban, RLS) mas tem **lacunas importantes no frontend** (sem route guards, super admin por email hardcoded, muitas funções sem verify_jwt).

---

## Análise por Categoria

### 1. Autenticação

| Item | Estado | Risco |
|------|--------|-------|
| Login via Supabase Auth (email/senha) | ✅ OK | — |
| JWT com autoRefreshToken | ✅ OK | — |
| Session persistida em localStorage | ✅ Padrão | — |
| Route guards no router | ❌ AUSENTE | 🟠 ALTO |
| Auth check por hook (dentro do componente) | ⚠️ Funciona mas atrasado | Componente carrega antes do check |
| Rate limit no login | Não verificado | Possível brute force |

### 2. Autorização

| Item | Estado | Risco |
|------|--------|-------|
| RLS habilitado em tabelas principais | ✅ OK | — |
| has_role() com SECURITY DEFINER | ✅ Robusto | — |
| caller-auth.ts (Edge Functions) | ✅ Excelente | Timing-safe comparison |
| assertOwnership (IDOR protection) | ✅ Excelente | — |
| Super admin por email hardcoded | ❌ PERIGOSO | 🔴 CRÍTICO |
| Admin sem 2FA | ⚠️ Fragilidade | 🟡 MÉDIO |
| verify_jwt=false em ~40 funções | ⚠️ Necessita auditoria individual | 🟠 ALTO |

### 3. Dados Sensíveis

| Dado | Onde | Proteção | Risco |
|------|------|----------|-------|
| CPF | `customers` | RLS (consultant_id = auth.uid()) | 🟡 Sem criptografia at-rest |
| Email pessoal | `customers` | RLS | 🟡 |
| Telefone | `customers` | RLS | 🟡 |
| Endereço | `customers` | RLS | 🟡 |
| CNH / Conta de energia | Storage + banco | ⚠️ Verificar bucket visibility | 🟠 |
| API keys WhatsApp | `whatsapp_instances` | RLS (owner) | 🟡 |
| Facebook tokens | `facebook_connections` | RLS | ✅ |
| Portal password | `consultants.igreen_portal_password` | RLS (owner) | ⚠️ Salvo em texto? |

### 4. Chaves e Tokens

| Item | Exposição | Risco |
|------|-----------|-------|
| `SUPABASE_PUBLISHABLE_KEY` (anon key) | Frontend (esperado) | ✅ OK |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend only | ✅ OK |
| `EVOLUTION_API_KEY` | Backend only | ✅ OK |
| `WHAPI_TOKEN` | Backend only | ✅ OK |
| `SERVICE_SHARED_SECRET` | Backend only | ✅ OK |
| `GEMINI_API_KEY` | Backend only | ✅ OK |
| Anon key duplicada em 3 arquivos frontend | Redundante mas seguro | 🟢 BAIXO |

### 5. Edge Functions sem JWT

**Funções com `verify_jwt = false` que PRECISAM de auth interna:**

| Função | Tem caller-auth? | Risco |
|--------|-------------------|-------|
| `ai-agent-router` | ✅ Usa x-service-secret | OK |
| `ai-sales-agent` | Verificar | 🟡 |
| `ai-transcribe-media` | Verificar | 🟡 |
| `capture-extract` | Verificar | 🟡 |
| `igreen-ingest-customers` | Verificar | 🟡 |
| `embed-knowledge` | Verificar | 🟡 |
| `upload-documents-minio` | Verificar | 🟠 (documentos sensíveis) |
| `recover-stuck-otp` | Verificar | 🟡 |
| `portal-offline-retry` | Verificar | 🟡 |

**Funções com `verify_jwt = false` que são webhooks/crons (CORRETO):**
- `evolution-webhook` ✅ (webhook externo)
- `whapi-webhook` ✅ (webhook externo)
- `wallet-stripe-webhook` ✅ (webhook com assinatura)
- `facebook-oauth-callback` ✅ (redirect OAuth)
- `facebook-sync-metrics` ✅ (cron)
- `facebook-token-refresh` ✅ (cron)
- Todos os `*-cron` ✅

### 6. Webhooks

| Webhook | Validação | Risco |
|---------|-----------|-------|
| `evolution-webhook` | Sem validação de assinatura | 🟠 ALTO — qualquer um pode enviar fake events |
| `whapi-webhook` | Sem validação de assinatura | 🟠 ALTO |
| `wallet-stripe-webhook` | ✅ Valida assinatura Stripe | OK |
| `facebook-capi` | ⚠️ Verificar | 🟡 |

---

## Vulnerabilidades Classificadas

### 🔴 CRÍTICO

| # | Vulnerabilidade | Impacto | Correção |
|---|----------------|---------|----------|
| 1 | Super admin detectado por email hardcoded (`rafael.ids@icloud.com`) | Se email comprometido, atacante ganha acesso Whapi/super admin | Mover para `user_roles` ou `settings` |
| 2 | Webhooks sem validação de origem (Evolution, Whapi) | Atacante pode injetar mensagens fake no sistema | Implementar validação de IP ou secret header |

### 🟠 ALTO

| # | Vulnerabilidade | Impacto | Correção |
|---|----------------|---------|----------|
| 3 | Sem route guards no React Router | Páginas admin carregam antes do auth check | Adicionar HOC/wrapper de proteção |
| 4 | ~15 Edge Functions sem JWT E sem caller-auth verificado | Endpoints possivelmente abertos | Auditar cada função individualmente |
| 5 | `upload-documents-minio` sem JWT e possivelmente sem auth | Upload de documentos sensíveis sem validação | Adicionar auth |
| 6 | Consultor portal password possivelmente em texto claro | Vazamento de senha do portal iGreen | Criptografar ou remover |

### 🟡 MÉDIO

| # | Vulnerabilidade | Impacto | Correção |
|---|----------------|---------|----------|
| 7 | Dados PII sem criptografia at-rest (CPF, email, telefone) | Risco LGPD em caso de breach no banco | Criptografia por coluna |
| 8 | Sem 2FA para administradores | Conta comprometida = acesso total | Habilitar MFA no Supabase |
| 9 | Rate limit do frontend é in-memory (per-tab) | Não persiste entre reloads | Irrelevante se backend também limita |
| 10 | Tabela `settings` possivelmente sem RLS restritivo | WORKER_SECRET pode vazar | Verificar e corrigir policies |

### 🟢 BAIXO

| # | Vulnerabilidade | Impacto | Correção |
|---|----------------|---------|----------|
| 11 | Anon key duplicada em 3 arquivos | Manutenção mais difícil | Importar de client.ts |
| 12 | Logs com possíveis dados sensíveis | Debug mode pode logar PII | Sanitizar logs em produção |
| 13 | QR code salvo em base64 no banco | Temporário e por owner | Limpar após conexão |

---

## O que está BEM na segurança

| Item | Qualidade |
|------|-----------|
| `caller-auth.ts` com timing-safe comparison | ⭐ Excelente |
| Anti-ban com warmup progressivo | ⭐ Excelente |
| Customer lock com TTL (anti-race condition) | ⭐ Muito bom |
| Idempotency keys para envios | ⭐ Muito bom |
| Token bucket Gemini (controle de custo) | ⭐ Muito bom |
| Kill switch do bot (global + por consultor) | ⭐ Muito bom |
| RLS em todas as tabelas principais | ✅ Bom |
| Service role separado do anon key | ✅ Bom |
| Proxy para APIs externas (nunca direto do frontend) | ✅ Bom |
| Feature flags com rollback simples | ✅ Bom |

---

## Recomendações Prioritárias

1. **IMEDIATO:** Remover hardcode de email super admin → usar tabela `user_roles` com role 'super_admin'
2. **IMEDIATO:** Adicionar validação de origem nos webhooks (IP allowlist ou shared secret)
3. **CURTO PRAZO:** Implementar route guards no React Router
4. **CURTO PRAZO:** Auditar todas as Edge Functions com `verify_jwt=false`
5. **MÉDIO PRAZO:** Habilitar MFA para admins
6. **MÉDIO PRAZO:** Criptografar campos PII sensíveis
7. **LONGO PRAZO:** Implementar audit log para ações administrativas
