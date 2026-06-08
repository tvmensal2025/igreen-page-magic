# 09 — Problemas Encontrados

> Última atualização: 08/06/2026

---

## 🔴 CRÍTICO (pode vazar dados, quebrar sistema ou gerar prejuízo)

### C1 — Super admin por email hardcoded

| Campo | Valor |
|-------|-------|
| Arquivo | `src/hooks/useWhatsApp.ts` (~linha 500) |
| Descrição | Email `rafael.ids@icloud.com` hardcoded como fallback de super admin |
| Por que é problema | Se o email for comprometido, atacante ganha acesso privilegiado |
| Impacto segurança | 🔴 Acesso total ao Whapi + painel super admin |
| Impacto conversão | Indireto |
| Impacto custo | Whapi pago — uso indevido gera custo |
| Como corrigir | Mover para tabela `user_roles` com role 'super_admin' |
| Risco da correção | BAIXO — mudança simples |
| Precisa planejamento? | NÃO — pode corrigir imediatamente |

### C2 — Webhooks sem validação de origem

| Campo | Valor |
|-------|-------|
| Arquivo | `supabase/functions/evolution-webhook/index.ts`, `whapi-webhook/` |
| Descrição | Qualquer IP pode enviar POST para os webhooks — sem validar assinatura ou IP |
| Por que é problema | Atacante pode injetar mensagens fake, criar clientes falsos, acionar IA |
| Impacto segurança | 🔴 Injeção de dados no sistema |
| Impacto conversão | Dados falsos poluem CRM |
| Impacto custo | Cada mensagem fake gasta Gemini tokens |
| Como corrigir | Validar header secret ou IP allowlist da Evolution |
| Risco da correção | BAIXO-MÉDIO — precisa configurar na Evolution também |
| Precisa planejamento? | SIM — testar que webhook legítimo continua funcionando |

---

## 🟠 ALTO (pode afetar vendas, atendimento, automação ou segurança)

### A1 — Sem route guards no React Router

