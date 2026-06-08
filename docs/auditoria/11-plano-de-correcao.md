# 11 — Plano de Correção por Fases

> Última atualização: 08/06/2026

---

## FASE 1 — Documentação e Organização

**Objetivo:** Limpar o repositório sem alterar funcionalidade.

| Ação | Arquivos | Risco |
|------|----------|-------|
| Mover imagens .webp da raiz para public/images/ | 10 arquivos .webp | BAIXO |
| Mover scripts test-* para pasta tests/ ou .tmp/ | ~10 arquivos na raiz | NENHUM |
| Remover/gitignore screenshots de teste | screenshots/, sim-screenshots/, teste-e2e-screenshots/ | NENHUM |
| Escolher lockfile (bun ou npm) e remover outro | bun.lock vs package-lock.json | BAIXO |
| Verificar se cron_setup.sql é usado | cron_setup.sql na raiz | NENHUM |
| Mover landing components para components/landing/ | ~20 arquivos | BAIXO (atualizar imports) |
| Verificar código morto (AdminFaq, rotas legado) | App.tsx, páginas redirect | BAIXO |

**Não mexer:** Qualquer lógica, integração ou banco.

**Como testar:** `npm run build` passa sem erros.

**Como voltar atrás:** `git revert` do commit.

---

## FASE 2 — Correção de Erros Críticos

**Objetivo:** Eliminar os 2 problemas críticos de segurança.

| Ação | Arquivos | Risco |
|------|----------|-------|
| Remover email hardcoded de super admin | `src/hooks/useWhatsApp.ts` | MÉDIO — testar que super admin ainda funciona |
| Criar role 'super_admin' no banco (se não existir) | Nova migration | BAIXO |
| Mover detecção de super admin para `user_roles` | Hook + backend | MÉDIO |
| Adicionar validação de secret nos webhooks | `evolution-webhook/index.ts`, Evolution config | MÉDIO — precisa configurar na Evolution |

**Não mexer:** Fluxo do bot, IA, envios.

**Como testar:** 
- Super admin acessa normalmente
- Bot continua respondendo
- Webhook rejeita requests sem secret

**Como voltar atrás:** Rollback migration, reverter código.

---

## FASE 3 — Segurança e Supabase

**Objetivo:** Fechar brechas de autorização.

| Ação | Arquivos | Risco |
|------|----------|-------|
| Implementar ProtectedRoute no React Router | `src/App.tsx`, novo componente | BAIXO |
| Auditar Edge Functions sem verify_jwt | `supabase/config.toml`, cada função | MÉDIO |
| Adicionar caller-auth onde necessário | ~5-10 Edge Functions | MÉDIO |
| Verificar RLS da tabela `settings` | Migration ou Dashboard | BAIXO |
| Verificar visibility do bucket `documents` | Supabase Dashboard | BAIXO |
| Habilitar MFA para admins | Supabase Auth config | BAIXO |

**Não mexer:** Lógica de negócio, fluxos do bot.

**Como testar:**
- Todas as rotas admin redirecionam se não autenticado
- Edge Functions retornam 401 se chamadas sem auth
- Dados de um consultor não acessíveis por outro

**Como voltar atrás:** Reverter config + código.

---

## FASE 4 — Fluxos de WhatsApp, Whapi e Evolution

**Objetivo:** Robustez dos fluxos de mensagem.

| Ação | Arquivos | Risco |
|------|----------|-------|
| Decompor useWhatsApp em 4 hooks | `src/hooks/useWhatsApp.ts` → 4 novos | ALTO — refatoração grande |
| Criar cron de cleanup para webhook_message_dedup | Nova Edge Function + migration | BAIXO |
| Criar cron de cleanup para webhook_rate_limit | Mesma função | BAIXO |
| Verificar retry limit nos follow-ups | ai-followup-cron | BAIXO |
| Verificar retry limit no portal-offline-retry | portal-offline-retry | BAIXO |
| Padronizar PORTAL_WORKER_URL (depreciar WORKER_PORTAL_URL) | Edge Functions + env | MÉDIO |

**Não mexer:** Anti-ban, caller-auth, idempotency.

