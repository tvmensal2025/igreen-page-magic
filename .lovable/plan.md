# Refinamento visual — Aba WhatsApp (Clean Claro iGreen)

## Objetivo
Elevar o acabamento visual de toda a tela `/admin → WhatsApp` (header, lista de conversas, área de chat e Painel de Captação à direita) **sem alterar nenhuma função, handler, estado ou fluxo**. Só CSS, tokens e microajustes de layout.

## Direção visual
- Paleta: `#f7faf8` (fundo), `#e6f4ec` (surface verde claro), `#0f5132` (texto institucional / títulos), `#22c55e` (acento iGreen).
- Linguagem: SaaS moderno, clean, com cantos suaves (rounded-xl), bordas hairline, sombras quase imperceptíveis e bom uso de espaço em branco.
- Verde iGreen como acento único — usado em CTAs, barras de progresso, badges de status e indicadores de "online".

## Mudanças por região (somente visual)

### 1. Header da aba WhatsApp (`WhatsAppTab.tsx`)
- Reescrever o bloco de status superior ("WhatsApp Conectado · igreen 0c2…") como uma barra de respiro com:
  - Pílula verde clara com bolinha pulsante para "Conectado".
  - Tipografia do título mais leve e tracking sutil; subtítulo em `text-muted-foreground`.
  - Linha divisória hairline (`border-border/60`) ao invés da borda dura atual.
- Tabs (Dashboard / Conversas / Atendente IA / Envio em Massa / Templates / Agendamentos / Histórico): underline animado verde no item ativo, hover suave, contagem em pílula `bg-emerald-100 text-emerald-700`.

### 2. Lista de conversas (`ChatSidebar.tsx` + `CustomerListItem.tsx`)
- Campo de busca com ícone à esquerda, fundo `bg-muted/40`, foco com ring verde sutil.
- Cards de lead: aumentar padding vertical, avatar circular com ring verde para não lidos, nome em `font-medium`, preview em `text-xs text-muted-foreground line-clamp-1`.
- Item selecionado: barra lateral verde de 3px + fundo `bg-emerald-50/60` em vez do destaque atual.
- Badges de áudio/imagem em pílulas neutras com ícone.

### 3. Área central do chat (`ChatView.tsx` + `MessageBubble.tsx`)
- Header do contato: avatar maior, nome + telefone empilhados, botões "Captação 3/18", "IA ON", "Zerar" reorganizados em um cluster com `gap-2`, todos no mesmo padrão de pílula com ícone.
  - "IA ON" vira toggle verde quando ativo, cinza quando off.
  - "Zerar" em variante outline sutil com ícone de refresh.
  - "Captação X/Y" com mini barra de progresso embutida na pílula.
- Fundo da conversa: textura sutil quase invisível, separadores de data em chip flutuante centralizado.
- Bolhas: cantos `rounded-2xl`, sombra `shadow-sm`, bolha do bot em branco com borda verde clara, bolha do cliente em `bg-emerald-50`.
- Composer inferior: campo com `rounded-full`, botão enviar circular em verde iGreen com hover lift.

### 4. Painel de Captação direito (`CaptacaoPanel.tsx`) — peça central do redesign
- Cabeçalho do lead: nome em destaque, telefone discreto, badge "+ Nome" como ação ghost.
- **Bloco "Progresso do Cadastro"**:
  - Card com `bg-gradient-to-br from-emerald-50 to-white`, borda hairline verde.
  - Barra de progresso 3/18 com gradiente verde + percentual numérico grande à direita.
  - Linha "Progresso consistente · Próximo: CPF" com ícones (check verde, seta).
- Abas "Passos / Ficha": pill tabs com fundo branco e sombra interna, ativo em verde.
- Busca de passo + filtro "Pendentes": mesma linguagem da busca da sidebar.
- **Lista numerada (1. Boas-vindas, 2. Pergunta valor da conta, …)**:
  - Cada linha = card hairline `rounded-xl`, hover lift.
  - Número em círculo verde claro à esquerda, título em `font-medium`, ícones de mídia em cinza neutro.
  - Botão de envio (avião de papel) à direita em círculo verde sólido, hover escurece.
  - Passo concluído ganha check verde no número; pendente fica neutro.
- **Rodapé rosa "Enviar tudo / 3/18 / troféu"**:
  - Trocar o rosa por card branco com borda verde sutil e CTA principal "Enviar tudo (10)" em verde sólido, secundário ghost.
  - Indicador 3/18 e troféu viram badges discretos lado a lado.

### 5. Tokens (`index.css` + `tailwind.config.ts`)
- Garantir tokens HSL para a paleta escolhida sem quebrar o dark mode atual:
  - `--brand: 142 71% 22%` (verde institucional `#0f5132`)
  - `--brand-foreground: 0 0% 100%`
  - `--accent-emerald: 142 71% 45%` (`#22c55e`)
  - `--surface-soft: 150 40% 96%` (`#e6f4ec`)
- Adicionar utilitários `bg-brand`, `text-brand`, `bg-surface-soft`, `ring-brand` no Tailwind.
- Reaproveitar nos componentes acima ao invés de hex hardcoded.

## Não-escopo (não tocar)
- Nenhum handler, hook, query Supabase, lógica de socket, edge function, máquina de estados de captação, IA, OCR, send/receive de mensagens.
- Nenhuma mudança em props, contratos de componentes ou rotas.
- Nenhuma mudança no dark mode além de garantir que continua funcional.

## Arquivos previstos
- `src/index.css` (tokens)
- `tailwind.config.ts` (cores derivadas)
- `src/components/whatsapp/WhatsAppTab.tsx` (header + tabs)
- `src/components/whatsapp/ChatSidebar.tsx` (lista + busca)
- `src/components/whatsapp/CustomerListItem.tsx` (card do lead)
- `src/components/whatsapp/ChatView.tsx` (header do chat, botões, composer)
- `src/components/whatsapp/MessageBubble.tsx` (bolhas)
- `src/components/captacao/CaptacaoPanel.tsx` (painel direito completo)

## Validação
- Abrir `/admin → WhatsApp → Conversas` no preview em 1245px e em mobile.
- Conferir que: todos os botões continuam clicáveis, o painel de captação ainda abre/fecha, "IA ON" continua alternando, "Zerar" continua abrindo o AlertDialog, lista de passos continua disparando o envio.
- Screenshot antes/depois para validar o ganho visual.