| Campo | Valor |
|-------|-------|
| Arquivo | `src/App.tsx` |
| Descrição | Rotas /admin/*, /super-admin acessíveis sem autenticação (componente carrega, auth é checada depois) |
| Por que é problema | UX ruim + possível exposição momentânea de dados |
| Impacto segurança | 🟠 Código admin carregado sem necessidade |
| Como corrigir | Criar componente ProtectedRoute que verifica auth antes de renderizar |
| Risco da correção | BAIXO |
| Precisa planejamento? | NÃO |

### A2 — Edge Functions sem auth verificada

| Campo | Valor |
|-------|-------|
| Arquivo | `supabase/config.toml` (~15 funções) |
| Descrição | `upload-documents-minio`, `capture-extract`, `embed-knowledge` e outras têm verify_jwt=false sem confirmação de que usam caller-auth |
| Por que é problema | Endpoints possivelmente abertos para qualquer pessoa |
| Impacto segurança | 🟠 Upload de documentos sem validação |
| Como corrigir | Auditar cada função, adicionar caller-auth onde necessário |
| Risco da correção | MÉDIO — precisa testar chamadas internas |
| Precisa planejamento? | SIM |

### A3 — Conversations cresce indefinidamente

| Campo | Valor |
|-------|-------|
| Tabela | `conversations` |
| Descrição | Cada mensagem de bot gera uma linha — sem cleanup ou archive |
| Por que é problema | Performance degrada com o tempo, queries ficam lentas |
| Impacto performance | 🟠 Consultas por customer ficam lentas |
| Como corrigir | Cron de archive para > 90 dias |
| Risco da correção | BAIXO |
| Precisa planejamento? | SIM (precisa validar que não quebra analytics) |

### A4 — useWhatsApp com 870 linhas

| Campo | Valor |
|-------|-------|
| Arquivo | `src/hooks/useWhatsApp.ts` |
| Descrição | Hook único com lógica de conexão, polling, health check, recovery, BroadcastChannel |
| Por que é problema | Impossível manter, testar ou debugar — um bug afeta todo o WhatsApp |
| Impacto | Qualquer correção no WhatsApp é arriscada |
| Como corrigir | Decompor em 4 hooks (conexão, health, polling, recovery) |
| Risco da correção | MÉDIO — refatoração com testes |
| Precisa planejamento? | SIM |

### A5 — Tabelas de dedup/rate limit sem cleanup

| Campo | Valor |
|-------|-------|
| Tabelas | `webhook_message_dedup`, `webhook_rate_limit`, `outbound_message_log`, `ai_cooldown_state` |
| Descrição | Crescem indefinidamente — sem TTL ou cron de limpeza |
| Impacto performance | 🟠 Tabelas ficam grandes → queries lentas |
| Como corrigir | Cron que deleta registros > 7 dias |
| Risco da correção | BAIXO |
| Precisa planejamento? | NÃO |

---

## 🟡 MÉDIO (pode atrapalhar manutenção, organização ou performance)

### M1 — 45 arquivos flat em components/whatsapp/

| Campo | Valor |
|-------|-------|
| Descrição | Pasta com 45+ componentes sem subdivisão clara |
| Como corrigir | Organizar em subpastas: crm/, messaging/, kanban/, templates/ |
| Risco | BAIXO — renomear imports |

### M2 — Imagens .webp na raiz do projeto

| Campo | Valor |
|-------|-------|
| Arquivos | 10 arquivos .webp (club-pj.webp, conexao-*.webp, etc.) |
| Como corrigir | Mover para public/images/ |
| Risco | BAIXO |

### M3 — Scripts de teste avulsos na raiz

| Campo | Valor |
|-------|-------|
| Arquivos | test-evolution-*.ts, test-lead-real.mjs, test-portal-*.mjs, test-gemini-simple.sh |
| Como corrigir | Mover para pasta test/ ou .tmp/ |
| Risco | NENHUM |

### M4 — Três lockfiles (bun.lock, bun.lockb, package-lock.json)

| Campo | Valor |
|-------|-------|
| Descrição | Redundância de package managers |
| Como corrigir | Escolher um (bun ou npm) e remover o outro |
| Risco | BAIXO |

### M5 — PORTAL_WORKER_URL vs WORKER_PORTAL_URL

| Campo | Valor |
|-------|-------|
| Descrição | Dois nomes para a mesma variável de ambiente |
| Impacto | Confusão na configuração |
| Como corrigir | Padronizar para um nome e depreciar o outro |
| Risco | MÉDIO — precisa atualizar edge functions |

### M6 — Landing page components na raiz de components/

| Campo | Valor |
|-------|-------|
| Arquivos | HeroSection, AdvantagesSection, TestimonialsSection, etc. (20 arquivos) |
| Como corrigir | Mover para components/landing/ |
| Risco | BAIXO |

### M7 — Código morto / rotas legado

| Campo | Valor |
|-------|-------|
| Arquivos | AdminFaq (redirect), rotas fluxos-legado, fluxos-antigo, bot-tools, bot-audit |
| Como corrigir | Remover após confirmar que não há links externos |
| Risco | BAIXO |

### M8 — use-toast duplicado

| Campo | Valor |
|-------|-------|
| Locais | src/hooks/use-toast.ts + src/components/ui/use-toast.ts |
| Descrição | Padrão shadcn — possivelmente ambos usados |
| Como corrigir | Verificar qual é importado e unificar |
| Risco | BAIXO |

---

## 🟢 BAIXO (melhorias simples, limpeza ou padronização)

| # | Problema | Local | Correção |
|---|----------|-------|----------|
| B1 | Screenshots versionados no git | screenshots/, sim-screenshots/ | Mover para .gitignore |
| B2 | cron_setup.sql fora das migrations | Raiz | Mover para docs/ ou deletar |
| B3 | ANALISE_COMPLETA_CODIGO.md possivelmente obsoleto | Raiz | Verificar e arquivar |
| B4 | comandos-debug.sh no repo | Raiz | Mover para .tmp/ ou remover |
| B5 | deno.lock possivelmente desnecessário | Raiz | Verificar necessidade |
| B6 | Anon key duplicada em 3 service files | services/ | Importar de client.ts |
| B7 | Fixtures de teste no repo (JPG/PDF) | fixtures/ | OK se necessário para CI |

---

## Resumo Quantitativo

| Prioridade | Quantidade |
|-----------|-----------|
| 🔴 CRÍTICO | 2 |
| 🟠 ALTO | 5 |
| 🟡 MÉDIO | 8 |
| 🟢 BAIXO | 7 |
| **Total** | **22 problemas** |
