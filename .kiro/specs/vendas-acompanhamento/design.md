# Design — Vendas e Acompanhamento (venda única)

## Visão geral

O módulo já existe e funciona de ponta a ponta. Este design **não reconstrói** —
ele **simplifica e ajusta** o que está pronto, em quatro frentes:

1. **Funil enxuto** (`sale_status`): de 6 etapas (pensadas em pós-venda) para 4
   etapas até o aceite (Interesse, Negociando, Fechado, Perdido).
2. **Dinheiro em centavos**: trocar colunas `NUMERIC` por inteiros `*_cents` e
   ajustar tipos/cálculos/UI.
3. **Acompanhamento sem recorrência**: remover MRR e a separação mensal/único.
4. **Ajustes pontuais**: catálogo vendável (Expansão), telecom sem
   portabilidade, validação de captura.

O fluxo principal (montar orçamento → enviar link pelo WhatsApp → cliente aceita
→ vira "Fechado") já está implementado e será **preservado**, com a única
mudança de que o aceite passa a marcar **Fechado** (não mais "capturing").

### Arquitetura atual (preservada)

```
Consultor (painel)                  Cliente (link público)
  │                                   │
  ├─ OrcamentoBuilderSheet            │
  │   └─ createProposal ──► proposals │
  │   └─ sendWhatsAppMessage ─────────┼──► link /proposta/:token
  │                                   │
  │                                   ├─ proposal-public-get (edge, service_role)
  │                                   └─ proposal-respond (edge, service_role)
  │                                        └─ accept → cria sales + notifica
  │                                                                  │
  ├─ SalesPipelineBoard ◄── sales ◄────────────────────────────────┘
  └─ AcompanhamentoPanel ◄── sales + proposals (métricas)
```

Camadas por feature (mantidas): `types.ts` → `api.ts` → `hooks.ts` →
componentes. Toda a comunicação com o banco é tipada e passa pela `api.ts`.

---

## 1. Funil de vendas simplificado

### Decisão

Novo conjunto de etapas do enum `sale_status`:

| Nova etapa    | Significado                                   | Etapas antigas que mapeiam |
|---------------|-----------------------------------------------|----------------------------|
| `interesse`   | Lead/interesse registrado                     | `lead`                     |
| `negociando`  | Proposta enviada, em conversa/negociação      | `capturing`, `submitted`   |
| `fechado`     | Cliente aceitou — fim do acompanhamento       | `active`                   |
| `perdido`     | Não fechou (recusa/cancelamento/desistência)  | `rejected`, `cancelled`    |

> Mantemos nomes em português no enum para alinhar com o domínio e o restante
> do projeto. O `closed_at` passa a marcar a data do **aceite/fechamento**.

### Migração de enum (estratégia segura)

Postgres não remove valores de enum facilmente. Como há **poucos dados** (1
venda hoje) e queremos um enum limpo, a abordagem é **recriar o tipo**:

1. Criar `sale_status_new` com os 4 valores.
2. Adicionar coluna temporária ou usar `ALTER COLUMN ... TYPE` com `USING` que
   traduz os valores antigos para os novos (`lead→interesse`, `capturing`/
   `submitted→negociando`, `active→fechado`, `rejected`/`cancelled→perdido`).
3. Aplicar o mesmo `USING` em `sale_status_history.from_status`/`to_status`.
4. Trocar o `DEFAULT` da coluna `status` para `'interesse'`.
5. Dropar o enum antigo e renomear `sale_status_new` → `sale_status`.
6. Recriar a função `log_sale_status_change` para carimbar `closed_at` quando
   `status` vira `fechado` ou `perdido` (substitui a lógica de submitted/active).

Tudo isso vai numa migration única, idempotente onde possível, aplicada via MCP
`apply_migration`.

### Motivo de perda (Perdido)

Reaproveitar `sales.notes` para o motivo, ou registrar via
`sale_status_history.note`. **Decisão**: usar `note` no histórico quando move
para `perdido` (campo já existe, mantém auditoria). A UI passa o motivo na
mutação de status.

### Impacto no front

- `vendas/types.ts`: `SaleStatus`, `SALE_STATUS_LABEL`, `SALE_STATUS_ORDER`.
- `crm/SalesPipelineBoard.tsx`: `PIPELINE_STAGES`, `NEXT_ACTION`, agrupamento e
  KPIs passam a usar as 4 etapas. A coluna "destaque" (cartão escuro/gold) passa
  a ser `fechado`.
