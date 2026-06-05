# Redesign — Interior das páginas /admin

Escopo: **só o conteúdo interno** das páginas (header de página, KPIs, gráficos, tabelas, toolbars, listas). Sidebar e topbar permanecem como estão. Sem mudanças de lógica, queries, edge functions ou DB.

## 1. Refinar tokens (`src/styles/painel-elite.css`)

Manter paleta Emerald Refinado, mas adicionar escala completa para o interior:

```
/* superfícies */
--pe-bg:            #f7f9f8
--pe-surface:       #ffffff
--pe-surface-muted: #f1f5f3
--pe-surface-sunken:#eef2f0   /* nova — fundo de tabela header / chips */

/* bordas */
--pe-border:        #e6ebe8   /* mais clara, hairline real */
--pe-border-strong: #cdd5d0
--pe-border-focus:  #10b981

/* texto */
--pe-text:       #0b1f1a
--pe-text-muted: #5b6b65
--pe-text-dim:   #94a39d
--pe-text-label: #6b7a73   /* uppercase labels */

/* accent + estados */
--pe-accent:        #10b981
--pe-accent-strong: #047857
--pe-success:       #059669
--pe-warning:       #d97706
--pe-danger:        #dc2626
--pe-info:          #0284c7

/* escala tipográfica fixa (interior) */
--pe-fs-kpi:    28px   /* número grande KPI */
--pe-fs-h1:     22px   /* título de página */
--pe-fs-h2:     16px   /* section header */
--pe-fs-body:   14px
--pe-fs-meta:   12px
--pe-fs-label:  11px   /* uppercase 0.06em */

/* radius + shadow */
--pe-radius-sm: 8px
--pe-radius:    12px    /* padrão cards */
--pe-radius-lg: 16px
--pe-shadow-card: 0 1px 2px rgba(11,31,26,0.04), 0 1px 0 rgba(11,31,26,0.02)
--pe-shadow-hover:0 4px 12px rgba(11,31,26,0.06)
```

## 2. Novas utility classes (mesmo arquivo)

```
.pe-page         { max-width: 1400px; margin: 0 auto; padding: 24px 32px; }
.pe-page-header  { display:flex; justify-between; pb-4 mb-6 border-b }
.pe-page-title   { font: 600 22px Space Grotesk; letter-spacing:-.01em }
.pe-page-sub     { 13px --pe-text-muted mt-1 }

.pe-section      { mb-8 }
.pe-section-head { flex between items-end pb-3 mb-4 border-b }
.pe-section-title{ 16px 600 Space Grotesk }

.pe-card         { bg surface, 1px border, radius 12, shadow-card }
.pe-card-kpi     { p-5, hover: border --pe-accent/40 + shadow-hover }
.pe-kpi-label    { 11px uppercase 0.06em --pe-text-label }
.pe-kpi-value    { 28px 600 tabular-nums --pe-text }
.pe-kpi-delta-up { 12px --pe-success bg-success/8 px-1.5 py-0.5 radius-sm }
.pe-kpi-delta-dn { 12px --pe-danger bg-danger/8 ... }
.pe-kpi-spark    { h-8 mt-3 (sparkline opcional) }

.pe-table              { w-full text-sm }
.pe-table thead th     { sticky top-0 bg --pe-surface-sunken, 11px uppercase 0.06em --pe-text-label, h-9, px-3, border-b }
.pe-table tbody tr     { h-11, border-b --pe-border, hover bg --pe-surface-muted }
.pe-table td           { px-3 14px }

.pe-toolbar            { flex gap-2 flex-wrap mb-4 }
.pe-chip               { h-8 px-3 radius-lg border --pe-border 13px hover bg-muted }
.pe-chip-active        { bg --pe-emerald-strong text-white border-transparent }

.pe-status-dot         { w-1.5 h-1.5 rounded-full inline-block mr-1.5 }
.pe-badge-success/warn/danger/info  { 11px px-2 py-0.5 radius-sm uppercase 0.05em }
```

## 3. Aplicar em páginas-template

Não refatorar tudo de uma vez — aplicar como **template** em 3 superfícies de referência, e o resto herda via tokens automaticamente:

### a) `src/components/admin/StatCard.tsx`
Reescrever visual (lógica intacta):
- Remover `feature-card` antigo (sombra pesada, radius 24)
- Usar `.pe-card .pe-card-kpi`
- Estrutura: label uppercase no topo, número grande accent, delta + sparkline abaixo
- Ícone vira chip pequeno 24px canto sup. dir. (não badge 56px gigante)

### b) `src/components/admin/ads/AdsCentralTab.tsx` (header + nav + toolbar)
- Wrap em `.pe-page`
- Título com `.pe-page-header` + `.pe-page-title`
- Substituir `rounded-lg bg-secondary p-1` (abas pill) por linha de chips `.pe-chip` + `.pe-chip-active`, sem fundo cinza
- Toolbar de período/conta em faixa `.pe-toolbar` (chips altura 32, sem card com backdrop-blur)

### c) `src/components/admin/parceiros/PartnerDashboard.tsx` (header + ranking table)
- `.pe-page-header` no topo
- Card "Ranking detalhado" usando `.pe-section-head` em vez de `CardHeader/CardTitle` do shadcn
- Tabela interna recebe classes `.pe-table`

### d) Banner de manutenção (visível no print anterior)
- Reduzir para faixa fina `border-l-4 border-warning bg-warning/5 px-3 py-2 text-xs`, não card vermelho gigante

## 4. Ajustes de tamanho/respiro globais

Auditar em `painel-elite.css`:
- Gap entre seções: **24px** (não 32+)
- Padding interno de card padrão: **20px** (não 24-32)
- Radius de cards: **12px** (não 16-24)
- Sombras: **uma só** (`--pe-shadow-card`), sem múltiplas camadas
- Hover de card: borda + shadow leve, sem `scale` nem `translate-y`

## 5. Fora de escopo

- ❌ Sidebar (`AppSidebar.tsx`) e topbar (`AppTopbar.tsx`) — já aprovados
- ❌ Páginas públicas (landing, licenciada)
- ❌ Lógica, queries, hooks, edge functions
- ❌ Componentes shadcn base (`Card`, `Button` etc.) — usar wrappers `.pe-*` por cima

## Ordem de execução

1. Atualizar tokens + adicionar utilities em `painel-elite.css`
2. Reescrever visual de `StatCard.tsx` como referência de KPI
3. Refatorar header/nav/toolbar de `AdsCentralTab.tsx`
4. Refatorar header de `PartnerDashboard.tsx` + classes de tabela no ranking
5. Substituir banner de manutenção pelo padrão hairline

## Nota técnica

`.lovable/` está no `.gitignore` — este plano em `.lovable/plan.md` não é commitado e se perde no próximo snapshot. Quer que eu remova essa entrada do `.gitignore` para o plano persistir?
