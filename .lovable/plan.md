# Plano — Painel lateral compacto e legível (reverter drawer + densificar + contraste)

## O que vou fazer

### 1. Reverter o drawer — painel volta a ser **coluna lateral inline** em md+
- Trocar `isXl` (≥1280) por `!isMobile` (≥768): em qualquer desktop/tablet o painel Captação fica fixo à direita do chat.
- Remover o Sheet overlay que estava aparecendo embaixo no seu 1037px.
- Em < 768px (celular real): continua sendo o Sheet de baixo (já funcionava).

### 2. Densificar o painel inline para caber confortável em 280-360px
- **Header**: avatar/badge menor (28px), título `text-xs`, telefone `text-[10px]`, padding `p-2`.
- **Card de progresso**: padding `p-1.5`, números `text-xs`, barra com `h-1.5`, frase motivacional escondida em telas estreitas.
- **Tabs Passos/Ficha**: altura `h-7`, fonte `text-[10px]`, ícones `w-3 h-3`.
- **Busca de passo**: input `h-7 text-[11px]`.
- **Lista de passos**: cada item com padding reduzido, título `text-[11px] truncate`, botão enviar `h-7 w-7`, ícones de mídia compactos.
- **Rodapé**: botão "Enviar tudo" sem texto longo quando estreito (só ícone + número), CADASTRAR ocupa o restante. Altura `h-8`.

### 3. Largura padrão menor para o painel inline
- Default cai de 360px → **300px**.
- Range do resizer: min 260px, max 480px.
- Sidebar de conversas mantém 240px (já ajustado).
- Em 1037px isso deixa: 240 sidebar + ~497 chat + 300 painel = todos respiram.

### 4. Cores e contraste — corrigir ilegibilidade
- O fundo `bg-lime-100` que entrou no preview de mensagem ficou claro demais sobre o tema escuro. Reverter para o token semântico do design system: `bg-card border-border` (combina com light/dark mode).
- O título "PROGRESSO DO CADASTRO" estava `text-white` num fundo claro — trocar para `text-foreground` (segue o tema).
- Cabeçalho do painel: gradiente mais discreto (`from-primary/8 to-card` em vez de `from-primary/10 via-primary/[0.04]`).
- Bordas dos cards de status (cinza/amarelo) ganham contraste maior no dark mode (`border-amber-500/50` em vez de `/20`).
- Garantir que ícones de status (Extração não determinada / IA não analisou) usem `text-foreground` em vez de tons claros sobre fundo claro.

### 5. Sub-tabs do topo (Conversas/Atendente IA/…)
- Reverter `flex-wrap` que ficou feio: voltar para `overflow-x-auto` mas com fade nas pontas e mostrar label sempre que couber. Em < 640 só ícones (já fazia).

## Arquivos editados

- `src/components/whatsapp/ChatView.tsx` — `isXl` → `!isMobile`, default 300px, range 260-480.
- `src/components/whatsapp/WhatsAppTab.tsx` — sub-tabs voltam a `overflow-x-auto` com gradiente fade.
- `src/components/captacao/CaptureSheet.tsx` (modo inline) — densificar todos os blocos do header/tabs/rodapé conforme item 2; trocar `bg-lime-100` e `text-white` por tokens semânticos.
- `src/components/captacao/CaptureStepsList.tsx` — densificar itens da lista (padding, fontes, botão).

## Fora do escopo

- Lógica de envio, captação, OCR, RLS, edge functions — intactas.
- Modo mobile (< 768px) — continua com Sheet por baixo como já funcionava.
- Sem mudar tema global; só ajustar tokens onde o contraste quebrou.

## Como vou validar

Preview em 768px, 1037px (largura atual), 1280px e 1920px:
1. Painel sempre visível à direita.
2. Todo o texto do painel legível com bom contraste (sem branco em fundo claro nem verde-limão sobre escuro).
3. Chat com largura confortável, composer sempre digitável.
4. Passos e Ficha rolam dentro do painel sem cortar header nem rodapé.
