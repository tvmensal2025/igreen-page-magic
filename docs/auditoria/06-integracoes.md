# 06 — Integrações

> Última atualização: 08/06/2026

---

## 1. Evolution API (WhatsApp — canal principal)

| Aspecto | Detalhes |
|---------|----------|
| **O que é** | API self-hosted de WhatsApp baseada em Baileys (não-oficial) |
| **Onde está configurada** | `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` (env) |
| **Arquivos que usam** | `supabase/functions/_shared/evolution-api.ts`, `src/services/evolutionApi.ts`, `evolution-webhook/` |
| **Proxy** | Chamadas do frontend passam por `evolution-proxy` (Edge Function) |
| **Tratamento de erro** | ✅ EvolutionAuthError com requiresRelogin |
| **Retry** | ✅ withRetry com backoff no backend |
| **Logs** | ✅ Logger estruturado |
| **Fallback** | Parcial: mensagens ficam em `pending_outbound_media` para retry |
| **Segurança** | ✅ Nunca expõe API key no frontend |
| **Custo** | Gratuito (self-hosted) mas risco de ban |
| **Pode quebrar atendimento?** | 🔴 SIM — se Evolution cair, bot para completamente |
| **Risco de custo** | Baixo (infra própria) |

---

## 2. Whapi (WhatsApp — canal alternativo / super admin)

| Aspecto | Detalhes |
|---------|----------|
| **O que é** | API de WhatsApp SaaS (paga) |
| **Onde está configurada** | `WHAPI_TOKEN`, `WHAPI_API_URL` (env) |
| **Arquivos que usam** | `src/services/whapiApi.ts`, `supabase/functions/_shared/whapi-api.ts`, `whapi-webhook/`, `whapi-proxy/` |
| **Quem usa** | Apenas super admin (rafael.ids@icloud.com) |
| **Proxy** | `whapi-proxy` Edge Function |
| **Tratamento de erro** | ✅ Try/catch com mensagens claras |
| **Retry** | Não encontrado |
| **Logs** | Parcial |
| **Fallback** | Nenhum |
| **Segurança** | ✅ Token nunca exposto no frontend |
| **Custo** | 💰 Pago por uso — precisa monitorar |
| **Pode quebrar atendimento?** | Apenas do super admin |

---

## 3. Gemini (IA — motor principal)

| Aspecto | Detalhes |
|---------|----------|
| **O que é** | Google Gemini 3 Flash via Lovable AI Gateway |
| **Onde está configurada** | `LOVABLE_API_KEY` (auto-injetada), `GEMINI_API_KEY` (OCR direto) |
| **Arquivos que usam** | `_shared/ai-gateway.ts`, `_shared/gemini.ts`, `ai-sales-agent/`, `ai-suggest-reply/`, `ai-extract-memory/`, `ai-summarize-conversation/` |
| **Modelo padrão** | `google/gemini-3-flash-preview` |
| **Token bucket** | ✅ 60 tokens/min por consultor (gemini_quota_bucket) |
| **Tratamento de erro** | ✅ Retorna texto vazio, não quebra |
| **Retry** | Não explícito (gateway pode ter internamente) |
| **Logs** | ✅ ai-cost-tracker registra uso |
| **Fallback** | Se Gemini falha → bot continua sem IA (fluxo linear) |
| **Segurança** | ✅ Chave somente no backend |
| **Custo** | ⚠️ MÉDIO-ALTO se descontrolado |
| **Pode gerar custo alto?** | 🟡 SIM — max_tokens * 8 para modelos "thinking" |
| **Pode travar fluxo?** | NÃO — fallback para fluxo linear |

**Risco:** Modelo thinking multiplica tokens por 8 — se modelo padrão mudar, custo explode.

---

## 4. OpenAI (IA — fallback/classificação)

| Aspecto | Detalhes |
|---------|----------|
| **O que é** | OpenAI GPT (intent-classifier opcional) |
| **Onde está configurada** | `OPENAI_API_KEY` (env, opcional) |
| **Arquivos que usam** | `_shared/openai.ts` |
| **Uso** | Classificação de intenção (opcional, pode ser substituído por Gemini) |
| **Custo** | 💰 Pago por token |
| **Pode travar fluxo?** | NÃO — é opcional |

---

## 5. Facebook / Meta Ads

