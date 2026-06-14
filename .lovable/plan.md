# Redesign — Admin · Produtos & Vendas

## Estética travada (não negociar nesta entrega)

**Paleta Sage & Cream**
- `#f5f0e8` background · `#dce5d4` surface · `#a8c0a0` mid · `#7d9b76` accent verde · `#1a2e1f` ink · `#c9a84c` gold (premium/KPI destaque)

**Tipografia**
- DM Serif Display → manchetes editoriais (h1/h2 do hero, nomes de cliente em cards)
- Fira Sans 300/400/500/600 → toda a UI, números, tabelas, botões

**Linguagem visual**
- Cantos retos (`rounded-none` nos CTAs e blocos KPI; `rounded` discreto só em inputs/avatares)
- Borda fina `border-[#a8c0a0]/30`, divisores sublinhados em vez de cartões com sombra pesada
- Sombras só `shadow-sm`; profundidade vem da hierarquia tipográfica
- Acento dourado `#c9a84c` reservado para 1 KPI "premium" por hero (não pulverizar)

---

## Escopo (somente UI/presentation)

Não mexer em rotas, hooks de dados, schemas Supabase, edge functions ou contratos de API. Reaproveitar 100% dos hooks existentes (`useSales`, `useProducts`, `useUpdateSaleStatus`, `useProposals`, etc.).

### Arquivos a alterar

1. **`src/features/produtos/theme.ts`** (novo) — tokens Sage como CSS variables (`--pv-bg`, `--pv-surface`, `--pv-mid`, `--pv-accent`, `--pv-ink`, `--pv-gold`) + carregamento das fontes Google via `<link>` injetado uma vez.

2. **`src/features/produtos/ProdutosModule.tsx`**
   - Trocar `<TabsList>` shadcn por nav editorial inline (links com underline `border-b-2 border-[#7d9b76]` na ativa)
   - Aplicar `bg-[#f5f0e8]` no wrapper e injetar fontes
   - Topbar do módulo: nav à esquerda + slot do `OrcamentoButton` à direita (mesma linha, alinhamento `items-end`)

3. **`src/features/produtos/orcamento/OrcamentoButton.tsx`** — restilizar para CTA Sage (`bg-[#7d9b76]` → hover `#1a2e1f`, retangular, "NOVO ORÇAMENTO" maiúsculo com tracking).

4. **`src/features/produtos/crm/SalesPipelineBoard.tsx`** — referência direta do protótipo:
   - Hero magazine `grid-cols-12` (col-span-7 manchete + parágrafo / col-span-5 grid 2×2 de KPIs)
   - KPIs: Ganho Estimado (gold), Ciclo Médio (sparkline SVG), Propostas Ativas, Conversão. Valores derivados de `sales` agregados.
   - Colunas com header `border-b border-[#a8c0a0]` + nome maiúsculo + valor total em `text-[#7d9b76]`
   - **Cards ricos**: kicker (família do produto), tempo na etapa, nome do cliente em Fira Medium, kWh/mês + valor lado a lado, footer com status-dot (cor por urgência) + próxima ação. Última coluna "Ativo" em cartão escuro `bg-[#1a2e1f]` com número em gold.

5. **`src/features/produtos/catalogo/ProductCatalogTable.tsx`**
   - Hero magazine reduzido (col-span-7/5) com KPIs: Produtos Ativos, Famílias, Maior Pontuação, Comissão Média
   - Donut Recharts por família (substitui lista plana)
   - Agrupar produtos por `family` em seções colapsáveis com cabeçalho serif
   - Campo de busca + chips de filtro por família no topo da listagem

6. **`src/features/produtos/acompanhamento/*`** (painel principal)
   - Hero magazine + 4 KPIs (Vendas no mês, kWh total, Comissão prevista, Vendas ativas)
   - 2 gráficos Recharts lado a lado: AreaChart (vendas ao longo do tempo) + BarChart horizontal (top 5 produtos)
   - Tabela compacta abaixo, mesma linguagem dos cards do pipeline

7. **`src/features/produtos/orcamento/ProposalsPanel.tsx`**
   - Hero + KPIs (Orçamentos abertos, Taxa de aceite, Ticket médio, Vencendo hoje)
   - Card destaque "última proposta enviada" (col-span-7) + grid de cards menores ao lado
   - Sparkline de aceites nos últimos 7 dias no KPI principal

8. **`src/features/produtos/orcamento/OrcamentoBuilderSheet.tsx`** (modal Novo Orçamento) — refazer com layout sidebar+conteúdo:
   - Sidebar esquerda `bg-[#dce5d4]` com 3 passos numerados (Cliente → Técnico → Finalizar) e estado ativo
   - Header com título serif "Configurar Orçamento" + subtítulo
   - Form em grid 2-col com labels uppercase tracking-widest, inputs `bg-white border-[#a8c0a0]/20 rounded-xl`
   - Painel de **prévia em tempo real** (lado direito ou rodapé) recalculando economia/valor enquanto digita
   - Footer: "Cancelar" texto + "Próximo Passo" `bg-[#1a2e1f]` rounded-xl

---

## Detalhes técnicos

- **Recharts** já está no projeto (usado em outras telas) — só importar. Se faltar, `bun add recharts`.
- **Fontes** via `<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Fira+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">` injetado por `theme.ts` em `useEffect` (1 vez, idempotente).
- **Tokens** ficam locais ao módulo (`theme.ts` injeta as CSS vars em `:root` com prefixo `--pv-*`), não tocando no design system global do app (admin segue tema escuro nas outras áreas).
- **Animações**: `transition-colors duration-300` em hovers; `transition-all` no CTA; sem framer-motion adicional (pesado e fora do escopo).
- **Drag-and-drop do kanban**: mantém a implementação atual (`onDragStart/onDrop`), só restila os cards.

## Fora do escopo

- Lógica de negócio (cálculo de comissão, fluxo de venda, status transitions)
- Tema dark global do admin (este módulo fica "claro" como ilha editorial, igual ao protótipo)
- Mobile-first refinado (ajusta com `md:`/`lg:` mas alvo principal é desktop 1440px do protótipo)
- Edição do catálogo (continua read-only conforme RLS atual)

## Validação ao final

Build limpa, abrir `/admin` → Produtos & Vendas, verificar cada uma das 4 sub-abas + abrir modal Novo Orçamento, conferir que dados reais (vendas, produtos, propostas) renderizam no novo layout sem regressão de funcionalidade.
