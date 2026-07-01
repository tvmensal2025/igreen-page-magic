## Entendimento

Cada consultor tem sua própria **rede** (downline). Hoje o dashboard só considera o `igreen_id` do próprio consultor (+ IDs extras configurados manualmente), então Rafael vê 157 (só ele) em vez de todos os cadastros feitos pelos ~978 licenciados da rede dele. O filtro "Todos os licenciados" deve trazer todos os consultores da rede; escolher um filtra para aquele consultor.

A tabela `consultant_network` já materializa a rede por `consultant_id` (Rafael tem 978 linhas, cada uma com um `igreen_id` de licenciado).

## Plano

Expandir a coleta de clientes para incluir todos os `registered_by_igreen_id ∈ rede do consultor`, sem mudar RLS/schema.

### 1. Novo hook `useNetworkIgreenIds(consultantId)`
- `select igreen_id from consultant_network where consultant_id = :id and igreen_id is not null` (paginado).
- Retorna `string[]` (deduplicado, como string).
- `staleTime` alto (10 min) — a rede muda pouco entre navegações.

### 2. `useAnalytics.ts`
- Aceitar novo parâmetro `networkIgreenIds?: string[] | null`.
- Ao montar `myIgreenIds`, concatenar: `[myIgreenId, ...cadastroIgreenIds, ...networkIgreenIds]` (Set, sem nulos).
- A segunda query paginada (`.in("registered_by_igreen_id", myIgreenIds)`) passa a trazer toda a rede automaticamente. Sem outras mudanças na lógica.
- Como `.in(...)` do PostgREST tem limite prático de URL, quebrar `myIgreenIds` em lotes de ~300 IDs e concatenar os resultados (dedup por `id`).

### 3. `DashboardTab.tsx`
- Chamar o novo hook e passar `networkIgreenIds` para `useAnalytics`.
- `filterMyClients` no `filteredMetrics` precisa aceitar essa rede também: expandir `myClientsSettings.cadastroIgreenIds` com `networkIgreenIds` antes de filtrar (só em memória, não persistir).
- Dropdown "Licenciado": já lista por `registered_by_name`, então passará a mostrar todos os consultores da rede automaticamente. Nenhuma mudança de UI.
- Toggle `me`/`team` continua igual (comportamento de líder direto preservado).

### 4. Verificação
- Rafael (`igreen_id=124170`): Total de cadastros deve subir de 157 para o somatório de todos os 978 licenciados da rede; Ranking deve listar os top 10 licenciados por número de cadastros; filtro por nome específico deve isolar aquele consultor.
- Consultor sem rede (`consultant_network` vazio): comportamento atual preservado (só vê os próprios).

### Fora do escopo
- Não mudar schema, RLS, edge functions.
- Não mexer em captação/WhatsApp/tráfego.
- Não introduzir visão "super admin global" — cada consultor continua limitado à própria rede.

### Notas técnicas
- Como `consultant_network.igreen_id` pode ter valores repetidos entre `sponsor` e o próprio consultor, usar `Set<string>` para dedup.
- Se `networkIgreenIds.length > 300`, fatiar em batches e emitir queries paralelas com `Promise.all`.
