
# Sincronização Total iGreen — todos os consultores, todas as páginas

Objetivo: adicionar botão "Sincronizar TODOS" no admin, garantir que cada página do portal (Clientes Green, Telecom, Seguros, Rede) seja coletada por completo (com paginação máxima e histórico total), e persistir cada campo no lugar certo — sem quebrar o fluxo atual (single-consultant continua funcionando igual).

---

## 1. Novo botão "Sincronizar TODOS" (admin)

- Novo componente `IGreenBulkSyncPanel.tsx` na aba admin (perto do `IGreenSyncStatusBar`).
- Lista consultores elegíveis (têm `portal_email`+`portal_password` em `consultants` ou credenciais em vault).
- Fila client-side com concorrência 1 (portal não gosta de paralelo) chamando a edge `sync-igreen-customers` uma vez por consultor.
- Progresso ao vivo: `X/Y concluídos, atual: tvmensal12`, com log dos gaps detectados por consultor.
- Botões: "Sincronizar todos", "Retomar falhas", "Cancelar".
- Persistência do estado da fila em `app_settings` (chave `igreen_bulk_sync_state`) para sobreviver a refresh.
- Nenhum cron/agendado nesta fase — 100% manual como pedido.

## 2. Cobertura página por página

Para cada página do portal, adicionar as rotas faltantes ao worker com paginação `perPage=100` até esvaziar, e loop `mes_referencia` desde o primeiro registro (usar `/resumo-geral` para descobrir range).

### 2a. Clientes Green (`/clientes-green`)
Confirmar/estender coletas:
- `/crm/green` (Kanban — já ok)
- `/clientes-green?status=todos&injecao=todos&tipo=todos` — lista mestre (pagina)
- `/clientes-green/boletos` — histórico mensal (loop de meses)
- `/clientes-green/boletos/{idcliente}` — ficha completa por cliente (enrich)
- `/clientes-green/devolutivas` + `/clientes-green/devolutivas-resolvidas`
- `/clientes-green/faturas`, `/clientes-green/injecao`, `/clientes-green/summary`
- Persistência: `customers` (perfil + situacao), `igreen_customer_boletos` (todos os meses), `igreen_customer_devolutivas`.
- Novo campo `historico_completo_at` em `customers` para marcar que já foi feito full-history uma vez.

### 2b. Telecom (`/produtos/telecom`)
- `/crm/telecom` (Kanban — ok)
- `/telecom/clientes?status=todos` (pagina) → tabela principal `igreen_telecom_customers`
- `/telecom/linhas?status=todos` (pagina) → nova coluna `linhas` (jsonb) em `igreen_telecom_customers` OU nova tabela `igreen_telecom_linhas` (a escolher — plano: adicionar tabela dedicada)
- `/telecom/faturas` (pagina, todos meses)
- `/telecom/comissoes`, `/telecom/portabilidade`, `/telecom/recargas`, `/telecom/bonus`, `/telecom/client-map`, `/telecom/licenciados`
- Nova tabela `igreen_telecom_faturas` (id, consultant_id, idcnxtelecom, mes, valor, status, raw jsonb).
- Nova tabela `igreen_telecom_comissoes` (para casar com carteira do consultor).

### 2c. Seguros (`/seguros`)
- `/crm/seguros` (Kanban — ok)
- `/seguros/apolices?status=todos` (pagina)
- `/seguros/clientes?status=todos` (pagina)
- `/seguros/comissoes`, `/seguros/sinistros`, `/seguros/renovacoes`, `/seguros/cashback/resumo`, `/seguros/licenciados`
- Tabela atual `igreen_seguros_customers` recebe: `apolice_id`, `sinistros` (jsonb), `renovacao_prevista_at`, `cashback_previsto_cents`.
- Nova tabela `igreen_seguros_comissoes` para carteira do consultor.

### 2d. Rede / Licenciados + Resumos gerais
- `/clientes-green/resumo-geral`, `/telecom/resumo-geral`, `/seguros/resumo-geral`, `/estatisticas-pro` → já vão em `igreen_consultant_metrics`; adicionar colunas faltantes (`telecom_ativos_total`, `seguros_apolices_total`, `rede_ranking_pos`).
- `/network` + `/telecom/licenciados` + `/seguros/licenciados` → mesclar em `network_members` com flag `produtos` (jsonb) indicando em quais produtos o licenciado está ativo.
- Painéis: onboarding, inativos, ranking → tabela nova `igreen_network_snapshots` (mes_referencia, consultant_id, jsonb) para timeline.

