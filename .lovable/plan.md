## Diagnóstico

O portal iGreen mostra **572 clientes** para `rafael.ids@icloud.com`. O worker sincroniza e o banco tem **576 clientes com `customer_origin = igreen_sync`** para esse consultor — ou seja, a sincronização está correta.

O que quebra na tela `Admin → Dashboard`:

- O card "Total de cadastros" usa `filterMyClients()` quando o escopo é **"Meu"**.
- Esse filtro só aceita clientes cujo `registered_by_igreen_id` bate com o meu `igreen_id` **ou** com um `igreen_id` que está na minha rede sincronizada.
- Dos 576 clientes da carteira, **539 têm `registered_by_igreen_id`** de **29 licenciados diferentes**. Muitos desses licenciados **não estão** em `cadastroIgreenIds` (rede só tem 33 membros no mês corrente, mas a carteira histórica traz cadastros de licenciados que já não estão ativos).
- Resultado: o filtro esconde ~260 clientes → mostra **312** em vez de 572.

Ou seja, não é bug de sync: é o KPI "Total de cadastros" usando um filtro "meus diretos" e chamando isso de "total". Para o consultor dono da conta iGreen, todo cliente que está na carteira dele **é dele**, mesmo que tenha sido cadastrado por um licenciado da rede.

## Correção

Uma única mudança de UI/lógica no card, sem mexer em sync nem em banco:

### 1. `src/components/admin/DashboardTab.tsx` — separar "carteira" de "meus diretos"

- No `useMemo filteredMetrics`, calcular **dois totais**:
  - `walletTotal` = `analytics.allCustomers.filter(isIgreenWalletOrigin)` **sem** `filterMyClients` (com o filtro de licenciado ainda aplicando quando `selectedLicenciado !== "all"`). Esse é o número que precisa bater com o portal (572).
  - `myDirectTotal` = resultado atual, com `filterMyClients` aplicado (312 — cadastros diretos meus + rede ativa).
- Renderizar o `StatCard` "Total de cadastros" usando `walletTotal` como valor principal. Abaixo do número, adicionar um sub‑rótulo discreto: `· diretos: {myDirectTotal}` quando `scope === "me"` e `walletTotal !== myDirectTotal`.
- Um pequeno tooltip / `title` explicando: "Total sincronizado do portal iGreen. 'Diretos' = cadastros feitos pelo seu igreen_id ou pela sua rede ativa."
- Os demais gráficos e agregações do dashboard continuam usando `filtered` (com filtro "meus") — só o KPI de total muda.

### 2. Fallback defensivo em `src/hooks/useAnalytics.ts` (só se necessário)

Se depois da correção o número ainda estiver abaixo de 572, é porque a query paginada em `customers` está trazendo menos linhas do que existe. A paginação atual usa `range(page * 1000, (page+1)*1000 - 1)` e para quando `data.length < 1000` — está certo para 576 rows. Não precisa mexer, mas incluo verificação rápida no console para garantir.

### 3. Sem migração e sem mudança no worker

- Worker está correto (v18, retorna 572).
- Edge function `sync-igreen-customers` está correta (persiste 576).
- Nenhum schema muda.

## Arquivos afetados

- `src/components/admin/DashboardTab.tsx` (edit, ~15 linhas no bloco `filteredMetrics` + JSX do `StatCard`)

## Validação

- Recarregar `/admin` como rafael, escopo "Meu" → "Total de cadastros" deve mostrar **572** (com sub‑rótulo `· diretos: 312`).
- Trocar filtro de Licenciado → total passa a refletir a seleção.
- Escopo "Equipe" (para líderes) segue somando a equipe inteira.
- Como censuralivrealiaad tem só 141 clientes e todos direto dele, o número deve continuar 141 sem sub‑rótulo.
