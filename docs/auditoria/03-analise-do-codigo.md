# 03 — Análise do Código

> Última atualização: 08/06/2026

---

## 1. Páginas (src/pages/)

| Página | Função | Observação |
|--------|--------|------------|
| Auth.tsx | Login/cadastro | Simples, funcional |
| Admin.tsx | Dashboard consultor | Tab-based, carrega hooks pesados |
| SuperAdmin.tsx | Painel super admin | Boa separação |
| ConsultantPage.tsx | Página pública | Multi-step, boa UX |
| WhatsAppClientsPage.tsx | CRM WhatsApp | Complexo, muitos componentes |
| FluxoBuilder.tsx | Editor visual de fluxos | Usa @xyflow/react |
| AdminMetaAds.tsx | Gestão de ads | Completo |
| LicenciadaPage.tsx | Landing parceiro | OK |
| CadastroPage.tsx | Cadastro público | Form multi-step |
| SaudeBot.tsx | Saúde do bot | Monitoramento |
| SaudeProducao.tsx | Saúde produção | Monitoramento global |
| AdminConversao.tsx | Analytics conversão | Gráficos |
| AdminReaquecimento.tsx | Reaquecimento leads | Fluxo específico |
| AdminKnowledge.tsx | Base de conhecimento IA | FAQ + embeddings |

**Problemas identificados:**
- ⚠️ Nenhuma página tem guarda de rota no nível do router — autenticação verificada internamente por hooks
- ⚠️ Algumas páginas redirecionam (AdminFaq, admin/fluxos-legado) — possível código morto

---

## 2. Componentes (src/components/)

### 2.1 Componentes UI (src/components/ui/) — 56 arquivos
- Primitivos shadcn/ui padronizados ✅
- **NÃO DEVEM SER EDITADOS** a menos que seja necessário customizar

### 2.2 Componentes WhatsApp (src/components/whatsapp/) — 45+ arquivos
- CRM completo: chat, kanban, bulk send, templates, voice, scheduling
- **Problema:** 45 arquivos numa pasta flat — difícil navegar
- **Problema:** `WhatsAppDashboard.tsx` provavelmente é o componente-raiz mais pesado

### 2.3 Componentes Admin (src/components/admin/) — 80+ arquivos
- Bem organizado em subpastas (ads/, ai/, dashboard/, flow-builder/)
- **Problema:** `admin/ads/` tem 34 arquivos — muito grande

### 2.4 Componentes Captação (src/components/captacao/) — 25 arquivos
- Sistema gamificado de coleta de documentos
- Funcional e bem separado

### 2.5 Landing page (raiz de components/) — 20 arquivos
- HeroSection, AdvantagesSection, etc.
- **Problema:** Deveriam estar em `components/landing/`

---

## 3. Hooks (src/hooks/) — 50+ arquivos

### Hooks Críticos

| Hook | Linhas | Função | Problema |
|------|--------|--------|----------|
| useWhatsApp.ts | ~870 | Conexão + estado WhatsApp | ⚠️ MUITO GRANDE |
| useChats.ts | ~280 | Lista de chats | Lógica complexa de dedup |
| useMessages.ts | ~250 | Mensagens + envio | Auto-takeover embutido |
| useAdminAuth.ts | ~130 | Sessão + consultant | Auto-cria consultant |
| useKanbanDeals.ts | ~200 | CRM kanban | Deals sintéticos |
| useBotFunnel.ts | ~60 | Analytics funil | OK |
| useConsultant.ts | ~40 | Dados públicos | OK |
| useUserRole.ts | ~55 | Verificação role | OK |

**Problemas globais:**
- `useWhatsApp.ts` deveria ser decomposto em 3-4 hooks menores (conexão, health, polling, recovery)
- Hook `use-toast.ts` existe DUPLICADO em `hooks/` e `components/ui/`
- Regras de negócio (auto-takeover, bot pause) estão dentro de hooks de UI

---

## 4. Services (src/services/) — 11 arquivos

| Serviço | Função | Qualidade |
|---------|--------|-----------|
| evolutionApi.ts | Proxy Evolution | ✅ Bem feito, com retry e error classes |
| whapiApi.ts | Proxy Whapi | ✅ Segue mesmo padrão |
| messageSender.ts | Pipeline unificado | ✅ Rate limit + validação |
| facebookAds.ts | Meta Ads | ✅ Completo |
| expressCampaign.ts | Campanha express | OK |
| minioUpload.ts | Upload mídia | OK |
| adImageLibrary.ts | Biblioteca imagens | OK |
| adTemplates.ts | Templates de ads | OK |
| smartPublish.ts | Publicação inteligente | OK |
| resetConversation.ts | Reset conversa | Simples |

**Problema:** evolutionApi.ts e whapiApi.ts duplicam o SUPABASE_PUBLISHABLE_KEY como fallback hardcoded em vez de importar do client.ts

---

## 5. Lib (src/lib/) — 20+ arquivos

