# 08 — Performance e Custos

> Última atualização: 08/06/2026

---

## 1. Custos por Integração

### Gemini / IA

| Fator | Situação | Risco de Custo |
|-------|----------|----------------|
| Modelo padrão | gemini-3-flash-preview (barato) | 🟢 OK |
| Multiplicador para thinking models | ×8 no max_tokens | 🟠 Se modelo mudar, custo explode |
| Token bucket | 60 tokens/min por consultor | ✅ Controla |
| ai-cost-tracker | ✅ Registra uso | Monitorável |
| Chamadas por mensagem | ~1-2 por mensagem inbound | 🟡 Multiplicado por volume |
| Follow-ups automáticos | Cada follow-up = 1 chamada IA | 🟡 |
| OCR (Gemini Vision) | 1 chamada por imagem recebida | 🟡 |

**Estimativa:** Com 100 leads ativos/dia, ~200-400 chamadas Gemini/dia = ~$2-5/dia (flash pricing)

**Risco:** Se alguém mudar o modelo para `google/gemini-3-pro` (thinking), custo pode ir para $20-50/dia

### WhatsApp / Evolution

| Fator | Situação | Risco de Custo |
|-------|----------|----------------|
| Self-hosted | ✅ Gratuito (infra própria) | 🟢 |
| Anti-ban warmup | D1=20, D14+=600 msgs/dia | ✅ Limita envio |
| Risco de ban | Se banir, perde chip + número | 🟠 Custo indireto (perda de leads) |
| Whapi (super admin) | Pago por uso | 🟢 Volume baixo |

### Facebook / Meta Ads

| Fator | Situação | Risco de Custo |
|-------|----------|----------------|
| Wallet prepaid | ✅ Consultor paga antes | ✅ Sem risco para a plataforma |
| Auto-pause | ✅ Para se gasto > orçamento | ✅ |
| Balance reconcile | ✅ Cron verifica | ✅ |

**Avaliação:** Custo controlado — risco é do consultor.

### MinIO

| Fator | Situação | Risco de Custo |
|-------|----------|----------------|
| Self-hosted | ✅ Custo fixo (infra) | 🟢 |
| Quota check | ✅ `minio-quota-check` cron | ✅ |

### Supabase

| Fator | Situação | Risco de Custo |
|-------|----------|----------------|
| Edge Functions | 120+ funções | 🟡 Muitas invocações se volume crescer |
| Realtime | WebSocket por consultor | 🟡 |
| Banco | 280+ tabelas | 🟡 Storage cresce com mensagens |
| Storage | Fotos + documentos | 🟡 |

---

## 2. Problemas de Performance

### Frontend

| Problema | Onde | Impacto | Prioridade |
|----------|------|---------|------------|
| useWhatsApp faz polling contínuo | WhatsApp hook | ⚠️ Requests constantes à Evolution | MÉDIO |
| Profile pictures: fetches individuais | useChats | ⚠️ N requests por N contatos | MÉDIO |
| Lazy loading correto | Todas as páginas | ✅ Bom | — |
| Manual chunks no Vite | Build config | ✅ Bom | — |
| PWA com cache strategies | Service Worker | ✅ Bom | — |
| Supabase Realtime para mensagens | useMessages | ✅ Eficiente | — |
| 6765 linhas de types importados | types.ts | 🟡 Bundle size | BAIXO |

### Backend (Edge Functions)

| Problema | Onde | Impacto | Prioridade |
|----------|------|---------|------------|
| evolution-webhook é gigante (~2334 linhas) | evolution-webhook/ | 🟡 Cold start mais lento | MÉDIO |
| Cada mensagem inbound aciona múltiplas queries | Webhook handler | ⚠️ 5-10 queries por msg | MÉDIO |
| Lock + dedup + rate limit = 3 RPCs antes de processar | Webhook | ⚠️ Latência adicionada | BAIXO |
| Gemini quota check por mensagem | Token bucket | 🟡 1 RPC extra | BAIXO |
| Customer lock TTL de 30s pode serializar pipeline | Lock | ⚠️ Mensagens seguintes bloqueadas | MÉDIO |