## 3. Gaps & diagnósticos

- Estender `igreen_sync_runs.counts.extras` para conter, por produto: `summary_total`, `rows_paginated`, `rows_saved`, `pages_read`, `gap`, `gap_reason`.
- `IGreenSyncStatusBar` ganha seção "Gaps por página" listando exatamente qual rota deu diferença.
- Log estruturado no worker: `[telecom.clientes] page=3 perPage=100 got=27 total_seen=227`.

## 4. Migrações (Supabase, com GRANTs)

Criar em uma única migração:
- `igreen_telecom_linhas`
- `igreen_telecom_faturas`
- `igreen_telecom_comissoes`
- `igreen_seguros_comissoes`
- `igreen_network_snapshots`
- ALTER TABLE nas existentes só ADD COLUMN (sem drop) para não quebrar código atual.
- Cada CREATE TABLE seguido de GRANT para `authenticated`/`service_role` e RLS via `has_role(auth.uid(),'admin')` (já é o padrão do projeto).

## 5. Frontend — mostrar tudo no lugar certo

- `CustomerManager.tsx` (aba Telecom): passa a ler `igreen_telecom_faturas` para mostrar histórico de faturas por cliente, e `igreen_telecom_linhas` para mostrar linhas ativas.
- `CustomerManager.tsx` (aba Seguros): mostra ap ólice + sinistros + renovação prevista.
- `DashboardTab.tsx`: adiciona painel "Cobertura de sync por consultor" (X/Y com gaps).
- Invalidação de cache: adicionar as novas queryKeys em `refreshIgreenQueries`.

## 6. Segurança & desempenho (não quebrar nada)

- Todas as novas rotas do worker envolvidas em `try/catch` individual — se uma quebrar, as outras continuam (padrão já usado no `sync-all`).
- Timeout do worker sobe para 8 min só quando `mode=full_history=true`; default continua 4-6 min.
- Rate limit no worker: mínimo 250ms entre requisições ao portal por consultor.
- Feature flag `igreen.full_history_enabled` em `app_settings` (default true, permite desligar rápido).

---

## Detalhes técnicos

- Worker (`worker-igreen-sync/server.mjs`): novas fns `fetchTelecomLinhas`, `fetchTelecomFaturas`, `fetchTelecomComissoes`, `fetchSegurosComissoes`, `fetchSegurosSinistros`, `fetchClientesGreenHistorico`. Todas usam helper `paginate(session, path, params)` já existente (linha ~132) — estender para aceitar `maxPages: Infinity` quando `full_history=true`.
- Edge (`supabase/functions/sync-igreen-customers/index.ts`): novo `persistTelecomLinhas`, `persistTelecomFaturas`, etc.; upsert com `onConflict` estável (`consultant_id, idcnxtelecom, mes_referencia`).
- Bulk runner: nova edge `sync-igreen-bulk` que só enfileira e chama a existing `sync-igreen-customers` por consultor (não duplica lógica).
- UI: `IGreenBulkSyncPanel` usa `supabase.functions.invoke('sync-igreen-bulk', { mode:'queue', consultant_ids:[...] })` e poll em `igreen_sync_runs` filtrando pelos ids.

## Ordem de execução (para não quebrar)

1. Migração (novas tabelas + colunas com default seguro).
2. Worker: adicionar novas fns SEM remover as atuais.
3. Edge: adicionar novos persist SEM alterar os antigos.
4. Testar sync single-consultant `tvmensal12` — precisa continuar igual + preencher novas tabelas.
5. Criar edge `sync-igreen-bulk` + UI do painel.
6. Rodar bulk num subset (3 consultores) → validar → liberar geral.

## Fora deste plano

- Cron automático (usuário pediu só botão manual agora).
- Refatorar código legado do CRM Kanban (continua como fonte primária para status).
- Mudanças visuais além do painel bulk e das seções novas de histórico.
