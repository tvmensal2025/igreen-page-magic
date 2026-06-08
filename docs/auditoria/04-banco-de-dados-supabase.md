# 04 — Banco de Dados / Supabase

> Última atualização: 08/06/2026

---

## Visão Geral

- **280+ migrations** SQL
- **Banco**: PostgreSQL via Supabase
- **Extensões**: pgcrypto (gen_random_uuid, digest)
- **RLS**: Habilitado em todas as tabelas principais
- **Auth**: Supabase GoTrue (email/senha)

---

## Tabelas Principais

### Consultores e Autenticação

| Tabela | Função | RLS |
|--------|--------|-----|
| `consultants` | Dados do consultor (nome, licença, telefone, foto, igreen_id, portal_kind, approved) | ✅ Owner read/write, Public read |
| `user_roles` | Roles (admin, user) por usuário | ✅ Apenas admins |
| `auth.users` | Usuários Supabase (auto-gerenciado) | N/A |

### Clientes e Leads

| Tabela | Função | RLS |
|--------|--------|-----|
| `customers` | Clientes/leads com dados pessoais (nome, CPF, email, telefone, endereço, distribuidora) | ✅ Consultant owns |
| `conversations` | Mensagens do bot (step, text, direction, message_text_hash) | ✅ |
| `deals` | Negócios no CRM (stage, value) | ✅ |

### WhatsApp

| Tabela | Função | RLS |
|--------|--------|-----|
| `whatsapp_instances` | Instâncias Evolution por consultor (nome, API key, status, QR) | ✅ Owner CRUD, Admin read |
| `webhook_message_dedup` | Deduplicação de mensagens recebidas (message_id + instance_name) | ✅ No policies (service only) |
| `webhook_rate_limit` | Rate limit por telefone por janela | ✅ No policies |
| `outbound_message_log` | Log de idempotência para envios | ✅ No policies |
| `scheduled_messages` | Mensagens agendadas | ✅ |
| `message_templates` | Templates de mensagem | ✅ |

### Bot e Fluxos

| Tabela | Função | RLS |
|--------|--------|-----|
| `bot_flow_steps` | Steps do fluxo do bot (tipo, texto, mídia, condições, layout) | ✅ |
| `bot_step_transitions` | Transições entre steps (analytics) | ✅ |
| `customer_flow_state` | Estado atual do cliente no fluxo (step, engine_mode) | ✅ |
| `customer_processing_lock` | Lock de serialização por customer | ✅ No policies |
| `ai_cooldown_state` | Cooldown de IA por chave | ✅ No policies |
| `gemini_quota_bucket` | Token bucket de Gemini por consultor | ✅ No policies |

### Facebook / Meta Ads

| Tabela | Função | RLS |
|--------|--------|-----|
| `facebook_connections` | Tokens OAuth por consultor | ✅ |
| `facebook_campaigns` | Campanhas criadas | ✅ |
| `facebook_metrics_daily` | Métricas diárias (impressões, cliques, gasto) | ✅ |
| `consultant_wallet` | Saldo prepaid para ads | ✅ |
| `wallet_transactions` | Histórico de transações da carteira | ✅ |

### IA e Conhecimento

| Tabela | Função | RLS |
|--------|--------|-----|
| `ai_knowledge_sections` | Base de conhecimento para RAG | ✅ |
| `ai_slot_dispatch_log` | Log de envio de mídia com reserva | ✅ |
| `ai_learning_feedback` | Feedback para aprendizado da IA | ✅ |

### Infraestrutura

| Tabela | Função | RLS |
|--------|--------|-----|
| `instance_risk_signals` | Sinais de risco (ban, disconnect) | ✅ |
| `inbound_media_failures` | Falhas de download de mídia | ✅ No policies |
| `inbound_media_retry` | Fila de retry de upload para MinIO | ✅ No policies |
| `pending_outbound_media` | Fila de mídia pendente para envio | ✅ No policies |
| `settings` | Configurações globais (key/value) | ⚠️ Verificar RLS |

---

## Funções RPC (SECURITY DEFINER)