- `acompanhamento/aggregate.ts`: status considerado "fechado" muda de `active`
  para `fechado`; `salesCapturing` deixa de existir.

---

## 2. Valores monetários em centavos

### Colunas afetadas

| Tabela            | Coluna antiga (`numeric`) | Coluna nova (`bigint`)   |
|-------------------|---------------------------|--------------------------|
| `sales`           | `amount`                  | `amount_cents`           |
| `proposals`       | `amount`                  | `amount_cents`           |
| `proposals`       | `discount`                | `discount_cents`         |
| `proposal_events` | `counter_amount`          | `counter_amount_cents`   |

> `points_kwh` **não** é dinheiro (é pontuação kWh) — permanece `numeric`.

### Migração de dados

Para cada coluna: adicionar a nova coluna `*_cents bigint`, popular com
`round(old * 100)`, e remover a coluna antiga. Como há poucos registros (10
propostas, 1 venda, 5 eventos), o risco é baixo. Migration via `apply_migration`.

### Convenção no código

- **Armazenar/transportar**: sempre `*_cents` inteiro.
- **Calcular**: tudo em centavos; arredondar só no fim (`Math.round`).
- **Exibir**: helper único `formatBRLFromCents(cents)` →
  `(cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })`.
- **Entrada do usuário**: ao digitar reais, converter para centavos com
  `Math.round(reais * 100)` no momento de salvar.

### Impacto no front

- `vendas/types.ts` e `orcamento/types.ts`: `amount` → `amountCents`, etc., e os
  mapeadores em `api.ts`.
- `orcamento/pricing.ts`: `computeQuoteAmount` e `paymentOptionsToLineItems`
  passam a trabalhar em centavos; o catálogo (`catalog.ts`) define preços em
  centavos (`5490` em vez de `54.9`).
- `acompanhamento/aggregate.ts`: somas em centavos (remove `round2` de float).
- Componentes: usar `formatBRLFromCents`. Criar helper em
  `produtos/lib/money.ts` (ou em `theme`/util já existente).
- Edge `proposal-respond`: copia `amount_cents` para a venda.

---

## 3. Acompanhamento sem recorrência

### Decisão

Simplificar `computeFinancialMetrics` e `AcompanhamentoPanel`:

- **Remover**: `mrrActive`, `oneTimeActive`, `pipelineMrr`/`pipelineOneTime`
  separados, `inferRevenuePeriod`, `salesCapturing`.
- **Manter/renomear**:
  - `totalFechado` (soma de `amount_cents` das vendas `fechado`).
  - `totalEstimatedCommission` (comissão estimada das fechadas).
  - `pipelineValue` + `proposalsPending` (orçamentos aguardando resposta — um só
    número, sem separar mensal/único).
  - `proposalsAccepted`.

`estimateCommission` continua, mas a base passa a ser o valor da venda em
centavos; regras `recurring_percent`/`royalties_percent` deixam de ter
conotação mensal (é venda única) — aplicam o percentual sobre o valor fechado.

### Impacto no front

- `acompanhamento/aggregate.ts`: nova forma de `FinancialSummary` e funções.
- `acompanhamento/AcompanhamentoPanel.tsx`: cards passam a mostrar "Total
  fechado", "Comissão estimada", "Pipeline em aberto". Remove o card de MRR.
- Os testes em `acompanhamento/__tests__/aggregate.test.ts` serão atualizados.

---

## 4. Aceite marca "Fechado" (edge function)

### Decisão

Em `proposal-respond`, ação `accept`:

- Cria a venda com `status: 'fechado'` (hoje `'capturing'`).
- Copia `amount_cents` da proposta.
- Mantém o cálculo de `points_kwh` atual (proxy por unidade) — o consultor não
  ajusta mais depois, então o valor é só informativo.
- A notificação ao consultor passa a indicar que o **cadastro oficial** é feito
  no sistema da empresa (texto ajustado).

`closed_at` é carimbado pelo trigger ao entrar em `fechado`.

---

## 5. Catálogo vendável e ajustes de cálculo

### Expansão (Requisito 5)

`expansao` não gera orçamento. Ajuste em `orcamento/catalog.ts`:

