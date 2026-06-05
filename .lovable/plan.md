# Plano — Refinamento Painel Elite v3

## Objetivos
1. **Paleta refinada** (Emerald escuro + accent verde vivo, sem dourado dominando).
2. **Sidebar colapsável** com botão fixo no topbar + auto-recolhe ao clicar em qualquer item de navegação.
3. **Interior das páginas mais profissional** (densidade Stripe Dashboard).

## 1. Paleta nova (`src/styles/painel-elite.css`)

Substitui os tokens atuais por:

```
--pe-bg:            #f7f9f8   /* near-white com tint verde */
--pe-surface:       #ffffff
--pe-surface-muted: #f1f5f3
--pe-border:        #e3e8e5
--pe-border-strong: #cdd5d0

--pe-emerald:        #064e3b   /* sidebar / primary */
--pe-emerald-strong: #022c22   /* hover / dark surfaces */
--pe-emerald-soft:   #047857
--pe-accent:         #10b981   /* CTAs, active, números KPI */
--pe-accent-soft:    #34d399
--pe-accent-glow:    rgba(16,185,129,0.18)

--pe-text:       #0b1f1a
--pe-text-muted: #5b6b65
--pe-text-dim:   #94a39d
```

Mudanças visíveis:
- Gold (#c9a84c) sai como token primário; sobra só como `--pe-accent-warm` para o badge "Elite" do logo.
- Item ativo da sidebar passa a usar `bg-[--pe-emerald-strong]` + borda esquerda 3px `--pe-accent` + texto branco (não mais dourado).
- KPI numbers em `--pe-accent` sobre `--pe-emerald-strong` (alto contraste).
- Background geral mais claro/neutro, menos amarelado.

## 2. Sidebar colapsável

Refatorar `src/components/layout/AppSidebar.tsx` + `Admin.tsx`:

- Adicionar prop `collapsed: boolean` controlada por `Admin.tsx` (estado `sidebarCollapsed`, default `false` em desktop).
- Larguras: `w-72` (expandido) ↔ `w-[72px]` (recolhido) com `transition-all duration-300`.
- Quando recolhida: esconder labels, seções, perfil expandido; mostrar só ícones centralizados + avatar mini + logout. Tooltip nativo (`title`) em cada item.
- **Auto-recolhe**: ao clicar em qualquer `pe-nav-item`, chamar `onCollapse?.()` (apenas em desktop ≥lg). Mobile mantém comportamento de fechar drawer.
- **Botão expandir/recolher no topbar** (`AppTopbar.tsx`): ícone `PanelLeftClose` / `PanelLeftOpen`, sempre visível em desktop, à esquerda do título. Substitui o atual botão mobile-only `Menu` por um botão único que funciona nos dois modos.
- Persistir estado em `localStorage` (`pe:sidebar-collapsed`) para lembrar entre reloads.

## 3. Páginas internas mais profissionais

Aplicar padrão "Stripe Dashboard" — sem reescrever lógica, só chrome:

- **Cards KPI**: reduzir radius de 24px → 16px, padding `p-5`, borda `1px solid --pe-border` em vez de sombra pesada, número grande em `--pe-accent`, label em uppercase 10px `--pe-text-muted`, mini-sparkline ou delta `+12%` em verde/vermelho.
- **Headers de seção**: linha divisória `border-b --pe-border` + título `text-base font-semibold` + ações à direita (botão ghost compacto).
- **Tabelas**: linhas 44px, hover `bg-[--pe-surface-muted]`, header sticky uppercase 11px.
- **Toolbars/filtros**: chips compactos `h-8 rounded-lg border --pe-border`, ícone 14px + label, sem sombras.
- **Toast/banner de manutenção** (visível no print): reduzir para faixa fina amber `border-l-4`, não card grande vermelho.
- **Espaçamentos**: gap entre seções 24px (não 32+), max-width content `1400px`, padding lateral `px-8`.

Componentes a tocar (apenas wrapper visual, lógica intacta):
- `src/components/admin/*KPI*`, `*Header*` se existir; senão estilizar inline nas páginas Dashboard/CRM/Clientes/etc.
- `src/styles/painel-elite.css` ganha novas utility classes: `.pe-card-kpi`, `.pe-section-header`, `.pe-table`, `.pe-toolbar`.

## 4. Escopo

✅ Inclui: tokens CSS, AppSidebar/AppTopbar refactor, novas classes utilitárias, aplicação nos cards KPI do Dashboard como referência.  
❌ Não inclui: mudanças em queries, edge functions, lógica de envio, esquema DB, ou nas páginas públicas (landing/licenciada).

## Ordem de execução
1. Atualizar tokens em `painel-elite.css` (paleta + novas classes utilitárias).
2. Refatorar `AppSidebar.tsx` (modo collapsed, auto-collapse).
3. Refatorar `AppTopbar.tsx` (botão toggle único + ícones PanelLeft).
4. Atualizar `Admin.tsx` (estado + persistência localStorage + props).
5. Aplicar classes `.pe-card-kpi` / `.pe-section-header` nos KPIs e headers do Dashboard como template; demais módulos herdam via tokens.
