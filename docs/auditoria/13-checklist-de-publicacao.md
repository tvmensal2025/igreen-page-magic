# 13 — Checklists de Segurança e Publicação

> Última atualização: 08/06/2026

---

## Checklist de Segurança

### RLS (Row Level Security)

- [ ] `consultants` — RLS habilitado, public read, owner write
- [ ] `customers` — RLS habilitado, consultant_id = auth.uid()
- [ ] `conversations` — RLS habilitado
- [ ] `whatsapp_instances` — RLS habilitado, owner CRUD, admin read
- [ ] `deals` — RLS habilitado
- [ ] `bot_flow_steps` — RLS habilitado
- [ ] `scheduled_messages` — RLS habilitado
- [ ] `facebook_connections` — RLS habilitado
- [ ] `facebook_campaigns` — RLS habilitado
- [ ] `consultant_wallet` — RLS habilitado
- [ ] `settings` — ⚠️ VERIFICAR se service_role only
- [ ] `webhook_message_dedup` — No policies (service only) ✅
- [ ] `outbound_message_log` — No policies (service only) ✅
- [ ] `customer_processing_lock` — No policies (service only) ✅
- [ ] `ai_knowledge_sections` — RLS por consultant

### Autenticação

- [ ] Supabase Auth configurado (email/senha)
- [ ] autoRefreshToken habilitado
- [ ] persistSession habilitado
- [ ] Route guards implementados (após Fase 3)
- [ ] Logout limpa storage completamente
- [ ] Token não é logado em console
- [ ] Service role key NÃO está no frontend

### Permissões

- [ ] has_role() funciona corretamente
- [ ] is_super_admin() funciona corretamente
- [ ] Admin NÃO pode escalar para super_admin sem intervenção manual
- [ ] Consultor não-aprovado não acessa features premium
- [ ] Sem email hardcoded para roles (após Fase 2)

### Variáveis de Ambiente

- [ ] SUPABASE_URL configurada em produção
- [ ] SUPABASE_ANON_KEY configurada
- [ ] SUPABASE_SERVICE_ROLE_KEY configurada (NUNCA no frontend)
- [ ] EVOLUTION_API_URL configurada
- [ ] EVOLUTION_API_KEY configurada
- [ ] WHAPI_TOKEN configurada (se usar)
- [ ] GEMINI_API_KEY configurada
- [ ] LOVABLE_API_KEY auto-injetada
- [ ] SERVICE_SHARED_SECRET configurado e forte (32+ bytes hex)
- [ ] MINIO_* configurados
- [ ] PORTAL_WORKER_URL configurado
- [ ] WORKER_SECRET configurado e forte
- [ ] FACEBOOK_APP_SECRET configurado
- [ ] SENTRY_DSN configurado (opcional)
- [ ] Nenhuma variável com valor default inseguro

### Tokens e Chaves

- [ ] SERVICE_SHARED_SECRET gerado com `openssl rand -hex 32`
- [ ] WORKER_SECRET é único e forte
- [ ] Facebook tokens refresh funciona automaticamente
- [ ] Evolution API key não exposta em logs
- [ ] Nenhuma chave commitada no repositório
- [ ] .env está no .gitignore ✅

### Webhooks

- [ ] evolution-webhook valida origin (após Fase 2)
- [ ] whapi-webhook valida origin (após Fase 2)
- [ ] wallet-stripe-webhook valida assinatura ✅
- [ ] Webhooks de teste NÃO apontam para produção
- [ ] URLs de webhook são HTTPS

### Dados Sensíveis

- [ ] CPF/CNH não aparecem em logs
- [ ] Dados do cliente não expostos em URLs
- [ ] Storage de documentos é privado
- [ ] Backups do banco são criptografados (Supabase default)
- [ ] Acesso ao dashboard Supabase é restrito

### Logs

- [ ] Logger não imprime tokens/senhas
- [ ] Sentry configurado para scrub PII
- [ ] Console.log de debug removidos em produção
- [ ] Erros capturados com stack trace (sem dados sensíveis)

### APIs Externas

- [ ] Evolution API acessível apenas do backend
- [ ] MinIO acessível apenas do backend
- [ ] Facebook tokens protegidos por RLS
- [ ] Rate limits configurados adequadamente
- [ ] Timeout em todas as chamadas externas

---

## Checklist de Publicação

### Pré-Deploy

- [ ] `npm run build` — sem erros
- [ ] `npm run lint` — sem erros críticos
- [ ] `npm run test` — todos passam
- [ ] Nenhum `console.log` de debug solto
- [ ] Nenhuma variável de ambiente com "localhost" ou "test"
- [ ] Versão do package.json atualizada
- [ ] Changelog atualizado (se aplicável)
- [ ] Branch está em sync com main

### Banco de Dados

- [ ] Migrations aplicadas em produção
- [ ] Nenhuma migration pendente
- [ ] Backup recente do banco
- [ ] RLS verificado após novas migrations
- [ ] Índices criados para queries novas

### Variáveis de Produção

- [ ] Todas as variáveis de `.env.example` preenchidas
- [ ] Supabase Secrets configurados (Dashboard)
- [ ] Nenhum valor de staging/dev em produção
- [ ] SUPABASE_ENV = 'production'

### Domínio e SSL

- [ ] Domínio configurado e propagado
- [ ] SSL/HTTPS ativo
- [ ] Redirect HTTP → HTTPS
- [ ] CORS configurado corretamente

### Supabase

- [ ] Projeto Supabase em plano adequado
- [ ] Edge Functions deployadas
- [ ] Realtime habilitado
- [ ] Storage buckets existem
- [ ] Auth providers configurados

### WhatsApp

- [ ] Evolution API online e saudável
- [ ] Instâncias de produção conectadas
- [ ] Webhook URL apontando para produção
- [ ] Anti-ban warmup iniciado (D1)
- [ ] Quiet hours configurados

### Webhooks em Produção

- [ ] evolution-webhook URL atualizada na Evolution
- [ ] whapi-webhook URL atualizada na Whapi (se usar)
- [ ] stripe-webhook URL atualizada no Stripe
- [ ] facebook-capi URL configurada

### Monitoramento

- [ ] Sentry DSN configurado
- [ ] Alertas de erro configurados
- [ ] Dashboard de saúde acessível
- [ ] super-admin-alerts configurado

### Testes Finais em Produção

- [ ] Login funciona
- [ ] Dashboard carrega
- [ ] WhatsApp conecta
- [ ] Bot responde (enviar mensagem de teste)
- [ ] Landing page carrega (/:licenca)
- [ ] Mobile funciona
- [ ] PWA instala
- [ ] Service Worker atualiza

### Rollback

- [ ] Commit anterior identificado
- [ ] Sabe como reverter Edge Functions
- [ ] Sabe como reverter migration (se necessário)
- [ ] Feature flags permitem desligar features novas
- [ ] Team sabe o procedimento de rollback
