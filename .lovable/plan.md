# Auditoria — Fluxo D (Whapi), Fluxo B (IA livre) e Pipeline de Cadastro

Objetivo: mapear, testar e produzir um relatório executivo do estado real do sistema de fluxo conversacional + cadastro, identificando o que está funcionando, o que está quebrado/silenciosamente degradado e o que está obsoleto.

## Escopo

1. **Fluxo D (Whapi)** — entrada principal hoje
   - `whapi-webhook` (handlers, state-machine conversacional)
   - `whapi-proxy`, `_shared/whapi-api.ts`
   - `_shared/flow-router.ts`, `resolve-flow.ts`, `pick-flow-variant.ts`
   - Crons: `flow-d-health-cron`, `flow-d-stuck-watchdog`, `bot-stuck-recovery`, `bot-loop-watchdog`, `bot-followup-checker`
   - Specs já existentes: `flow-d-retry-rules-fix`, `fluxo-d-auditoria`, `captacao-fluxo-d-conversao`

2. **Fluxo B (IA livre + base de conhecimento)**
   - Edge function `fluxo-b-ai`
   - Página admin `src/pages/AdminFluxoB.tsx`
   - Base de conhecimento: `ai_knowledge_sections`, `embed-knowledge`, `faq-organizer`
   - Verificar se ainda é roteado em produção ou se foi descontinuado pelo Fluxo D

3. **Pipeline de Cadastro**
   - `_shared/pipeline-cadastro/registry.ts` + testes
   - `_shared/bot/cadastro-intent.ts`
   - `capture-extract`, `finalize-capture`, `igreen-ingest-customers`, `igreen-ingest-xlsx`
   - Workers `worker-portal`, `worker-portal-2`, `worker-igreen-sync`
   - Tabelas: `customer_flow_state`, `customers`, `capture_*`, `portal2_audit_traces`

4. **Gates/segurança comuns**
   - `_shared/bot/kill-switch-gate.ts`, `global-flag.ts`, `paused.ts`, `orchestrator-gate.ts`, `ai-cooldown.ts`
   - `force_bot_phones`, `app_settings`, `rollout_config`

## Metodologia

Para cada um dos três blocos:

1. **Mapeamento estático**
   - Ler entrypoints + handlers + helpers
   - Diagrama em ASCII do fluxo de mensagem (webhook → router → state-machine → cadastro → resposta)
   - Listar dependências (tabelas, secrets, funções chamadas)

2. **Testes automatizados existentes**
   - Rodar `supabase--test_edge_functions` nos módulos: `whapi-webhook`, `fluxo-b-ai`, `pipeline-cadastro`, `bot/*`, `flow-router`
   - Anotar falhas, testes pulados, cobertura visível

3. **Smoke test ao vivo (read-only + chamadas idempotentes)**
   - `supabase--curl_edge_functions` em endpoints de health: `flow-d-health-cron`, `bot-health-intel`, `bot-audit-runner`, `bot-e2e-runner` (modo dry-run se suportado)
   - `supabase--edge_function_logs` últimas 24h para: `whapi-webhook`, `fluxo-b-ai`, `flow-d-stuck-watchdog`, `bot-stuck-recovery`, `capture-extract`, `finalize-capture` — contar erros/warns
   - Query em `engine_logs`, `bot_flow_audit_log`, `flow_d_health_runs`, `inbound_media_failures`, `worker_phase_logs` para taxa de erro recente

4. **Sanidade de dados**
   - `customer_flow_state` parados há >24h por estágio
   - `customers` com cadastro incompleto vs concluído (última semana)
   - `bot_flows` ativos e `flow_variants` em rollout
   - Verificar se algum cliente recente caiu no Fluxo B vs Fluxo D

5. **Validação do Fluxo B especificamente**
   - Confirmar se está sendo chamado por alguém (grep no webhook + logs)
   - Se a base de conhecimento (`ai_knowledge_sections`) tem conteúdo
   - Se há rota ativa ou se virou legado

## Entregável

Um único relatório em `.kiro/specs/auditoria-fluxos-2026-06/report.md` com:

- Resumo executivo (3-5 bullets, status semáforo 🟢🟡🔴)
- Por bloco (D, B, Cadastro): arquitetura, o que funciona, o que falha, evidências (logs/queries), recomendações priorizadas
- Tabela de funções edge auditadas: nome, status, último erro, ação sugerida
- Lista de itens obsoletos a remover/arquivar
- Próximos passos sugeridos (sem implementar ainda)

Sem alterações de código nesta etapa — apenas leitura, queries e chamadas idempotentes. Qualquer correção vira spec separada após sua aprovação do relatório.

## Detalhes técnicos

- Ferramentas: `code--view`, `code--exec` (rg/ls), `supabase--read_query`, `supabase--analytics_query`, `supabase--edge_function_logs`, `supabase--test_edge_functions`, `supabase--curl_edge_functions`
- Nenhuma migração, nenhum deploy, nenhum secret novo
- Tempo estimado de execução: ~15-20 chamadas de ferramenta em paralelo por bloco