- A allowlist `QUOTABLE_PRODUCT_SLUGS` já exclui Expansão — manter.
- Corrigir o `FAMILY_COMMERCIAL.expansao` para um modo explícito sem planos
  (ex.: novo `pricingMode: "none"` que o builder trata como "não orçável"), em
  vez de `plan_monthly` com `plans: []`. O builder já filtra por slug, mas o
  ajuste evita estado inconsistente se a família for usada por outro caminho.

### Telecom sem portabilidade (Requisito 7.1)

Hoje `computeQuoteAmount` usa só `plan.price`. Ajuste:

- Adicionar ao builder a opção "com/sem portabilidade".
- Quando sem portabilidade, usar `plan.meta.semPortabilidade` (já existe no
  catálogo) como preço; senão, `plan.price`.
- `PlanPricingInput` ganha um campo opcional `portabilidade?: boolean`.

### Validação de captura por família (Requisito 7.2)

`vendas/types.ts` define os shapes (`TelecomCaptureData`, etc.) mas sem
validação. Como o foco é o fluxo via orçamento/WhatsApp e a captura não é mais
etapa do funil, a validação fica **leve**: validar no ponto de entrada (form de
venda manual) com os schemas Zod existentes em `captura/schemas.ts` quando
houver. Não é prioridade — pode ficar por último.

---

## Modelo de dados (resumo final)

```sql
-- sale_status (novo enum)
'interesse' | 'negociando' | 'fechado' | 'perdido'

-- sales
amount_cents     bigint            -- era amount numeric(12,2)
points_kwh       numeric           -- inalterado (não é dinheiro)
status           sale_status       -- novo enum, default 'interesse'
closed_at        timestamptz       -- marca aceite/fechamento ou perda

-- proposals
amount_cents     bigint            -- era amount numeric
discount_cents   bigint            -- era discount numeric
amount_period    text              -- mantido (compat), mas UI ignora p/ métrica

-- proposal_events
counter_amount_cents bigint        -- era counter_amount numeric
```

> `amount_period` é mantido na coluna para não quebrar dados, mas o
> acompanhamento não o usa mais para separar receita.

---

## Segurança

- RLS já cobre tudo: consultor só vê o que é seu; público acessa apenas via edge
  function com `service_role` e token. **Nenhuma mudança de RLS** é necessária —
  as colunas renomeadas herdam as policies da tabela.
- O link público continua sem login, identificado só pelo `public_token`.
- Sem novos endpoints expostos; sem pagamento, não há dados financeiros
  sensíveis novos.

---

## Estratégia de migração e deploy

1. **Migrations de banco** (via MCP `apply_migration`, aplicam na hora):
   - `a` — converter valores para centavos (3 tabelas).
   - `b` — recriar enum `sale_status` (4 etapas) + traduzir histórico + nova
     `log_sale_status_change`.
2. **Edge function** `proposal-respond`: ajustar para `fechado` + `amount_cents`
   + texto da notificação. Deploy via GitHub Actions (conforme steering de
   deploy) — commit/push e disparo do workflow.
3. **Front-end**: ajustes em types/api/pricing/aggregate/componentes. Validar
   com `npx tsc --noEmit` e `npx vite build` (exit 0) antes de commitar.
4. **Regenerar** `src/integrations/supabase/types.ts` após as migrations.

Ordem importa: banco primeiro (a, b), depois edge + front juntos, porque os
tipos do front dependem das colunas novas.

---

## Testes

- **Unitários** (Vitest, já existem): atualizar
  `acompanhamento/__tests__/aggregate.test.ts` e
  `orcamento/__tests__/pricing.test.ts` para centavos e novas métricas;
  `vendas/__tests__/scoring.test.ts` permanece (pontos não mudam).
- **Novos casos**: conversão de etapas antigas→novas; cálculo em centavos sem
  perda; telecom com/sem portabilidade.
- **Manual**: criar orçamento → enviar WhatsApp (instância de teste) → aceitar
  no link → confirmar venda em "Fechado" e métricas corretas.
- Build e typecheck verdes como gate.

---

## Riscos e mitigação

| Risco                                          | Mitigação                                   |
|------------------------------------------------|---------------------------------------------|
| Migração de enum perder/!mapear dados          | Poucos registros; `USING` explícito; testar em branch ou validar contagem antes/depois |
| Divergência centavos vs reais em telas legadas | Helper único `formatBRLFromCents`; busca por usos de `amount` |
| Edge function desatualizada após renomear col. | Deploy do edge junto da migration; copia `amount_cents` |
| `amount_period` órfão                          | Mantido por compat; documentado como ignorado nas métricas |
