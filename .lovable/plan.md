## Objetivo

Deixar a **Captação** com a mesma solidez do chat do WhatsApp: novas mensagens sobem o lead na lista, contador de não-lidas, realtime confiável, feed completo com mídia, agendamento inline e agrupamentos mais úteis.

## Diagnóstico (o que está errado hoje)

Comparando `src/components/captacao/CaptureLeadList.tsx` + `CaptureConversationFeed.tsx` com `src/components/whatsapp/ChatSidebar.tsx`:

1. **Lista não ordena por última mensagem.** `CaptureLeadList` ordena por `customers.created_at desc`. Quando chega msg nova em um lead antigo, ele **não sobe** — o consultor não vê que "está falando com você agora". No chat WA a ordem é por `lastMsgAt`.
2. **Sem badge de não lidas.** Não há coluna/estado `unread_count`. Msgs inbound novas só aparecem se o consultor clicar no lead.
3. **Realtime parcial.** Reassina só `customers`. Novas linhas em `conversations` (inbound) não disparam refresh — `lastMsg`/`lastMsgAt` ficam desatualizados até apertar 🔄.
4. **Ordem dentro dos grupos** ("Em atendimento" / "Em espera") herda a ordem de fetch (created_at). Deveria ser por `lastMsgAt` desc dentro de cada grupo.
5. **Feed com teto de 50 msgs** e sem "carregar mais". Chat antigo fica invisível.
6. **Sem separador visual de "Não lido / novo"** no feed (o chat WA marca a linha "Novas mensagens").
7. **Filtro por período aplicado ao `capture_started_at**` esconde leads antigos que voltaram a conversar hoje. Deveria considerar a atividade (`lastMsgAt`).
8. **Sem notificação sonora/toast** quando entra lead novo ou msg nova (chat WA tem).
9. **"Agendar ligação" só existe dentro do lead selecionado.** Deveria ter atalho no card da lista (menu de contexto ou botão hover), igual ao chat.
10. **Grupo "Em espera"** é uma bacia única — vira uma lista enorme. Falta subgrupos "Hoje / Ontem / Semana / Antigos" no padrão Intercom.
11. **Composer** não expõe indicador "cliente digitando…" nem status de entrega (✓/✓✓) por mensagem — o chat expõe.
12. **Contador do header** (`Conversas · N`) mostra o total do período mas não separa não-lidas.

## O que a Captação já faz bem (manter)

- Agrupamento "Em atendimento / Em espera" (útil e único da captação).
- Filtros por período com persistência.
- Modo seleção em lote → "Abrir atendimento" (fluxo bom).
- Ficha lateral colapsável (padrão Intercom).
- Sub-header com progresso, variante de fluxo, status WhatsApp.

## Escopo da correção (frontend + camada de dados leve)

### 1. Ordenação real por atividade

- Em `CaptureLeadList`: após montar `lastByCustomer`, **reordenar `leads` por `lastMsgAt ?? capture_started_at ?? created_at` desc**.
- Aplicar a mesma ordenação dentro de `GroupedLeads` (não confiar na ordem de entrada).

### 2. Realtime de mensagens

- Adicionar segundo canal Supabase escutando `conversations` filtrado por `consultant_id=eq.{consultantId}` (INSERT).
- Ao receber INSERT: atualizar `lastMsg`/`lastMsgAt` do lead correspondente, incrementar `unread_count` se `message_direction='inbound'` e o lead **não estiver selecionado**, e reordenar.
- Cleanup com `removeChannel` no unmount (padrão do memory).

### 3. Contador de não-lidas (client-side)

- Estado local `Map<customerId, number>` em `CaptureLeadList`.
- Zerar quando `selectedId === l.id` (ao abrir).
- Persistir "última visita" por lead em `localStorage` (`cap_last_seen_{id}`) para que unread sobreviva a reload.
- Renderizar badge verde no card + destaque em negrito no nome/último texto (padrão WA).

### 4. Subgrupos "Hoje / Ontem / Semana / Antigos"

- Em `GroupedLeads`, dividir `emEspera` por buckets de tempo baseados em `lastMsgAt ?? capture_started_at`.
- Sticky header para cada bucket, colapsável.
- "Em atendimento" mantém-se plano (curto por natureza).

### 5. Filtro por período usar atividade

- Trocar `leadAnchor` para preferir `lastMsgAt`, com fallback para `capture_started_at`/`created_at`.
- Assim leads antigos que voltaram a falar hoje entram no filtro "48h".

### 6. Feed com histórico completo

- Em `CaptureConversationFeed`: manter carga inicial de 50; adicionar botão "Carregar mais" no topo que busca as próximas 50 anteriores.
- Separador visual "── Novas mensagens ──" na primeira msg inbound recebida após abrir o lead.

### 7. Notificação de nova conversa

- Ao INSERT inbound em lead **não selecionado**, disparar toast discreto (Sonner) e opcional `new Audio(ping)` (respeitando `document.visibilityState`).
- Piscar borda esquerda do card por 4s.

### 8. Agendar ligação inline

- No card do lead (na lista), adicionar botão-ícone que aparece no hover/tap-long → abre o `ScheduleCallButton` já existente com o `customerId` daquele lead, sem precisar entrar no cockpit.

### 9. Ajustes de header

- Mostrar "N conversas · X não lidas" no header do painel.
- Botão de "Marcar todas como lidas" quando houver não-lidas.

## Fora do escopo

- Mudanças em backend/edge/schema.
- Alterar o fluxo do bot ou do composer.
- Persistir `unread_count` no banco (fica client-side por consultor/dispositivo).

## Detalhes técnicos

Arquivos a editar:

- `src/components/captacao/CaptureLeadList.tsx` — ordenação por atividade, realtime `conversations`, unread state, subgrupos de tempo, filtro por atividade, header com não-lidas, botão inline de agendar ligação, notificação.
- `src/components/captacao/CaptureConversationFeed.tsx` — "Carregar mais" e separador "Novas mensagens".
- (Opcional) `src/components/captacao/CaptureLeadCard.tsx` sem mudanças — a ficha continua igual.

Padrões:

- Realtime: `useEffect` + `supabase.channel(...).on('postgres_changes', ...).subscribe()` com cleanup em `removeChannel` (evita o loop de bill do memory).
- Persistência de estado local: `localStorage` com chaves prefixadas `cap_` (padrão já usado no arquivo).
- Sem hardcoded colors: usar tokens `primary`, `emerald-500`, `amber` já presentes.

## Critérios de aceite

- Novo INSERT inbound em conversa antiga → o lead **sobe para o topo** do respectivo grupo em ≤ 2s sem F5.
- Lead não selecionado com inbound novo → badge de contador aparece + card em negrito + toast.
- Abrir o lead zera o contador e o negrito.
- Filtro "48h" inclui leads antigos que responderam nas últimas 48h.
- Feed permite carregar histórico anterior a 100 msgs.
- Botão de agendar ligação funciona a partir do card sem abrir o cockpit.
- Sem regressão no seletor de período, modo seleção em lote e ficha colapsável.