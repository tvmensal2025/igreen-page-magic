# Habilitar scroll horizontal onde faltar

## Problema
No mobile (e às vezes no PC em telas estreitas), várias áreas cortam o conteúdo à direita sem permitir arrastar — ex.: cards da Central de Anúncios (métricas "Impressões, Cliques, Conversas, Clientes interessados Meta/WhatsApp, Gasto"), tabelas do Admin, modais grandes e o Kanban.

A causa raiz é uma combinação de:
- `body { overflow-x: hidden !important }` em `src/index.css` (linha 201) — bloqueia qualquer scroll horizontal da página.
- Containers de conteúdo do Admin sem `min-w-0` / `overflow-x-auto` — o conteúdo largo é apenas cortado.
- Regra `.kanban-safe-scroll` que força `overflow-x: hidden` no viewport do Radix ScrollArea.

## O que muda (apenas front-end / apresentação)

### 1) `src/index.css`
- Remover `overflow-x: hidden !important` do `body` e substituir por `overflow-x: clip` apenas em landing pages públicas (via classe utilitária `.page-clip-x`) — assim o app admin volta a poder rolar lateralmente quando um filho estourar.
- Adicionar utilitário global:
  ```css
  .scroll-x-fallback { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .scroll-x-fallback > * { min-width: max-content; }
  ```
- Ajustar `.kanban-safe-scroll` para NÃO forçar `overflow-x: hidden` — trocar por `overflow-x: auto`, mantendo `min-width: 0` para não travar o flex pai.

### 2) Wrapper de conteúdo do Admin
- Localizar o container principal do `/admin` (dentro de `Admin.tsx` / `ResizableShell`) e envolver a área de conteúdo com:
  ```tsx
  <div className="flex-1 min-w-0 overflow-x-auto">
    {children}
  </div>
  ```
- Isso libera o gesto de arrastar horizontalmente sempre que uma tela (Central de Anúncios, tabelas, etc.) exceder a largura visível — sem quebrar o layout das que já cabem.

### 3) Cards de campanha (Central de Anúncios)
- Na fileira de métricas ("Impressões / Cliques / Conversas / Clientes Meta / Clientes WhatsApp / Gasto"): trocar o grid fixo por um flex com scroll horizontal em telas pequenas:
  ```tsx
  <div className="flex gap-3 overflow-x-auto snap-x scroll-x-fallback md:grid md:grid-cols-6 md:overflow-visible">
    {/* cada métrica com className="min-w-[140px] snap-start" */}
  </div>
  ```
- Mesmo padrão para a barra "Impressões hoje / Cliques hoje / Gasto hoje …" que hoje é cortada por um menu flutuante.

### 4) Tabelas do Admin (clientes, financeiro, rede, etc.)
- Padronizar todas as tabelas com o wrapper já usado em `TeamRankingTab` / `NetworkPanel`:
  ```tsx
  <div className="overflow-x-auto -mx-4 sm:mx-0">
    <table className="min-w-[720px] w-full">…</table>
  </div>
  ```
- Aplicar em qualquer `<table>` no `src/components/admin/**` que ainda não tenha esse wrapper.

### 5) Diálogos / Modais grandes
- Em `DialogContent`, adicionar `max-h-[90dvh] overflow-y-auto` e trocar conteúdos internos largos por wrappers `overflow-x-auto`. Sem mexer na lógica dos modais.

### 6) Kanban
- Confirmar que os boards (`KanbanBoard`, `PosVendaKanban`, `SalesPipelineBoard`) usam `flex gap-… overflow-x-auto` no container das colunas, com cada coluna `w-72 shrink-0`. Ajustar onde estiver faltando e remover a trava `overflow-x: hidden` mencionada no item 1.

## Não muda
- Nenhuma lógica de negócio, queries, edge functions, migrations.
- Comportamento em desktop largo continua idêntico (o `md:` mantém grids atuais).
- Sidebar e comportamento de "sempre modo computador" já resolvidos antes.

## Validação
- Abrir no viewport atual (~514px) `/admin` → Central de Anúncios: deslizar cards de métrica lateralmente sem cortar "Gasto".
- Tabelas de Clientes/Financeiro/Rede: arrastar horizontalmente até a última coluna.
- Modais de criar campanha e detalhe de lead: rolar tanto vertical quanto horizontal quando necessário.
- Kanban: arrastar colunas laterais no mobile.
- Desktop 1440px: nada deve regredir (grids intactos).
