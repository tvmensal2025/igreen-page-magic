# Enxugar aba Clientes — detalhes dentro do cliente

## Objetivo
A aba **Clientes** hoje empilha muitos blocos grandes lado a lado (Hero + 4 KPIs, Métricas do consultor com 4 sub-cards, Status da carteira, Intenção de pagamento, Boletos, Devolutivas). O usuário quer **menos ruído visual sem perder informação** — mover o que é "por cliente" para dentro do próprio cliente e deixar no topo só o que é panorâmico.

## Princípio
- **Topo (panorama):** poucos números, uma linha só.
- **Meio (ação):** uma tabela unificada de clientes, com filtros.
- **Detalhe (drawer):** ao clicar num cliente, abre um painel lateral com TODA a informação daquele cliente (boletos, devolutivas, injeção, telecom, seguros, cashback dele).

## Mudanças em `src/features/produtos/carteira-green/CarteiraGreenPanel.tsx`

### 1. Faixa 1 — Hero enxuto (era faixa hero + KPI ribbon)
- Manter só o título "Carteira iGreen" + timestamp de última sync.
- Colapsar os 4 HeroKpi numa **única linha compacta** (chips inline): `159 clientes · 21 boletos abertos · 92% adimplência · 12,4k kWh`.
- Remove `HeroKpi` cards grandes.

### 2. Faixa 2 — Métricas do consultor (compactar)
- Hoje: 4 sub-cards (Clientes, Rede, Cadastros do mês, Cashback) com 4-7 linhas cada = ~20 números.
- Novo: **1 linha de KPIs colapsável** ("Métricas do mês" — clicar expande os detalhes). Fechado por padrão.
- `ConsultantMetricsCard` ganha prop `defaultOpen={false}` e vira `<Collapsible>`.

### 3. Faixa 3 — Remover
- `StatusCards` (Status da carteira) e `PaymentIntent` (Intenção de pagamento) são **derivados dos boletos**. Movê-los para **dentro do drawer do cliente** (mostra intenção daquele cliente) e no topo virar só os 2 chips do hero.
- Elimina a grid 3/2 inteira da Faixa 3.

### 4. Faixa 4 — Unificar em UMA tabela "Clientes"
- Substituir `BoletosList` + `DevolutivasList` lado a lado por **uma tabela única `ClientesCarteiraTable`** agrupada por cliente (não por boleto):
  - Colunas: Cliente · Cidade/UF · Status financeiro (badge derivado do último boleto) · Devolutivas pendentes (contador) · Injeção (✓/–) · Ação.
  - Filtros no topo (chips): Todos / Vencidos / Disponíveis / Pagos / Com devolutiva.
  - Busca única por nome/cidade/fornecedora.
- Clicar no cliente abre um **drawer lateral** (`Sheet` shadcn já usado no projeto) `ClienteDetalheDrawer` que renderiza, para aquele `customer_id`:
  - Cabeçalho: nome, telefone, cidade, fornecedora, botão WhatsApp.
  - Aba **Boletos**: mini `BoletosList` filtrado por cliente (a lógica existente reaproveitada com prop `filterByCustomer`).
  - Aba **Devolutivas**: mini `DevolutivasList` filtrado por cliente.
  - Aba **Intenção de pagamento**: `PaymentIntent` recebendo só os boletos daquele cliente.
  - Aba **Telecom/Seguros**: `TelecomClientesList`/`SegurosClientesList` filtrados por telefone/nome.

### 5. Resultado
- Página passa de ~6 blocos grandes para **3 blocos** (Hero linha, Métricas colapsável, Tabela clientes).
- Toda informação continua acessível — está a 1 clique dentro do cliente.

## Arquivos afetados
- `src/features/produtos/carteira-green/CarteiraGreenPanel.tsx` — reescrever layout.
- `src/features/produtos/carteira-green/ConsultantMetricsCard.tsx` — envolver em `Collapsible`, fechado por padrão.
- **Novo** `src/features/produtos/carteira-green/ClientesCarteiraTable.tsx` — tabela unificada por cliente + filtros.
- **Novo** `src/features/produtos/carteira-green/ClienteDetalheDrawer.tsx` — `Sheet` com abas (Boletos/Devolutivas/Intenção/Telecom/Seguros) do cliente selecionado.
- `BoletosList.tsx` / `DevolutivasList.tsx` / `PaymentIntent.tsx` / `TelecomClientesList.tsx` / `SegurosClientesList.tsx` — aceitar prop opcional `customerKey` (idcliente/telefone) para filtrar por 1 cliente quando embutidos no drawer. Sem prop, seguem funcionando como hoje (para o Admin geral, se ainda usado).

## Sem impacto
- Nenhuma mudança de schema, hook de dados (`useBoletosCarteira`, `useDevolutivasCarteira`) ou lógica de sync.
- Tokens de cor e tipografia (Space Grotesk + DM Sans) mantidos.
- `RedeDashboardCard`, `RotinasPanel` e `EndpointDiscoveryCard` não são tocados (moram em outras abas).

## Confirmação antes de implementar
Duas perguntas rápidas:
1. Prefere o drawer **lateral (Sheet)** ou uma **linha expansível na própria tabela**? (recomendo Sheet — cabe mais informação no mobile).
2. A faixa "Métricas do consultor" deve ficar **colapsada por padrão** (mais limpo) ou **aberta** (visão imediata)?