| Aspecto | Detalhes |
|---------|----------|
| **O que é** | Facebook Marketing API + Conversions API (CAPI) |
| **Onde está configurada** | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, tokens por consultor (DB) |
| **Arquivos que usam** | 30+ edge functions `facebook-*`, `src/services/facebookAds.ts` |
| **OAuth** | ✅ Fluxo completo (start → callback → refresh) |
| **Token refresh** | ✅ `facebook-token-refresh` cron |
| **CAPI** | ✅ Envia eventos de conversão |
| **Wallet** | ✅ Sistema prepaid (consultor carrega saldo) |
| **Auto-pause** | ✅ `facebook-auto-pause` se gasto > orçamento |
| **Tratamento de erro** | ✅ Healthcheck + diagnósticos |
| **Retry** | ✅ Para sync de métricas |
| **Logs** | ✅ Métricas diárias registradas |
| **Segurança** | ✅ Tokens OAuth no banco (RLS protege) |
| **Custo** | 💰 O consultor paga (prepaid) — sistema controla |
| **Pode quebrar atendimento?** | NÃO — ads são independentes do bot |
| **Risco** | Token expira e auto-refresh falha → campanha para |

---

## 6. MinIO (Storage de mídia)

| Aspecto | Detalhes |
|---------|----------|
| **O que é** | Storage S3-compatible self-hosted |
| **Onde está configurada** | `MINIO_SERVER_URL`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_BUCKET` |
| **Arquivos que usam** | `_shared/minio-upload.ts`, `_shared/media-storage.ts`, `src/services/minioUpload.ts`, `migrate-supabase-to-minio/`, `upload-documents-minio/` |
| **Uso** | Armazenamento de áudios, imagens, vídeos e documentos |
| **Retry** | ✅ `inbound_media_retry` com retry queue |
| **Quota** | ✅ `minio-quota-check` cron |
| **Segurança** | ⚠️ Credenciais de admin no env — se vazarem, acesso total |
| **Custo** | Baixo (self-hosted) |
| **Pode travar fluxo?** | 🟡 Se cair, mídia não é salva (mas retry funciona) |

---

## 7. Portal Workers (Cadastro iGreen)

| Aspecto | Detalhes |
|---------|----------|
| **O que é** | Workers com Playwright que preenchem formulários no portal iGreen |
| **Onde está configurada** | `PORTAL_WORKER_URL` / `WORKER_PORTAL_URL`, `WORKER_SECRET` |
| **Arquivos que usam** | `_shared/portal-worker.ts`, `worker-portal/`, `worker-portal-2/` |
| **Worker 1** | Playwright UI automation (digital) |
| **Worker 2** | API direta (autoconexão) |
| **Auth** | Bearer token (WORKER_SECRET) |
| **Retry** | ✅ `portal-offline-retry` cron |
| **OTP** | ✅ Interceptação via `submit-otp` + `recover-stuck-otp` |
| **Screenshots** | ✅ Cada step gera screenshot para debug |
| **Pode travar fluxo?** | 🟡 Se offline, cliente fica preso (retry salva) |
| **Risco principal** | Portal iGreen muda interface → Playwright quebra |

---

## 8. Supabase (Backend-as-a-Service)

| Aspecto | Detalhes |
|---------|----------|
| **Projeto** | zlzasfhcxcznaprrragl |
| **Auth** | GoTrue (email/senha) |
| **Realtime** | WebSocket para mensagens novas |
| **Edge Functions** | 120+ functions em Deno |
| **Storage** | Buckets para fotos |
| **Custo** | Dependente do plano — edge functions e realtime podem escalar |
| **Pode travar tudo?** | 🔴 SIM — single point of failure |

---

## 9. Sentry (Monitoramento)

| Aspecto | Detalhes |
|---------|----------|
| **Onde** | Frontend (@sentry/react) + Edge Functions (_shared/sentry.ts) |
| **Configuração** | `SENTRY_DSN` (env, opcional) |
| **Uso** | Captura erros não tratados |
| **Cobertura** | Parcial — nem todas as funções usam |

---

## 10. Stripe (Pagamentos — Wallet)

| Aspecto | Detalhes |
|---------|----------|
| **O que é** | Pagamento para recarga da wallet |
| **Webhook** | `wallet-stripe-webhook` (verify_jwt = false) |
| **Uso** | Consultor recarrega saldo para Meta Ads |
| **Segurança** | Webhook valida assinatura Stripe |

---

## Resumo de Riscos por Integração

| Integração | Se cair... | Impacto | Recuperação |
|-----------|-----------|---------|-------------|
| Evolution API | Bot para | 🔴 CRÍTICO | Manual: reiniciar instância |
| Supabase | TUDO para | 🔴 CRÍTICO | Aguardar Supabase |
| Gemini | IA não responde | 🟡 MÉDIO | Fallback para fluxo linear |
| MinIO | Mídia não salva | 🟡 MÉDIO | Retry queue |
| Portal Worker | Cadastros atrasam | 🟡 MÉDIO | Retry cron |
| Facebook | Ads param | 🟢 BAIXO | Não afeta atendimento |
| Whapi | Super admin sem chat | 🟢 BAIXO | Apenas 1 pessoa afetada |
| Stripe | Recargas falham | 🟢 BAIXO | Temporário |
| Sentry | Sem monitoramento | 🟢 BAIXO | Sistema funciona sem |
