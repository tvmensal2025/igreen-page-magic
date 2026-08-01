# Auditoria e Correção de Erro — Relatório de Planejamento

**Data:** 2026-08-01 23:32 UTC
**Status:** Planejamento de Auditoria Iniciado
**Aplicação:** iGreen Cloud (React 18 / Vite / Supabase / Deno Edge Functions)

---

## 1. Coleta de Informações Iniciais
*Para prosseguir com a ativação dos sub-agentes, solicitamos ao usuário:*
- **Natureza exata do erro:** Qual comportamento inesperado está ocorrendo agora?
- **Sintomas observados:** Mensagens de erro no console, falhas em rede, UI quebrada ou erro de lógica no WhatsApp/SMS?
- **Impacto esperado:** A correção visa estabilidade de produção, desbloqueio de leads ou ajuste visual?

## 2. Orquestração de Sub-Agentes (Simulação de Especialidades)
O agente principal orquestrará as seguintes frentes de trabalho:

### 🔍 Agente de Análise de Código (Source Auditor)
- **Foco:** Revisão de regressões em `src/lib/multichannelCadenceTexts.ts`, `sofia-post-bill-routing.ts` e drivers de canal.
- **Ferramenta:** `eslint`, `tsgo` e análise estática de tipos.

### 🧪 Agente de Testes (QA Engine)
- **Foco:** Reprodução do erro via Vitest (frontend) e Deno Test (backend/edges).
- **Ferramenta:** `bunx vitest run`, `deno test -A`.

### ⚡ Agente de Performance (Vitals Monitor)
- **Foco:** Verificar se as otimizações de bundle (lazy loading de markdown) e preconnect introduziram delays ou race conditions.
- **Ferramenta:** Playwright (performance timing), análise de bundle Vite.

### 🗄️ Agente de Banco de Dados (DB Warden)
- **Foco:** Auditoria de RLS, Grants e integridade nas tabelas de leads, campanhas e warmup.
- **Ferramenta:** `supabase--linter`, RPCs de diagnóstico.

### ⚙️ Agente de Configuração (Environment Sync)
- **Foco:** Validação de Secrets, Edge Function Deployments e quotas de API (Whapi/Velip).
- **Ferramenta:** `supabase--edge_function_logs`, verificação de conexão.

## 3. Metodologia de Execução
1. **Identificação:** Mapeamento do erro através de logs e evidências.
2. **Isolamento:** Criação de caso de teste que falhe (Red).
3. **Correção:** Implementação da solução (Green).
4. **Refatoração:** Limpeza e auditoria de efeitos colaterais (Refactor).

## 4. Próximos Passos
Aguardando input do usuário sobre o erro específico para disparar a varredura dos sub-agentes.
