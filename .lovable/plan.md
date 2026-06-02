## Problema

1. **iGreen importados aparecendo como lead** — A regra do projeto já diz que `customer_origin = 'igreen_sync'` **nunca** entra no funil de leads. Hoje o `KanbanDealCard` ainda mostra um badge "iG", o que sugere visualmente que eles podem virar lead. A `Central de Conversão` (`/admin/conversao`) também carrega esses clientes na lista e oferece "Cliente iGreen" como filtro de origem — isso é errado: a Central é para **leads que não converteram**, não para clientes já fechados.
2. **Central de Conversão "sumida"** — A rota `/admin/conversao` existe, mas **não há nenhum link/menu** no painel Admin (`src/pages/Admin.tsx` → array `tabs`). Por isso você não acha. Hoje só é alcançada por URL direta.

## O que vou fazer

### 1. Excluir `igreen_sync` da Central de Conversão

`src/pages/AdminConversao.tsx`

- No `fetchRows`, adicionar `.or("customer_origin.in.(whatsapp_lead,manual),customer_origin.is.null")` para nunca trazer cliente iGreen importado.
- Remover `"igreen_sync"` do tipo `OriginFilter`, do array de chips de filtro e do `ORIGIN_LABEL`.
- Função `originOf` deixa de tratar igreen.

### 2. Tirar o badge "iG" do Kanban e blindar o hook

`src/components/whatsapp/KanbanDealCard.tsx`

- Remover a variante `isIgreenClient` do `originBadge` (só sobram **Meta / Parc / WPP**). O ícone `Building2` no nome também sai.

`src/hooks/useKanbanDeals.ts`

- Na query principal de `crm_deals`, filtrar via `.in("customers.customer_origin", ["whatsapp_lead","manual"])` + or-null, garantindo que nenhum deal de `igreen_sync` apareça mesmo se o trigger falhar.

### 3. Adicionar "Conversão" como aba visível no Admin

`src/pages/Admin.tsx`

- No array `tabs` (linha ~179), adicionar `{ id: "conversao", label: "Conversão", icon: Flame }` **logo após "CRM"**.
- No `setActiveTab`, ao clicar em "conversao", em vez de renderizar inline, fazer `navigate("/admin/conversao")` (é página própria). Mais simples: tornar o item da nav um `<Link to="/admin/conversao">` em vez de um botão de tab.
- Resultado: aparece na barra superior do Admin entre **CRM** e **Clientes**, com badge "Novo" opcional.

### 4. (Opcional — confirmar com você) limpar deals órfãos

Se existirem `crm_deals` apontando para customer `igreen_sync` (criados antes do trigger), rodo uma migration para deletá-los. Posso só listar primeiro com SELECT e te mostrar a contagem antes de apagar.

## Fora de escopo

- Não mexo no fluxo de sync iGreen nem na aba "Clientes iGreen" — eles continuam intactos lá.
- Não mexo na classificação por IA, templates ou edge functions.

Confirma que posso seguir? E quer que eu inclua o passo 4 (limpeza de deals órfãos)?SIM