### Banco de Dados

| Problema | Onde | Impacto | Prioridade |
|----------|------|---------|------------|
| `conversations` cresce indefinidamente | Sem cleanup/archive | 🟠 Performance degrada | ALTO |
| `webhook_message_dedup` sem TTL/cleanup | Tabela cresce | 🟡 | MÉDIO |
| `webhook_rate_limit` sem cleanup de janelas antigas | Tabela cresce | 🟡 | MÉDIO |
| `outbound_message_log` sem archive | Cresce por envio | 🟡 | MÉDIO |
| 280+ migrations (schema complex) | Tempo de deploy | 🟡 | BAIXO |

---

## 3. Loops Perigosos e Automações sem Limite

| Risco | Onde | Mitigação Existente |
|-------|------|---------------------|
| Follow-up infinito | ai-followup-cron | ⚠️ Verificar se há máximo de tentativas |
| Reaquecimento em loop | reactivation-cron | ⚠️ Verificar cooldown |
| Bot respondendo a si mesmo | evolution-webhook | ✅ Verifica `fromMe` |
| Retry infinito de mídia | inbound-media-retry | ✅ TTL de 1 hora + max attempts |
| Retry de portal offline | portal-offline-retry | ⚠️ Verificar limite |
| Crons sobrepostos | Todos os crons | 🟡 Se cron leva mais que intervalo, dobra execução |
| Bulk send sem limite diário | BulkSendPanel | ✅ Anti-ban controla |

---

## 4. O que Reduz Custos (já implementado)

| Mecanismo | Efeito |
|-----------|--------|
| Token bucket Gemini (60/min) | Limita chamadas IA |
| Anti-ban warmup progressivo | Previne ban (custo indireto) |
| Idempotency keys | Previne mensagens duplicadas |
| Feature flags (dark → canary → on) | Rollout gradual sem blast |
| MinIO self-hosted | Zero custo de storage |
| Evolution self-hosted | Zero custo de WhatsApp |
| PWA cache (NetworkFirst HTML, CacheFirst imagens) | Menos requests |
| Manual chunks (Vite) | Carregamento paralelo |
| Wallet prepaid (ads) | Consultor paga antes |
| Quiet hours | Não envia de madrugada (menos uso) |

---

## 5. Recomendações de Otimização

### Curto Prazo (impacto imediato)

1. **Limpar tabelas de dedup/rate limit** — Cron para deletar registros > 7 dias
2. **Archiving de conversations** — Mover conversas > 90 dias para tabela _archive
3. **Verificar follow-up máximo** — Garantir que não passe de 3 tentativas
4. **Batch profile pictures** — Ao invés de N requests, buscar em lote

### Médio Prazo

5. **Monitorar custo Gemini** — Dashboard de uso por consultor/dia
6. **Alertas de custo** — Se usar > X tokens em Y minutos, pausar
7. **Cache de respostas FAQ** — Se pergunta é frequente, resposta cacheada
8. **Conexão pooling** — Verificar se Edge Functions reutilizam conexões

### Longo Prazo

9. **Decomposição do evolution-webhook** — Menos cold start
10. **CDN para mídia estática** — Reduzir carga no MinIO
11. **Read replicas** — Se volume crescer muito
12. **Rate limiting por IP** — Proteger contra abuse

---

## 6. Estimativa de Custos Mensais (100 consultores ativos)

| Item | Estimativa |
|------|-----------|
| Supabase (Pro) | ~$25-75/mês |
| Gemini (via Lovable Gateway) | ~$50-150/mês |
| MinIO (infra) | ~$10-20/mês |
| Evolution (infra) | ~$10-20/mês |
| Workers (infra) | ~$20-40/mês |
| Sentry | Gratuito ou $26/mês |
| **Total estimado** | **~$115-330/mês** |

**Nota:** Facebook Ads é custo do consultor, não da plataforma.
