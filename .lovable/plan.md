## Objetivo
Clicar em um cliente do card **TOP 10 Clientes por Consumo** abre o **chat interno** desse cliente (aba WhatsApp do Admin), reusando o mesmo mecanismo que a lista de clientes já usa.

## Como vai funcionar

O Admin já tem tudo pronto: `handleOpenChatFromCustomer(phone)` seta `pendingChatPhone` e troca `activeTab` para `"whatsapp"`. Outras abas (ex: Parceiros, linha 443/520) já disparam isso. Basta ligar o TOP 10 nesse mesmo fio.

1. **`Admin.tsx`** — passar `onOpenChat={handleOpenChatFromCustomer}` para `<DashboardTab>` (linha 398).
2. **`DashboardTab.tsx`** — aceitar `onOpenChat?: (phone: string) => void` em `DashboardTabProps` e repassar para `<TopConsumersCard onOpenChat={onOpenChat} />` (linha 289).
3. **`TopConsumersCard.tsx`** — 
   - Adicionar `phone_whatsapp?: string | null` na interface `Customer`.
   - Nova prop `onOpenChat?: (phone: string) => void`.
   - `<li>` vira `<button type="button">` com `text-left w-full`; onClick chama `onOpenChat(customer.phone_whatsapp)` após normalizar com `normalizeBrazilPhone` (helper já existente em `src/lib/phone.ts`).
   - Se o cliente não tem telefone válido, o botão fica `disabled` com `opacity-60 cursor-not-allowed` e `title="Cliente sem WhatsApp cadastrado"`.
   - Ícone `MessageCircle` discreto ao lado do "Conta" para deixar visível que a linha abre chat.
4. **`useAnalytics.ts`** — o `select` já inclui `phone_whatsapp`; apenas garantir que o campo chega até `filteredCustomers` (checar no mapeamento final; se faltar, adicionar).

## Fora de escopo
- Mudar o comportamento do chat em si (composer, envio, template).
- Abrir wa.me / WhatsApp externo.
- Registrar clique em analytics/auditoria.

## Detalhes técnicos
- Nada de nova rota ou modal — reusa 100% o pipeline `pendingChatPhone` → aba `whatsapp` → `WhatsAppTab` já testado.
- `normalizeBrazilPhone` cuida de números salvos como "11999998888", "(11) 99999-8888", "+55 11 99999-8888", etc.
- Se o número for inválido (validado por `validateBrazilPhone`), botão desabilitado — evita levar o admin pra um chat vazio.