| Função | O que faz | Risco |
|--------|-----------|-------|
| `has_role(_user_id, _role)` | Verifica se usuário tem role | ✅ Seguro |
| `is_super_admin(_user_id)` | Verifica super admin | ✅ |
| `check_send_quota(p_instance)` | Verifica quota anti-ban | ✅ |
| `register_send(p_instance)` | Registra envio (conta diária) | ✅ |
| `try_acquire_rate_limit(phone, window, max)` | Rate limit persistente | ✅ |
| `try_acquire_customer_lock(customer, ttl)` | Lock de processamento | ✅ |
| `release_customer_lock(customer, token)` | Libera lock | ✅ |
| `consume_gemini_token(consultant, tokens)` | Token bucket Gemini | ✅ |
| `reserve_media_send(cons, cust, media, ...)` | Reserva envio de mídia | ✅ |
| `confirm_media_send(res_id, ok)` | Confirma envio | ✅ |
| `ai_cooldown_check_and_set(key, ttl, reason)` | Cooldown de IA | ✅ |

**Avaliação:** Bom design de SECURITY DEFINER — funções críticas isoladas em procedimentos seguros.

---

## Políticas RLS (Amostra)

### consultants
- `Public read` → SELECT para todos (dados públicos do consultor)
- `Owner update` → UPDATE onde id = auth.uid()
- `Owner insert` → INSERT onde id = auth.uid()

### whatsapp_instances
- Consultants can view/insert/update/delete own instances (`consultant_id = auth.uid()`)
- Admins can view/update all (`has_role(auth.uid(), 'admin')`)

### customers
- Consultant vê apenas seus clientes (`consultant_id = auth.uid()`)
- **Risco**: Verificar se há policy de UPDATE restritiva

---

## Riscos do Banco

### 🔴 CRÍTICO

| Risco | Descrição | Impacto |
|-------|-----------|---------|
| `whatsapp_instances.api_key` exposta | API key do Evolution está na tabela com RLS por owner, mas qualquer consultor pode ler SUA chave via frontend | Se alguém roubar a sessão, acessa a chave |
| Settings sem RLS clara | Tabela `settings` pode conter WORKER_SECRET e outros segredos | Vazamento de segredos internos |

### 🟠 ALTO

| Risco | Descrição | Impacto |
|-------|-----------|---------|
| 280+ migrations sem consolidação | Difícil entender schema atual | Manutenção difícil |
| Ausência de tabela de auditoria de admin | Sem log de quem alterou o quê como admin | Sem rastreabilidade |
| Dados de CPF/email sem criptografia at-rest | PostgreSQL não encripta campos individuais | Risco LGPD |

### 🟡 MÉDIO

| Risco | Descrição | Impacto |
|-------|-----------|---------|
| Muitas tabelas sem índice declarado | Queries lentas em tabelas grandes | Performance |
| Lock TTL de 30s pode ser insuficiente | Processamento longo pode perder lock | Race conditions raras |
| Quota Gemini de 60 tokens/min | Pode ser baixo para consultores ativos | Bot para de responder |

### 🟢 BAIXO

| Risco | Descrição | Impacto |
|-------|-----------|---------|
| `cron_setup.sql` na raiz | Fora das migrations | Confusão |
| Migrations com UUID no nome | Difícil localizar por assunto | Organização |

---

## Storage (Buckets)

| Bucket | Público | Uso |
|--------|---------|-----|
| `consultant-photos` | ✅ Sim | Fotos de perfil dos consultores |
| `media` | Verificar | Mídia de WhatsApp |
| `documents` | Verificar | Documentos de clientes (CNH, conta) |

**Risco:** Bucket de documents deve ser PRIVADO (contém dados sensíveis como CNH e conta de energia)

---

## Recomendações

1. Consolidar migrations em snapshots periódicos para legibilidade
2. Verificar RLS da tabela `settings` — se contém segredos, deve ser service_role only
3. Considerar criptografia at-rest para campos PII (CPF, email pessoal)
4. Verificar se bucket `documents` é privado
5. Adicionar tabela de auditoria para ações administrativas
6. Revisar se `api_key` na `whatsapp_instances` pode ser movida para secrets
