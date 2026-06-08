# Plano — Responsividade real da aba Conversas (WhatsApp)

## Problema atual

Na largura do print (~1037px CSS, dpr 0.8 → ~830px reais) a tela tem 3 colunas fixas:
- Sidebar de conversas: **280px** (fixa via `--wa-side-w`)
- Chat: `flex-1` (sobra)
- Painel Captação (Passos/Ficha): **400px** (fixo via `--cap-side-w`)

Resultado: o chat fica com ~150-180px, mensagens cortam, e o painel direito de 400px ainda fica apertado (Passos não cabem, busca espremida, botão "Enviar tudo" gigante encosta no de troféu, composer some atrás da barra). Em mobile o problema é diferente: o painel inline aparece junto e cobre o composer.

## O que vou consertar

### 1. Breakpoints de coluna no `ChatView` + `WhatsAppTab`
- Sidebar de conversas só fixa em `lg` (≥1024px). Em `md` (768-1023px) volta a ser **estreita (200px)**; em `<md` continua escondida.
- Painel Captação inline (`hidden md:flex`) passa a ser `hidden xl:flex` (≥1280px). Abaixo de 1280px o painel vira **drawer/Sheet sobre o chat** (mesmo componente, modo `inline=false`) — abre via botão flutuante quando o consultor quiser ver Passos/Ficha. Assim o chat ganha a largura inteira quando o consultor está lendo/respondendo.
- Largura default do painel cai de 400px para **360px** e o mínimo de 320→**300px**.

### 2. `CaptureSheet` (modo inline) — caber em 300-360px
- Header: nome + telefone empilhados, botão "Nome" e "X" menores (`h-6 w-6`), badges com `flex-wrap`.
- Card de progresso: padding `p-2`, fontes `text-[10px]`, barra fina.
- Tabs Passos/Ficha: `grid-cols-2` ocupando 100% da largura, texto `text-[11px]`.
- Busca de passos: `h-7`, ícone menor, placeholder curto "Buscar…".
- Lista de passos: cada item com `min-w-0` + `truncate` no título, ícones de mídia em `gap-0.5`, botão de enviar reduzido para `h-7 w-7`.
- Rodapé fixo (`sticky bottom-0`) com `Enviar tudo (N)` em `flex-1` + troféu em `w-9 shrink-0`. Garantir `safe-area-inset-bottom` no mobile.
- Container raiz com `overflow-y-auto` próprio para que Passos/Ficha rolem sem empurrar o rodapé.

### 3. `ChatView` — composer e header sempre visíveis
- Wrapper do chat: `flex flex-col min-h-0` confirmado, `MessageComposer` em `shrink-0` (já está, garantir `sticky bottom-0` quando o painel inline some).
- Header do chat: nome + badges em `flex-wrap gap-1`, esconder ícones secundários atrás de um menu "⋯" abaixo de `md`.
- Quando o painel Captação está aberto como drawer (md), adicionar backdrop e fechamento por clique fora.

### 4. Mobile (< 768px)
- Nada de painel inline. O `CaptureSheet` (full Sheet) já existe — manter, mas:
  - Abrir minimizado em barra de 44px no rodapé (já faz).
  - Garantir que essa barra NÃO sobreponha o composer: o `ChatView` já lê `body[data-captacao-bar-open]` em alguns lugares; vou adicionar `padding-bottom: 52px` no container do composer quando a flag estiver setada.
- Sidebar de conversas continua "ou um ou outro" (já faz).

### 5. Sub-tabs do topo (Dashboard/Conversas/…) 
- Em < 640px só mostra ícones (já faz com `hidden sm:inline`), mas o container tem `overflow-x-auto` que cria scroll horizontal feio. Trocar para `flex-wrap` + reduzir gap → cabe em 360px sem rolar.

## Arquivos editados

- `src/components/whatsapp/WhatsAppTab.tsx` — breakpoints da sidebar (`lg` ao invés de só desktop), sub-tabs com `flex-wrap`.
- `src/components/whatsapp/ChatView.tsx` — painel Captação vira drawer abaixo de `xl`, header do chat responsivo, padding-bottom dinâmico do composer.
- `src/components/captacao/CaptureSheet.tsx` — densificar o modo `inline` (paddings, fontes, sticky footer, truncate).
- `src/components/captacao/CaptureStepsList.tsx` — `min-w-0` + `truncate` no título do passo, botão de envio menor.

## Fora do escopo
- Sem mudança de lógica de envio, captação, RLS ou edge functions.
- Sem mexer no `CustomerQuickViewDialog` (já foi ajustado antes).
- Sem trocar libs (continua Tailwind + shadcn).

## Como vou validar
Abrir o preview em 360px, 768px, 1037px (largura atual do bug) e 1440px. Em cada um:
1. Selecionar uma conversa.
2. Confirmar que mensagens aparecem inteiras, composer está visível e digitável.
3. Abrir Passos/Ficha (drawer ou inline conforme largura), confirmar que busca, lista, e "Enviar tudo" cabem sem cortar.
