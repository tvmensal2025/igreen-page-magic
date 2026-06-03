# Filtros novos no Envio em Massa

Hoje em **Admin → WhatsApp → Envio em Massa**, a aba "Base" (`ContactImporter`) lista todos os clientes da carteira e só permite filtrar por status / devolutiva / licenciada / busca. Para selecionar rapidamente quem realmente conversa no WhatsApp, faltam dois filtros pedidos:

1. **Últimas 48h no WhatsApp** — só quem mandou mensagem inbound nas últimas 48 horas.
2. **DDD** — escolher um ou mais DDDs (ex.: 11, 21, 31) para focar em uma região.

Os dois filtros são combináveis (AND com os filtros já existentes) e a seleção "Selecionar todos" passa a respeitar o resultado filtrado, deixando o envio em massa muito mais direto.

## O que muda

### 1. `src/components/whatsapp/ContactImporter.tsx`
- Estender a interface `Customer` interna com `last_inbound_at?: string | null`.
- Adicionar dois novos estados:
  - `only48h: boolean` (toggle).
  - `dddFilter: Set<string>` (multi-select).
- Helper `getDdd(phone)` que extrai o DDD a partir de `phone_whatsapp` (digits → se começar com `55` e tiver 12/13 dígitos pega `slice(2,4)`, senão pega os 2 primeiros).
- `dddOptions` calculados via `useMemo` a partir dos `customers` (lista ordenada de DDDs únicos válidos).
- `filteredCustomers` ganha:
  - se `only48h` → mantém apenas quem tem `last_inbound_at` e a diferença para `Date.now()` ≤ 48h.
  - se `dddFilter.size > 0` → mantém apenas quem o DDD do telefone está no set.
- UI na aba "Base" (logo abaixo dos filtros de status):
  - Botão chip "📲 Últimas 48h no WhatsApp" (ativa/desativa `only48h`).
  - `Popover` "DDD" igual ao de "Licenciada", listando `dddOptions` com checkboxes; mostra contagem ativa.
  - Contador resumido: "X contatos filtrados (Y conversaram nas últimas 48h)".

### 2. Carregar `last_inbound_at` para os clientes
A coluna existe em `public.customer_flow_state.last_inbound_at`. Vamos enriquecer a lista de clientes que já chega em `WhatsAppTab` → `BulkBlockSendPanel` → `ContactImporter` sem alterar a query principal do Admin:

- Em `src/components/whatsapp/BulkBlockSendPanel.tsx`, novo `useEffect` que, quando `customers` mudar, busca em lote `customer_flow_state` (`select customer_id,last_inbound_at`) com `in("customer_id", ids)` em chunks de 500 e monta um `Map<id, last_inbound_at>`.
- Construir `enrichedCustomers = customers.map(c => ({ ...c, last_inbound_at: map.get(c.id) ?? null }))` e passar para `<ContactImporter customers={enrichedCustomers} />`.
- Estender a interface `Customer` no `BulkBlockSendPanel` com o mesmo campo opcional.

Sem migração SQL — apenas leitura de uma coluna existente via supabase-js, respeitando RLS já vigente.

### 3. Detalhe UX
- Toggle "Últimas 48h" usa o ícone `MessageSquare` (já importado em outros painéis) para reforçar que o critério é "mandou mensagem no WhatsApp".
- DDD usa `Phone` / `MapPin`.
- Limpar filtro pelo "X" no chip; "Selecionar todos" continua aplicando sobre o resultado filtrado (lógica já existe).
- Nenhuma alteração no fluxo de disparo, dedupe, blocos, circuit breaker ou templates.

## Validação

- Abrir Admin → WhatsApp → Envio em Massa, ativar "Últimas 48h": só restam clientes com `last_inbound_at` dentro da janela.
- Selecionar DDD 11: lista reduz para telefones `5511…`.
- Combinar os dois: interseção correta; "Selecionar todos" adiciona só o conjunto filtrado.
- Sem filtros, comportamento atual permanece idêntico.
