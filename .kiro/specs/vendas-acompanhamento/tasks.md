# Implementation Plan: Vendas e Acompanhamento (venda única)

## Overview

Plano de implementação incremental para simplificar o módulo de Produtos num
fluxo de venda única: funil enxuto (até o aceite), valores em centavos,
acompanhamento sem recorrência e ajustes pontuais. A ordem é importante: banco
primeiro, depois edge function e front. Validar com `npx tsc --noEmit` e
`npx vite build` antes de commitar (conforme steering de deploy).

## Tasks

- [x] 1. Migração de banco — valores em centavos
  - Criar migration (via MCP `apply_migration`) adicionando `amount_cents`,
    `discount_cents`, `counter_amount_cents` (bigint) em `sales`, `proposals` e
    `proposal_events`, populando com `round(valor_antigo * 100)` e removendo as
    colunas `numeric` antigas.
  - Conferir contagem de linhas e valores antes/depois para garantir integridade.
  - _Requisitos: 6.1, 6.2, 6.4_

- [x] 2. Migração de banco — funil de 4 etapas
  - Recriar o enum `sale_status` com `interesse | negociando | fechado | perdido`.
  - Converter `sales.status` e `sale_status_history.from_status`/`to_status` com
    `USING` (lead→interesse, capturing/submitted→negociando, active→fechado,
    rejected/cancelled→perdido); trocar `DEFAULT` para `'interesse'`.
  - Atualizar `log_sale_status_change`: carimbar `closed_at` ao virar `fechado`
    ou `perdido`; remover lógica de `submitted_at`/`activated_at`.
  - _Requisitos: 1.1, 1.3, 1.5, 1.6_

- [x] 3. Regenerar tipos do Supabase
  - Gerar `src/integrations/supabase/types.ts` após as migrations 1 e 2.
  - _Requisitos: 6.1, 1.1_

- [x] 4. Helper de dinheiro
  - Criar `src/features/produtos/lib/money.ts` com `formatBRLFromCents`,
    `reaisToCents` e `centsToReais`, com teste unitário (arredondamento, zero,
    valores grandes).
  - _Requisitos: 6.2, 6.3_

- [x] 5. Tipos do front — centavos e novas etapas
  - `vendas/types.ts`: `SaleStatus` (4 etapas), `SALE_STATUS_LABEL`,
    `SALE_STATUS_ORDER`; `amount`→`amountCents` em `Sale`/`SaleRow`/
    `CreateSaleInput`.
  - `orcamento/types.ts`: `amount`→`amountCents`, `discount`→`discountCents`,
    `counterAmount`→`counterAmountCents` em `Proposal`/`ProposalRow`/
    `ProposalEvent`/`CreateProposalInput`/`PublicProposalView`.
  - _Requisitos: 1.1, 6.1_

- [x] 6. Camada de API — mapear centavos e etapas
  - Ajustar `vendas/api.ts` e `orcamento/api.ts` (`mapSaleRow`, `mapProposalRow`,
    `fetchProposalEvents`, inserts/updates) para as colunas `*_cents` e o novo
    enum.
  - _Requisitos: 1.1, 6.1_

- [x] 7. Cálculo de orçamento em centavos + portabilidade
  - `orcamento/catalog.ts`: preços dos planos em centavos (ex.: `5490`);
    `expansao` com `pricingMode: "none"` (não orçável).
  - `orcamento/pricing.ts`: `computeQuoteAmount` e `paymentOptionsToLineItems` em
    centavos; `PlanPricingInput` ganha `portabilidade?: boolean`; usar
    `plan.meta.semPortabilidade` quando sem portabilidade.
  - Atualizar `orcamento/__tests__/pricing.test.ts`.
  - _Requisitos: 5.2, 6.3, 7.1, 7.3_

- [x] 8. Acompanhamento sem recorrência
  - `acompanhamento/aggregate.ts`: nova `FinancialSummary` (`totalFechado`,
    `totalEstimatedCommission`, `pipelineValue`, `proposalsPending`,
    `proposalsAccepted`); remover MRR/único e `inferRevenuePeriod`; somas em
    centavos; fechado = `fechado`.
  - `acompanhamento/AcompanhamentoPanel.tsx`: cards "Total fechado", "Comissão
    estimada", "Pipeline em aberto"; remover card de MRR; usar
    `formatBRLFromCents`.
  - Atualizar `acompanhamento/__tests__/aggregate.test.ts`.
  - _Requisitos: 4.1, 4.2, 4.3, 4.4, 4.5, 6.3_

