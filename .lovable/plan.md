## Diagnóstico

O botão **Agendar ligação** JÁ está no `CaptureLeadList.tsx` (linha 994) e no `CaptureSheet.tsx` (linha 507), mas na lista ele está com `opacity-0 group-hover:opacity-100` — só aparece ao passar o mouse. Em telas touch, monitor grande ou quando o consultor não passa por cima, ele fica invisível. Por isso "sumiu".

Além disso, comparando com o chat do WhatsApp (`ChatView`), a Captação ainda tem lacunas menores que valem consolidar agora.

## O que fazer

### 1. Botão Agendar sempre visível no card (fix principal)
- Em `src/components/captacao/CaptureLeadList.tsx`: remover `opacity-0 group-hover:opacity-100`. Deixar o ícone de telefone com `opacity-70 hover:opacity-100`, tamanho `icon-xs` (24px) pra caber sem competir com a barra de progresso.
- Manter `onClick={(e) => e.stopPropagation()}` pra não abrir o cockpit ao clicar.
- Ocultar apenas no `selectMode` (batch).

### 2. Botão no header do CaptureSheet
- Hoje `ScheduleCallButton` aparece só no rodapé de ações. Adicionar também no header do sheet (ao lado do CloseCaptureButton) igual ao `ChatView`, pra ficar 1 clique quando o lead já está aberto.

### 3. Lacunas remanescentes vs. ChatView

a. **"Iniciar atendimento" (start-customer-attendance)** — existe no `ChatView` mas não no cockpit da Captação. Adicionar botão no header do `CaptureSheet` quando o lead ainda não teve saudação enviada (mesma edge function).

b. **Status de entrega por mensagem (✓/✓✓/lido)** — o feed atual mostra só timestamp. Renderizar os ticks quando `conversations.message_status` existir (`sent`, `delivered`, `read`), reaproveitando o helper que o ChatView usa.

c. **Indicador "cliente digitando…"** — o ChatView escuta presence do Evolution. Adicionar o mesmo listener no `CaptureConversationFeed` (subheader do lead selecionado).

d. **Busca dentro da lista** — o ChatView tem input de busca por nome/telefone; a Captação só tem filtros por período/status. Adicionar `<Input>` de busca no topo da lista (client-side sobre `leads`).

e. **Atalho "Marcar como não lido"** — inverso do "Ler tudo". Menu de contexto no card (botão de 3 pontinhos ou long-press) que força `unread_count = 1` e regrava `cap_last_seen_{id}` no `localStorage` como 0.

f. **Contador de "conversas ativas hoje"** no header — hoje só mostra total e não-lidas. Adicionar "X ativas hoje" (leads com `lastMsgAt >= startOfDay`) pra o consultor medir volume do dia.

### Fora do escopo
- Mudanças em edge functions, schema ou tabelas.
- Mexer em fluxos do bot, composer, ou lógica de encerramento.
- Persistir unread no banco (segue client-side).

## Arquivos afetados

- `src/components/captacao/CaptureLeadList.tsx` — botão sempre visível, busca client-side, contador "ativas hoje", menu "marcar não-lido".
- `src/components/captacao/CaptureSheet.tsx` — botão Agendar + Iniciar atendimento no header.
- `src/components/captacao/CaptureConversationFeed.tsx` — ticks de status, presence "digitando".

## Critérios de aceite

- Ícone de telefone visível em todos os cards da Captação sem precisar hover, e clicável sem abrir o cockpit.
- Header do CaptureSheet tem "Agendar ligação" e "Iniciar atendimento" ao lado do botão de encerrar.
- Feed mostra ✓/✓✓ nas mensagens outbound quando o Evolution reporta status.
- Barra de busca filtra a lista por nome ou telefone em tempo real.
- Header da lista exibe "N conversas · X não-lidas · Y ativas hoje".
- Card tem opção "marcar como não lido" que devolve o badge sem precisar aguardar nova mensagem.
