## Objetivo

Fechar as lacunas de dados iGreen encontradas na auditoria. Hoje o worker captura 20 endpoints mas ~14 estão em "probe only" (não persistem), e ~30 colunas populadas no banco não aparecem em nenhuma tela. Vamos priorizar valor imediato: métricas do consultor, detalhes de telecom/seguros por cliente, campos faltantes em boleto, cashback SEGUROS e alertas.

## Escopo (5 fases sem quebrar o que já funciona)

### Fase 1 — Backend (worker + edge): capturar o que falta

Alvo: `worker-igreen-sync/server.mjs` e `supabase/functions/sync-igreen-customers/index.ts`.

1. Adicionar em `fetchCashback()` a origem `SEGUROS` (junto com GREEN/TELECOM) → grava em nova coluna `cashback_seguros_saldo` de `igreen_consultant_metrics`.
2. Promover de "probe only" para "captura + persistência" os endpoints de maior valor:
  - `GET /painel/onboarding` → JSON em nova coluna `painel_onboarding_json`
  - `GET /painel/inativos` → `painel_inativos_json`
  - `GET /painel/top-expansao` + `/ranking-movements` → `painel_ranking_json`
  - `GET /telecom/resumo-geral` e `/seguros/resumo-geral` → colunas achatadas (`telecom_resumo_json`, `seguros_resumo_json`)
  - `GET /telecom/faturas` já existe → passar a persistir `fatura_status`, `fatura_mes_referencia`, `fatura_valor` no `igreen_telecom_customers` (já tem colunas, só faltava mapear no upsert)
3. Guardar timestamp `last_sync_at` por módulo (`igreen_automation_settings` → colunas `last_sync_*`) para o painel mostrar quando cada bloco foi atualizado.

### Fase 2 — Schema aditivo (migration)

Alterações puramente aditivas (não quebra nada existente):

```sql
ALTER TABLE igreen_consultant_metrics
  ADD COLUMN IF NOT EXISTS cashback_seguros_saldo numeric,
  ADD COLUMN IF NOT EXISTS painel_onboarding_json jsonb,
  ADD COLUMN IF NOT EXISTS painel_inativos_json jsonb,
  ADD COLUMN IF NOT EXISTS painel_ranking_json jsonb,
  ADD COLUMN IF NOT EXISTS telecom_resumo_json jsonb,
  ADD COLUMN IF NOT EXISTS seguros_resumo_json jsonb;
-- customers: campo do cadastro que estava faltando
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS possui_placas boolean;
```

Nada de mudar/remover colunas ou constraints.

### Fase 3 — UI: expor os campos que já existem mas ninguém vê

Alvo: `src/features/produtos/acompanhamento/CarteiraGreenPanel.tsx` e componentes filhos.

1. **BoletosList.tsx** — adicionar: `valor_fornecedora`, `valor_distribuidora`, `tipo_pagamento` e botão "NF" (url_invoice) ao lado de "Boleto".
2. **Novo `ConsultantMetricsCard.tsx**` dentro do Carteira iGreen — exibe (do `igreen_consultant_metrics`):
  - Clientes: total / green / telecom / seguros
  - Rede: licenciados ativos, diretos ativos, GP/GI do mês, tamanho da rede
  - Cadastros: validados / aguardando / devolutivas / cancelados / reprovados / ag. assinatura + kWh validados
  - Cashback: GREEN + TELECOM + SEGUROS (saldo)
3. **Novo `TelecomClientesList.tsx**` e `**SegurosClientesList.tsx**` — tabela expandível por cliente (nome, cidade/UF, licenciado, status, valor mensal, mês ref) usando `igreen_telecom_customers` / `igreen_seguros_customers`. Substitui o mero contador do `MultiprodutoCard`.
4. `**RotinasPanel.tsx**` — lê `rotina_diaria/semanal/mensal` (jsonb) e transforma em cards de tarefas (aniversariantes, esfriando, licenças expirando). Fallback: se estrutura desconhecida, renderiza JSON pretty.
5. `**RedeDashboardCard.tsx**` — usa `painel_onboarding_json`, `painel_inativos_json`, `painel_ranking_json` para 3 mini-blocos (novos, inativos, ranking).
6. Rodapé do painel: badge "Última sync: X min atrás" por módulo.

### Fase 4 — Alertas ligados por padrão (opt-in existente)

`igreen_automation_settings` já tem `auto_wa_boleto_vencendo`, `cross_sell_bot`, `rotinas_tarefas`. Trocar defaults para `true` na coluna default e no fallback `DEFAULT_ON` da edge (mesmo padrão que já foi aplicado nas outras). Nenhum override manual é sobrescrito.

### Fase 5 — Observabilidade

Adicionar aba "Diagnóstico" no `CarteiraGreenPanel` mostrando, para cada um dos 20+ endpoints: última execução, sucesso/erro, latência, registros ingeridos. Fonte: `worker_phase_logs` (já existe).

## Fora de escopo (documentado para depois)

- Pro-builder/analise-pro/analise-retencao/estatisticas-pro — endpoints ainda instáveis; manter em probe.
- OCR de documentos físicos (RG/conta/contrato) — API iGreen retorna 404.
- Extrato financeiro/comissão do consultor — endpoint inexistente.

## Riscos e mitigação

- **Rota do worker** pode retornar shape inesperado nos endpoints novos → cada `fetch*` já grava `raw_json`, então mesmo se o parsing achatado falhar, o dado bruto fica salvo.
- **Timeout** — sync já é assíncrono (`EdgeRuntime.waitUntil`), não muda nada.
- **RLS** das novas colunas — são aditivas em tabelas já com policies; nada a ajustar.
- **Realtime types** — `src/integrations/supabase/types.ts` é auto-gerado; após migration ele atualiza sozinho.

## Ordem de execução

1. Migration (Fase 2) → 2. Worker + Edge (Fase 1) → 3. UI blocos existentes (Fase 3.1, 3.2) → 4. UI listas telecom/seguros (Fase 3.3) → 5. Rotinas + Rede (3.4, 3.5) → 6. Defaults automação (Fase 4) → 7. Diagnóstico (Fase 5).

Cada etapa é independente e pode ser publicada isoladamente. FACA TODAS