- [x] 9. Pipeline board — 4 etapas e centavos
  - `crm/SalesPipelineBoard.tsx`: `PIPELINE_STAGES` = 4 etapas; `NEXT_ACTION`,
    agrupamento e KPIs (sem MRR); coluna destaque = `fechado`; valores via
    `formatBRLFromCents`.
  - Ao mover para `perdido`, pedir motivo e enviá-lo no update (gravado em
    `sale_status_history.note`).
  - _Requisitos: 1.1, 1.2, 1.4, 3.3, 6.2_

- [x] 10. Registro manual de fechamento
  - Permitir criar venda manual escolhendo etapa inicial
    (`interesse`/`negociando`/`fechado`), produto, cliente, valor (centavos) e
    observações, reusando `useCreateSale`/`createSale`.
  - _Requisitos: 3.1, 3.2_

- [x] 11. Builder do orçamento — centavos e envio WhatsApp
  - `orcamento/OrcamentoBuilderSheet.tsx`: entradas de valor em centavos ao
    salvar; preview com `formatBRLFromCents`; opção com/sem portabilidade
    (telecom). Preservar geração de link, "Copiar link" e "Enviar no WhatsApp".
  - _Requisitos: 6.3, 7.1, 8.1, 8.2, 8.3_

- [x] 12. Edge function `proposal-respond`
  - Ação `accept`: criar venda em `status: 'fechado'`, copiar `amount_cents`.
  - Ajustar texto da notificação (cadastro oficial é no sistema da empresa).
  - Atualizar leituras/escritas de valor para `*_cents`.
  - _Requisitos: 2.1, 2.2, 2.4, 2.5, 2.6_

- [x] 13. Validação de captura por família (leve)
  - Validar `capture_data` no form de venda manual com os schemas Zod de
    `captura/schemas.ts` quando aplicável. Baixa prioridade.
  - _Requisitos: 7.2_

- [x] 14. Verificação e deploy
  - Rodar `npx tsc --noEmit`, `npx vite build` (exit 0) e os testes unitários do
    módulo; corrigir o que aparecer.
  - Commit + push e disparar deploy da edge `proposal-respond` via GitHub Actions
    (steering de deploy); confirmar `updated_at` recente no Supabase.
  - Teste manual ponta a ponta: criar orçamento → enviar WhatsApp (instância de
    teste) → aceitar no link → confirmar venda em "Fechado" e métricas corretas.
  - _Requisitos: 1.3, 2.1, 2.2, 4.1, 8.4_

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "tasks": ["1", "2", "4"],
      "description": "Migrations de banco (centavos, enum) e helper de dinheiro — sem dependências entre si."
    },
    {
      "wave": 2,
      "tasks": ["3"],
      "description": "Regenerar tipos do Supabase (depende das migrations 1 e 2)."
    },
    {
      "wave": 3,
      "tasks": ["5"],
      "description": "Tipos do front (depende dos tipos gerados em 3)."
    },
    {
      "wave": 4,
      "tasks": ["6"],
      "description": "Camada de API (depende dos tipos do front em 5)."
    },
    {
      "wave": 5,
      "tasks": ["7", "8", "9", "10", "11", "12"],
      "description": "Pricing, acompanhamento, pipeline, registro manual, builder e edge — dependem de 4/5/6 e podem ser paralelos."
    },
    {
      "wave": 6,
      "tasks": ["13"],
      "description": "Validação de captura (opcional, baixa prioridade)."
    },
    {
      "wave": 7,
      "tasks": ["14"],
      "description": "Verificação (tsc/build/testes) e deploy — depende de tudo."
    }
  ]
}
```

## Notes

- Sem integração de pagamento e sem RLS novo (colunas renomeadas herdam as
  policies existentes).
- `points_kwh` não muda (é pontuação, não dinheiro).
- `amount_period` é mantido por compatibilidade, mas ignorado nas métricas.
- Deploy de edge function é só via GitHub Actions (CLI local não está logado),
  conforme o steering de deploy.
- Migrations de banco aplicam na hora via MCP `apply_migration`.
