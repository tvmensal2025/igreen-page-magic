# Redesign — Central de Anúncios 2026

Pé na areia: paleta **Emerald Prestige** (verde esmeralda + dourado), tipografia **Space Grotesk + DM Sans**, layout **Bento Grid**. Tema escuro, autoridade tranquila estilo Bloomberg Terminal / Linear / Ramp.

## Escopo

Apenas o componente `src/components/admin/ads/AdsCentralTab.tsx` e seus filhos visuais diretos do Dashboard (cards de métrica, charts wrappers, header). **Não altero** lógica de negócio, hooks, edge functions, RLS, ou contratos de dados — só apresentação.

## Tokens de design (novos)

Adicionar em `src/index.css` um escopo `.ads-central-2026` com tokens próprios — não polui o resto do app:

```text
--ads-bg:        222 47% 4%       (quase preto, vidro fosco)
--ads-surface:   158 64% 8%       (esmeralda profundo p/ tiles)
--ads-surface-2: 158 50% 12%      (tiles secundários)
--ads-border:    158 30% 18%
--ads-emerald:   158 84% 30%      (#0d7a5f — ação)
--ads-emerald-2: 162 88% 22%      (#064e3b — profundo)
--ads-gold:      43  53% 54%      (#c9a84c — destaque numérico)
--ads-cream:     45  60% 92%      (#f5f0e0 — texto premium)
--ads-text:      45  20% 96%
--ads-muted:     158 15% 65%
--shadow-emerald: 0 20px 60px -20px hsl(var(--ads-emerald-2) / .6)
--shadow-tile:    0 1px 0 0 hsl(var(--ads-border)) inset, 0 10px 30px -15px #000
--gradient-tile:  linear-gradient(180deg, hsl(var(--ads-surface)) 0%, hsl(var(--ads-surface-2)) 100%)
--gradient-gold:  linear-gradient(135deg, hsl(var(--ads-gold)) 0%, hsl(45 40% 40%) 100%)
```

Fontes: importar Space Grotesk e DM Sans via `<link>` no `index.html` (ou já está? checar antes) e mapear `.ads-central-2026 { font-family: 'DM Sans', system-ui; } .ads-central-2026 h1, h2, h3, .ads-display { font-family: 'Space Grotesk', sans-serif; font-feature-settings: 'ss01'; }`.

## Estrutura — Bento Grid