**Como testar:**
- Bot continua respondendo normalmente
- WhatsApp conecta/desconecta corretamente
- Tabelas de dedup são limpas após 7 dias
- Follow-ups param após N tentativas

**Como voltar atrás:** Feature flag → off; reverter código.

---

## FASE 5 — Fluxos de Leads, Clientes e Campanhas

**Objetivo:** Melhorar conversão e organização do CRM.

| Ação | Arquivos | Risco |
|------|----------|-------|
| Organizar components/whatsapp/ em subpastas | ~45 arquivos | BAIXO (imports) |
| Verificar se leads parciais recebem follow-up | ConsultantPage + bot | MÉDIO |
| Verificar captura de fbclid em todas as rotas | lib/fbclid.ts + pages | BAIXO |
| Criar archive para conversations > 90 dias | Nova migration + cron | MÉDIO |
| Dashboard de funil com métricas de abandono | AdminConversao | BAIXO |

**Não mexer:** Lógica de cadastro no portal, bot flow.

**Como testar:**
- Leads continuam entrando
- CRM Kanban funciona
- Analytics de funil corretos

---

## FASE 6 — IA, Automações e Redução de Custo

**Objetivo:** Controlar custos e otimizar uso de IA.

| Ação | Arquivos | Risco |
|------|----------|-------|
| Criar alerta se custo Gemini > threshold | ai-cost-tracker + super-admin-alerts | BAIXO |
| Cache de respostas FAQ frequentes | knowledge-lookup.ts | MÉDIO |
| Verificar multiplicador ×8 de thinking models | ai-gateway.ts | BAIXO (já é seguro, só documentar) |
| Verificar loops em reactivation-cron | reactivation-cron | BAIXO |
| Batch profile pictures (useChats) | useChats.ts | MÉDIO |

**Não mexer:** Modelo de IA, prompts da vendedora, anti-ban.

**Como testar:**
- IA continua respondendo
- Custo não sobe
- Alertas disparam quando esperado

---

## FASE 7 — Conversão e Experiência do Usuário

**Objetivo:** Melhorar taxa de conversão nos pontos críticos.

| Ação | Arquivos | Risco |
|------|----------|-------|
| Analisar abandono no step CPF | ConsultantPage + analytics | ANÁLISE |
| Otimizar CTA da landing page | Components landing | BAIXO |
| Garantir fallback se bot não responde em 30s | evolution-webhook | MÉDIO |
| Notificação push para consultor de lead quente | notifications | BAIXO |
| Verificar tempo de resposta do bot | Bot health + SaudeBot | ANÁLISE |

**Não mexer:** Fluxo core do bot, anti-ban.

---

## FASE 8 — Performance, Logs e Escalabilidade

**Objetivo:** Preparar para crescimento.

| Ação | Arquivos | Risco |
|------|----------|-------|
| Índices para queries lentas | Migrations | BAIXO |
| Archive para outbound_message_log | Migration + cron | BAIXO |
| Monitoramento de latência do webhook | Sentry + custom metrics | BAIXO |
| Decomposição do evolution-webhook (se necessário) | evolution-webhook/ | ALTO |
| CDN para mídia pública | Infra | BAIXO |
| Sanitização de logs em produção | Logger | BAIXO |

---

## FASE 9 — Testes Finais e Publicação

**Objetivo:** Validar tudo antes de considerar "pronto".

| Ação | Risco |
|------|-------|
| Rodar checklist de testes completo | — |
| Rodar checklist de segurança | — |
| Validar em dispositivos móveis | — |
| Load test com volume simulado | — |
| Verificar variáveis de produção | — |
| Rodar build limpo | — |
| Deploy para staging | — |
| Teste de rollback | — |
| Deploy para produção | — |

---

## Regras Gerais

1. **NUNCA executar 2 fases ao mesmo tempo**
2. **Cada fase deve ter um commit separado** (ou branch)
3. **Testar ANTES e DEPOIS de cada fase**
4. **Se algo quebrar, reverter imediatamente** (git revert)
5. **Não mexer em anti-ban, caller-auth ou migrations existentes**
6. **Feature flags para qualquer mudança no bot**
7. **Backup do banco antes das fases 3, 4, 5**
