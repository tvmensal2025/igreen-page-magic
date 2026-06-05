## Direção escolhida
**Elite Emerald Dashboard** (v2): sidebar escura `#064e3b` 240–288px com grupos (Visão Geral · Gestão Comercial · Recursos), item ativo em pílula `bg-emerald-900/40` + texto dourado `#c9a84c` + borda âmbar; topbar branca 80–96px com saudação + breadcrumb + status pill + busca + notificações; conteúdo em bento de cards `rounded-[2rem]` com bordas `stone-200` e sombras esmeralda suaves.

## Tokens (LOCKED — copiar verbatim)
- Cores HSL no `index.css`: `--background 60 33% 97%` (cream), `--card 0 0% 100%`, `--primary 158 84% 16%` (#064e3b), `--primary-foreground 0 0% 100%`, `--accent 43 53% 54%` (#c9a84c), `--secondary 158 47% 26%` (#0d7a5f), `--muted 60 9% 96%`, `--border 30 6% 90%`.
- Tipografia: Space Grotesk (headings, números KPI), DM Sans (corpo). Carregar via `<link>` no `index.html`.
- Raios: cards `rounded-[2rem]`, pílulas `rounded-2xl`, badges `rounded-lg`.
- Sombras: `shadow-sm` padrão, `hover:shadow-xl hover:shadow-emerald-900/5`.

## Arquitetura do shell

```text
src/
  components/
    layout/
      AppShell.tsx          ← novo: SidebarProvider + grid sidebar+main
      AppSidebar.tsx        ← novo: nav agrupado (3 seções, 11 itens)
      AppTopbar.tsx         ← novo: saudação, status, busca, sino, avatar
    modules/                ← shells por módulo (header + bento body)
      ModuleHeader.tsx
      ModuleBento.tsx
```

- `AppShell` envolve `Outlet` em `SidebarProvider` (shadcn `sidebar.tsx`) com `collapsible="icon"` (recolhe pra 64px mantendo ícones).
- `AppSidebar` usa `NavLink` do `react-router-dom` pra detectar rota ativa; grupos `Visão Geral` (Dashboard, CRM, Conversão, Clientes), `Gestão Comercial` (Captação, Parceiros, Rede, WhatsApp), `Recursos` (Central de Anúncios, Links, Materiais). Item ativo aplica `bg-emerald-900/40 text-[#c9a84c] border border-[#c9a84c]/20`. Badges numéricos opcionais (ex.: Conversão "12").
- Rodapé do sidebar: card com avatar contornado em dourado + nome + nível ("Líder Diamante") + botão logout.
- `AppTopbar` 96px sticky: à esquerda título da rota + subtítulo dinâmico; à direita pill "Status Operacional" com pulse, hora, sino c/ dot âmbar, busca global.

## Aplicação por módulo (11 telas)

Cada módulo mantém **toda lógica/dados/serviços existentes** — apenas troca o chrome e o agrupamento visual. Padrão para todas:

1. `ModuleHeader` (h1 Space Grotesk + subtitle + ações primárias à direita).
2. Faixa de 4 KPI cards (`rounded-[2rem]`, 1 card destaque escuro com glow âmbar).
3. Bento body 2/3 + 1/3 (gráfico/lista principal + side rail com call-to-action dourado e ranking).

Mapeamento:
- **Dashboard** (`AdminMetaAds`?/Index): KPIs Receita/Leads/Conversão/Meta, gráfico Performance Semanal, Líderes do Mês, card âmbar "Dica do Dia".
- **CRM**: KPIs por estágio do funil; bento = kanban (col 2/3) + atividades recentes (col 1/3). Cards de lead em `rounded-2xl` com avatar e tags douradas.
- **Conversão** (`AdminConversao`): KPIs taxa/abandono/tempo médio; gráfico funil + lista de gargalos.
- **Clientes** (`WhatsAppClientsPage`): KPIs ativos/inativos/aprovados; tabela densa em card branco + side com filtros chips dourados.
- **Captação**: KPIs leads/mês, custo/lead; bento com formulário de captação destacado em card escuro + histórico.
- **Parceiros**: grid de cards de parceiros estilo bento, filtros segmentados.
- **Rede**: árvore/lista hierárquica com indentação esmeralda + KPIs de profundidade.
- **WhatsApp** (`ConsultantPage` aba): mantém subnav atual (Dashboard, Conversas, Atendente IA, Envio em Massa, Templates, Agendamentos, Histórico) re-skinada como segmented tabs sob o ModuleHeader; painel Disparo PRO já está no padrão.
- **Central de Anúncios** (`AdminMetaAds`): KPIs campanhas/CTR/CPL; lista de campanhas + gráfico de gasto.
- **Links**: grid de cards de link com ações copy/QR; KPIs cliques/conversões.
- **Materiais**: grid bento de materiais (imagem + título + tag), filtros por categoria.

## Migração da navegação

- Remover tabs horizontais atuais do topo do `ConsultantPage` (ou similar) e mover para o `AppSidebar`.
- Rotas: introduzir rotas filhas sob `/admin` (ex.: `/admin/dashboard`, `/admin/crm`, `/admin/whatsapp/...`) usando `<Outlet/>` em `AppShell`. Manter backward-compat redirecionando rotas legadas.
- Cada subnav existente (ex.: WhatsApp) vira um row de segmented tabs no `ModuleHeader` daquele módulo.

## Mobile/responsive

- `<lg`: sidebar vira off-canvas (`Sheet`), topbar mantém `SidebarTrigger` à esquerda.
- KPIs colapsam de 4 → 2 → 1 col.
- Bento body 2/3+1/3 colapsa para coluna única.

## Acessibilidade / qualidade

- Contraste AA: texto branco sobre `#064e3b` e dourado sobre escuro validados.
- `aria-current="page"` no link ativo.
- Foco visível com ring `#c9a84c`.
- Sem cores hard-coded em componentes: tudo via tokens do `index.css` + classes utilitárias.

## Escopo / fora de escopo

**Inclui:** AppShell, AppSidebar, AppTopbar, tokens do index.css/tailwind.config, refator do chrome dos 11 módulos, segmented subnavs, mobile sheet.
**Não inclui:** mudanças em queries Supabase, edge functions, lógica de envio/agendamento, autenticação, schema. Apenas camada de apresentação.

## Ordem de execução

1. Tokens + fontes + Tailwind config.
2. `AppShell` + `AppSidebar` + `AppTopbar` + roteamento.
3. Migrar Dashboard (template de referência).
4. Aplicar template aos outros 10 módulos em paralelo, respeitando dados/componentes existentes.
5. Polimento responsivo + revisão de contraste.