```text
┌─────────────────────────────────────────────────────────────────┐
│ HEADER STICKY (vidro escuro, blur)                              │
│  iGreen·Anúncios   ·  período   ·  conta   ·  💰 saldo   [+ Criar]│
├─────────────────────────────────────────────────────────────────┤
│ NAV PILL (Dashboard · Modelos · Campanhas · Performance · ...)  │
├─────────────────────────────────────────────────────────────────┤
│ ┌──────── HERO TILE (col-span 8, row-span 2) ──────┐ ┌── CPL ──┐│
│ │  Gasto x Leads — line chart grande, eixo dourado │ │ donut + ││
│ │  Big number: R$ 12.430 · 184 leads · CPL R$ 67   │ │ delta % ││
│ └──────────────────────────────────────────────────┘ └─────────┘│
│ ┌─KPI─┐ ┌─KPI─┐ ┌─KPI─┐ ┌─KPI─┐  ┌──── Funil (col-4, row-2)──┐│
│ │ Imp │ │Cliq │ │ CTR │ │Conv │  │ Visita→WA→Lead→Aprovado    ││
│ └─────┘ └─────┘ └─────┘ └─────┘  │ barras verticais douradas  ││
│ ┌──── Estágios CRM (donut) ───┐  └────────────────────────────┘│
│ │  6 fatias verde+dourado     │  ┌── Replicar Uberlândia ──┐  │
│ └─────────────────────────────┘  │ card destaque com CTA   │  │
│ ┌──── Cliques recentes (lista compacta col-12) ──────────────┐│
│ │  hora · campanha · cidade · device                         ││
│ └────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

Grid: `grid-cols-12 gap-3 md:gap-4`. Mobile colapsa para `grid-cols-1`.

## Tile component

Novo `AdsTile` interno (não exportado) substitui os `Card` shadcn no contexto desta tela:
- Borda 1px `--ads-border`, raio `xl`, fundo `--gradient-tile`, sombra `--shadow-tile`
- Hover: borda dourada sutil + `--shadow-emerald`
- Header do tile: label minúsculo uppercase tracking-wide em `--ads-muted` + ícone monocromático verde
- Conteúdo principal: número grande em Space Grotesk tabular-nums; delta % em dourado quando positivo

## Header sticky

- Fundo `bg-[hsl(var(--ads-bg))]/80 backdrop-blur-xl border-b border-[hsl(var(--ads-border))]`
- Wordmark `iGreen · Anúncios` em Space Grotesk medium
- WalletChip estilizado com fundo esmeralda profundo e número em dourado
- CTA `Criar campanha` virá com `bg-gradient-gold text-emerald-950 font-semibold`

## Nav pill

Substituir `pe-toolbar` chips por nav pill única: container arredondado escuro com 6 botões; ativo ganha fundo esmeralda + texto creme; inativos só ícone+label muted; underline dourado de 2px no ativo.

## Cards onboarding

`CtwaConnectGuide` e `ReplicateUberlandiaCard` migram para tiles do bento (não mais banners largos), só aparecem quando relevantes — `CtwaConnectGuide` ocupa banner sticky abaixo do header **apenas** se não conectado; senão some.

## Charts (Recharts)

Reestilizar wrappers em `AdMetricsCharts.tsx` para usar tokens locais:
- Linhas/áreas: stroke `--ads-emerald` (primária) e `--ads-gold` (secundária)
- Grid: `--ads-border` opacity 0.4
- Tooltip: fundo `--ads-surface`, borda dourada 1px, fonte DM Sans
- Pie/donut: paleta `[emerald, gold, emerald-2, cream, sage, muted-emerald]`

Sem mexer na lógica dos hooks (`useAdMetrics`, etc).

## Motion

Stagger no mount dos tiles via CSS `animation-delay` (50ms × index) — sem framer-motion novo. Hover transform `translateY(-2px)` 200ms.

## Tipografia loading

Adicionar `<link rel="preconnect" href="https://fonts.googleapis.com">` + `<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">` em `index.html` se ainda não houver.

## Arquivos tocados

1. `src/index.html` — fontes (se faltarem)
2. `src/index.css` — bloco `.ads-central-2026 { ... }` com tokens + classes utilitárias `.ads-tile`, `.ads-display`, `.ads-nav-pill`
3. `src/components/admin/ads/AdsCentralTab.tsx` — reescrever JSX da view dashboard + header + nav (mesma API de props, mesmos handlers, mesmas chamadas a subcomponentes)
4. `src/components/admin/dashboard/AdMetricsCards.tsx` — re-skin para `.ads-tile` quando renderizado dentro do escopo
5. `src/components/admin/dashboard/AdMetricsCharts.tsx` — paleta nova nos charts
6. Novo `src/components/admin/ads/AdsTile.tsx` — wrapper visual reutilizável

## Fora de escopo

- Não mexo em Modelos/Campanhas/Performance/Intel/Comissões internamente (cada view continua usando seus componentes atuais; só ganham o frame novo).
- Sem mudanças de dados, RLS, edge functions, contratos.
- Sem light theme (a página fica forçada em dark).

## Quality bar

Antes de encerrar: abrir `/admin?tab=ads` no preview, verificar bento responsivo em 1440 e 768, conferir contraste do dourado sobre fundo escuro (WCAG AA para números grandes), e garantir que charts ainda recebem dados (sem regressão).