| Módulo | Função |
|--------|--------|
| utils.ts | cn() do Tailwind + helpers |
| logger.ts | Logger estruturado com níveis |
| captureGame.ts | Lógica do jogo de captação |
| flowSimulator.ts | Simulação de fluxo |
| flowStepResolver.ts | Resolução de steps |
| dddToUf.ts | Mapeamento DDD → UF |
| fbclid.ts | Captura de fbclid |
| materialsCatalog.ts | Catálogo de materiais |
| mediaHash.ts | Hash de mídia |
| opusRecorderLoader.ts | Loader de gravador de áudio |
| adGlossary.ts | Glossário de ads |
| adPolicyRules.ts | Regras Meta Ads |
| adQualityScore.ts | Score de qualidade |
| haptics.ts | Vibração mobile |
| captureSfx.ts | Efeitos sonoros |

**Avaliação:** Bem organizado, cada arquivo com responsabilidade clara.

---

## 6. Edge Functions (_shared/) — 85+ arquivos

### Módulos Críticos

| Módulo | Função | Risco |
|--------|--------|-------|
| caller-auth.ts | Auth IDOR entre funções | 🔴 Se falhar, expõe dados |
| evolution-api.ts | Comunicação c/ Evolution | 🔴 Bot para se quebrar |
| anti-ban.ts | Proteção anti-ban | 🔴 Ban do WhatsApp |
| ai-gateway.ts | Gateway IA (Lovable) | 🟡 Custo alto se descontrolado |
| customer-lock.ts | Serialização por cliente | 🟡 Race conditions se falhar |
| idempotency.ts | Prevenção de duplicatas | 🟡 Mensagens duplicadas |
| feature-flag.ts | Feature flags com cache | ✅ Bem feito |
| flow-router.ts | Roteamento de engine | 🟡 Define qual motor responde |

### Subsistemas

| Pasta | Função |
|-------|--------|
| `_shared/bot/` | Kill switch, dedup, pause, orchestrator gate |
| `_shared/engine/` | Motor v3 do flow (novo) |
| `_shared/vendedora/` | IA vendedora conversacional |
| `_shared/channels/` | Abstração Evolution/Whapi |
| `_shared/captation/` | Alertas e atribuição de leads |
| `_shared/pipeline-cadastro/` | Pipeline de cadastro no portal |

**Observação:** A quantidade de módulos compartilhados é impressionante. Boa modularidade, mas carga cognitiva alta.

---

## 7. Duplicações Identificadas

| Duplicação | Onde | Impacto |
|------------|------|---------|
| Anon key hardcoded | evolutionApi.ts, whapiApi.ts, client.ts | BAIXO (é publishable) mas frágil |
| use-toast.ts | hooks/ e components/ui/ | BAIXO (shadcn pattern) |
| PORTAL_WORKER_URL vs WORKER_PORTAL_URL | .env.example, edge functions | MÉDIO (confuso) |
| Lógica de normalizePhone | utils.ts, vários hooks | BAIXO |

---

## 8. Código Morto Potencial

| Arquivo/Código | Indicação |
|----------------|-----------|
| `src/pages/AdminFaq.tsx` | Redireciona para /admin/conhecimento — morto |
| `test-*.ts/mjs/sh` na raiz | Scripts de teste avulsos — não fazem parte do CI |
| `cron_setup.sql` na raiz | SQL fora das migrations — possivelmente desatualizado |
| `ANALISE_COMPLETA_CODIGO.md` | Análise anterior — pode estar obsoleta |
| `comandos-debug.sh` | Scripts debug — não devem ir para produção |
| Rotas legado (fluxos-legado, fluxos-antigo) | Redirects — podem ser removidos após migração |

---

## 9. Regras de Negócio Espalhadas

| Regra | Onde deveria estar | Onde está |
|-------|-------------------|-----------|
| Auto-takeover (pausa bot ao enviar manual) | Edge Function | useMessages.ts (frontend) |
| Super admin por email | Banco (user_roles) | useWhatsApp.ts (hardcoded email) |
| Validação de CPF | Edge Function + Frontend | conversation-helpers.ts (backend only) |
| Rate limit por contato | Edge Function | messageSender.ts (frontend, in-memory) |
| Geração de slug | Backend | useAdminAuth.ts (frontend) |

---

## 10. Resumo Qualitativo

| Aspecto | Nota | Justificativa |
|---------|------|---------------|
| Organização geral | 7/10 | Boa separação, mas pastas cresceram demais |
| Qualidade do código | 7/10 | Bem escrito, mas hooks enormes |
| Segurança backend | 8/10 | caller-auth robusto, anti-ban excelente |
| Segurança frontend | 5/10 | Sem route guards, super admin por email |
| Testes | 4/10 | Existem property tests mas cobertura baixa |
| Documentação inline | 7/10 | Bons comentários nos arquivos críticos |
| Manutenibilidade | 6/10 | 120+ edge functions é muita coisa para manter |
