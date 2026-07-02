# Auditoria Mobile Completa — iGreen Portal

Objetivo: verificar 100% da plataforma (públicas + admin + captação) em viewport mobile e corrigir problemas de layout, tap targets, tabelas densas e modais.

## Fase 1 — Auditoria (sem alterar código de produção)

Rodar auditoria automatizada em 3 viewports representativas:

- iPhone SE (375×667) — pior caso estreito
- iPhone 13 (390×844) — padrão iOS
- Pixel 7 (412×915) — padrão Android

### Rotas auditadas

**Públicas / cliente final (~25 rotas)**

- `/auth`, `/install`, `/reset`, `/politica-privacidade`
- Landings: `/:slug` (cliente) e `/licenciado/:slug`
- Conexões: `/conexao-telecom`, `/conexao-seguros`, `/conexao-solar`, `/conexao-placas`, `/conexao-livre`, `/conexao-club`, `/conexao-club-pj`, `/conexao-green`, `/conexao-expansao`
- `/cadastro/:slug`, `/proposta/:token`, `/r/:code`, `/demo`, `/404`

**Painel admin (`/admin` + abas)**

- Dashboard (TOP consumers, KPIs, gráficos)
- CRM / Kanban de vendas
- Pós-venda
- WhatsApp / chat interno
- Captação (game shell, OCR review, XP floater)
- Templates, Fluxos, Conhecimento, Saúde do bot
- Conversão, Reaquecimento, Portal Monitor
- Solar 3D (`/admin/solar/*`)
- Configurações e sub-abas

**Captação / operacional**

- Composer WhatsApp, modais de OCR, banners

### O que o audit mede em cada página

1. **Overflow horizontal** — `scrollWidth > innerWidth` (crítico)
2. **Tap targets** — botões/links com `min(width,height) < 44px` (crítico)
3. **Tabelas e listas densas** — `<table>`, grids com `overflow-x-auto`, cards sem `wrap`
4. **Modais / drawers** — Dialogs sem `max-h` mobile, sem scroll interno, com botões fora da viewport
5. **Tipografia** — fontes < 14px em conteúdo, contraste
6. **Navegação** — sidebar/drawer, tabs só-ícone sem label
7. **Formulários** — inputs sem `inputmode`/`autocomplete`, teclado cobrindo campo
8. **Imagens** — sem `aspect-ratio`, sem `object-cover`, quebrando layout

### Entregável da Fase 1

Um único arquivo `docs/auditoria/MOBILE_AUDIT.md` com:

```text
| Rota | Viewport | Severidade | Problema | Arquivo suspeito |
|------|----------|------------|----------|------------------|
| /admin (Dashboard) | 375 | 🔴 Alta | TopConsumersCard overflow horizontal | TopConsumersCard.tsx |
| ...                                                                             |
```

Agrupado por severidade:

- 🔴 **Alta** — página inutilizável (overflow, botão inalcançável, modal preso)
- 🟡 **Média** — usável mas frustrante (tap target 32-43px, fonte 12px)
- 🟢 **Baixa** — polish (spacing, alinhamento)

Plus: pasta `tests/e2e/output/mobile-audit-full/` com screenshots full-page de cada rota em cada viewport (~75 imagens).

## Fase 2+ — Correções por lote (uma nova aprovação sua entre cada lote)

Após você ver o relatório, proponho lotes agrupados por padrão de correção — não por página — para maximizar reuso:

1. **Lote overflow** — remover `min-width` fixos, trocar `flex` por `flex-wrap`, adicionar `overflow-x-auto` só onde faz sentido, `truncate` em textos longos.
2. **Lote tap targets** — bumpar `size="icon"` para `min-h-11 min-w-11`, adicionar `aria-label` onde falta.
3. **Lote tabelas/listas** — converter tabelas do admin em **card-list em `<md**` (padrão comum: `<table className="hidden md:table">` + `<div className="md:hidden">` com cards). Aplicável a TOP consumers, Kanban, listas de leads, templates, fluxos.
4. **Lote modais/drawers** — Dialogs ganham `max-h-[90dvh] overflow-y-auto` + footer sticky. Considerar migrar Dialogs grandes para `Sheet` (drawer bottom) no mobile.
5. **Lote nav/tabs** — tabs com scroll horizontal ganham fade nas bordas; tabs só-ícone ganham label visível ou viram `Select` no mobile.

Cada lote: você aprova → eu implemento → rodo o audit novamente na amostra afetada → confirmo verde.

## Detalhes técnicos

- Reaproveita `tests/e2e/mobile-audit.spec.ts` (já existe, cobre parte das rotas públicas). Vou estender para incluir admin autenticado usando `LOVABLE_BROWSER_SUPABASE_*` (já disponível na sandbox).
- Admin autenticado exige login mockado — se sessão Supabase não estiver `injected`, aviso e audito só o que dá.
- Zero mudança em lógica de negócio ou schema. Só CSS/JSX de apresentação.
- Uso `useIsMobile()` / `useIsLgDown()` já existentes; não crio breakpoints novos.
- Tokens semânticos preservados (nada de `text-white`/`bg-black`).

## Fora de escopo

- Refactor de arquitetura de páginas
- Reescrever o design de qualquer página (só ajustes responsivos)
- PWA / offline (skill separada)
- Performance / bundle size

## Ordem de execução

1. Aprovar este plano → entro em build mode
2. Rodo audit (Fase 1) → entrego `MOBILE_AUDIT.md` + screenshots
3. Você prioriza os lotes da Fase 2 → corrijo em ondas com sua aprovação entre elas
4. Ja analise tudo e ja aplique todas as fazes