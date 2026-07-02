
## Objetivo

Criar uma aba dedicada **Financeiro** dentro do `/admin` que mostre todos os boletos da rede (clientes de todos os licenciados), com foco em vencimento, cobrança e status de pagamento. Ao mesmo tempo, tirar o bloco de **Cashback / Carteira Green** de dentro da aba "Base de clientes" para não ficar duplicado.

## O que sai da tela

Na aba **Clientes** (`/admin` → Base de clientes) hoje aparece o `CarteiraGreenPanel` (cashback, adimplência, boletos por consultor logado) junto com a lista de clientes. Isso será removido dessa aba.

- Os dados continuam no banco e o worker iGreen continua sincronizando normalmente.
- Nada é apagado. É só realocação visual: cashback/carteira somem da aba Clientes; boletos migram para a nova aba Financeiro num formato melhor.

## O que entra: aba Financeiro

Nova aba no menu lateral do admin, ícone de carteira/boleto, entre "Base de clientes" e "Produtos & Vendas".

### Topo — 4 KPIs
- **Vence hoje** (quantidade e R$)
- **Vencidos** (quantidade e R$, com destaque vermelho)
- **A vencer em 7 dias**
- **Pagos no mês** (recebido)

### Filtros rápidos (chips)
`Todos` · `Vence hoje` · `Vence em 3 dias` · `Vence em 7 dias` · `Vencidos 1–30d` · `Vencidos 31–60d` · `Vencidos 60d+` · `Pagos`

Mais: busca por cliente/cidade/CPF, filtro por **consultor da rede** (dropdown com licenciados), filtro por mês de referência.

### Tabela de boletos
Colunas: Cliente • Cidade/UF • Consultor responsável • Mês ref. • Vencimento (com selo colorido: verde=a vencer, amarelo=hoje/3d, vermelho=vencido) • Valor • Status • Ações.

Ações por linha:
- 📄 Abrir boleto (PDF)
- 📎 Abrir NF
- 💬 Cobrar no WhatsApp (usa telefone do cliente + template com link do boleto — reaproveita fluxo já existente do `BoletosList`)
- 📋 Copiar link

Paginação server-side (100/página) — hoje o hook trava em 2000.

### Visão / permissão
- **Super-admin**: vê boletos de todos os consultores.
- **Consultor** (se acessar a aba): vê apenas os próprios (filtro automático por `consultant_id = auth.uid()`).

## Detalhes técnicos

**Dados**: tudo já existe. Tabela `igreen_customer_boletos` + view `v_boletos_carteira` (nome/telefone do cliente já vem da view). Worker `worker-igreen-sync` já popula via endpoint `/clientes-green/boletos` do escritório oficial iGreen.

**Arquivos a criar**
- `src/components/admin/financeiro/FinanceiroPanel.tsx` — layout da aba, KPIs, filtros
- `src/components/admin/financeiro/BoletosAdminTable.tsx` — tabela paginada com coluna de consultor
- `src/components/admin/financeiro/hooks.ts` — `useBoletosAdmin({ filtros, page })` sem trava por `consultant_id`, com join de `consultants.full_name` via segunda query (id → nome), server-side range/count
- `src/components/admin/financeiro/kpi.ts` — cálculo de KPIs (vence hoje, vencidos, a vencer 7d, pagos no mês)

**Arquivos a editar**
- `src/components/layout/AppSidebar.tsx` — adicionar `"financeiro"` ao union `AdminTabId` e ao array de itens (label "Financeiro", ícone `Receipt` ou `FileText`, entre "Base de clientes" e "Produtos & Vendas")
- `src/pages/Admin.tsx`:
  - **Remover** o render de `<CarteiraGreenPanel />` dentro do bloco `activeTab === "clientes"` (linhas ~427–438)
  - **Adicionar** novo bloco `activeTab === "financeiro"` renderizando `<FinanceiroPanel />`
- `src/components/admin/CarteiraGreenPanel.tsx` — mantido como código morto por ora (não deletar, para não quebrar imports em rotas de consultor). Só deixa de ser importado em `Admin.tsx`.

**Reaproveita** — `BoletosList.tsx` tem toda a lógica de status/vencimento/envio WhatsApp. A nova tabela empresta essas helpers (`scoreIntent`, cálculo de dias de atraso, mutação de envio) em vez de reescrever.

**Sem migration**. Nenhuma mudança de schema — todas as colunas necessárias (`vencimento`, `pagamento`, `status`, `dias_atraso`, `total`, `url_boleto`, `url_invoice`, `consultant_id`, `nome`, `cidade`, `uf`, `customer_name`, `phone_whatsapp`) já existem na view.

## Fora de escopo
- Não integrar cobrança automática recorrente (ex.: régua de 3/1/0 dias antes) — só ação manual por enquanto.
- Não mexer no worker iGreen — sync continua igual.
- Não mover cashback para lugar nenhum novo — só remover da aba Clientes. Se depois quiser cashback num painel próprio, é um segundo passo.
