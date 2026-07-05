## Diagnóstico (revisado com o print)

O print mostra o **Dashboard** do consultor `tvmensal12`, não a aba Clientes — todos os KPIs zerados ("Total de Cadastros 0", "0 kW", "R$ 0", "Nenhum licenciado vinculado ainda") mesmo o banco tendo **22 clientes iGreen ativos** com `consultant_id = auth.uid` desse consultor (último sync `2026-07-05 20:26 UTC`, `status='ok'`).

Confirmações do banco:

- 28 linhas em `customers` para `consultant_id=9a52cdf3-680a-4bfe-9841-70f8df70c8a2`, sendo 22 `igreen_sync`.
- `registered_by_igreen_id = NULL` em todas as 22 (o portal iGreen não devolve esse campo pra essa conta).
- `consultants.igreen_id = '1241'` — nunca vai bater com `NULL`.
- RLS `Owner select customers using (consultant_id = auth.uid())` cobre.

Cadeia do Dashboard: `DashboardTab.filteredMetrics` → `analytics.allCustomers` (de `useAnalytics`) → `walletOnly = filter(isIgreenWalletOrigin)` → `filterMyClients(walletOnly, {myIgreenId:'1241', cadastroIgreenIds:[network], consultantName:'tvmensal12'})`.

`useAnalytics` chama duas queries e concatena:

1. `.eq('consultant_id', userId)` → devolveria os 22 pelo escopo do consultor.
2. `.in('registered_by_igreen_id', myIgreenIds).in('customer_origin', [...])` → **descarta linhas com id NULL** (nem entra nesse ramo).

Ou seja, os 22 caem SÓ pelo ramo 1. Depois entram em `filterMyClients`, que já foi corrigido para deixar passar `igreen_sync` com id null. Portanto, no papel, o Dashboard **deveria** mostrar `Total = 22`. Como está mostrando 0, alguma dessas três coisas está acontecendo em runtime:

- (A) `useAnalytics` está servindo cache antigo de quando ainda não havia clientes (staleTime 5 min + placeholderData) e nunca sofreu invalidate depois da sync. O `handleDashboardSync` **não** invalida a query `analytics`, e o realtime que adicionei só refaz `fetchCustomers` do Admin — a query React-Query do dashboard fica intocada.
- (B) `useAnalytics` recebeu erro silencioso (RLS/JWT vencido) e `data` ficou `undefined`; o `filteredMetrics` retorna `null` e os cards caem no fallback `0` sem sinalizar erro.
- (C) `myClientsSettings` chegou antes do meu fix ficar em produção nesse consultor (cache do bundle). Descartável ao inspecionar via console.

O plano corrige as três frentes e coloca sinal explícito na tela.

## Plano

### 1. Invalidação real de `["analytics"]` após sync — em TODAS as telas que disparam sync

Em `DashboardTab.handleDashboardSync` e `CustomerManager.handleSyncIgreen`:

```ts
await queryClient.invalidateQueries({ queryKey: ["analytics"] }); // prefix, pega todas
await queryClient.invalidateQueries({ queryKey: ["customers-by-consultant"] });
```

Também disparar isso dentro do listener realtime já existente em `Admin.tsx`, para que qualquer INSERT/UPDATE em `customers` invalide o dashboard automaticamente.

### 2. Refetch imediato no clique de Sincronizar (não esperar o worker)

Hoje o Dashboard só chama `runIgreenSync` e espera o worker. Antes disso, chamar `queryClient.refetchQueries({ queryKey: ["analytics", userId] })` para reexibir o que **já está no banco** em <1s. Assim o consultor vê os 22 clientes imediatamente e depois o número se atualiza quando o worker termina.

### 3. Barra de diagnóstico visível no Dashboard (topo)

Linha discreta acima dos cards mostrando:

```
No banco: 22 iGreen · Exibidos: 22 · Filtro: Todos licenciados · Sync: 20:26
```

- Se `banco > 0` e `exibidos = 0` → mostrar botão "Limpar filtros".
- Se `banco = 0` → botão "Recarregar sem cache" (força `refetchQueries({queryKey:['analytics']})` + `getSession`/refresh).
- Se `analytics` = `undefined` (erro) → banner "Não consegui ler seus clientes agora — clique para tentar de novo" com botão de retry.

Isso elimina a ambiguidade atual entre "não tem dado" e "tem dado mas o filtro escondeu".

### 4. Log estruturado

No `queryFn` de `useAnalytics`, ao final: `console.info("[analytics.fetch]", { userId, total: allCustomers.length, wallet: walletCustomers.length, scoped: scopedWalletCustomers.length })`. O usuário abre o console (F12) e vemos exatamente onde caiu de 22 para 0.

### 5. Auto-refresh de sessão antes das queries pesadas

No topo do `queryFn` de `useAnalytics`:

```ts
const { data: sess } = await supabase.auth.getSession();
if (!sess.session || (sess.session.expires_at! * 1000) - Date.now() < 60_000) {
  await supabase.auth.refreshSession();
}
```

Cobre o cenário do consultor deixar a aba aberta horas — RLS devolve 0 sem erro visível quando o JWT expira.

### 6. Corrigir `waitIgreenSyncFinished` para aceitar `status='ok'`

Bug real: o worker grava `status='ok'` mas o helper só sai do loop se `status !== "running" && finished_at`. `ok` satisfaz, então isso já funciona — mas o toast de sucesso do CustomerManager só dispara se `finished` for truthy. Verificar que continua correto e ajustar se o helper timeoutar.

### Arquivos afetados

- `src/hooks/useAnalytics.ts` — refresh de sessão + log estruturado + retorno inclui `_debug` com contagens.
- `src/components/admin/DashboardTab.tsx` — invalidação de analytics no sync, refetch imediato, barra de diagnóstico no topo, banner de erro quando `analytics === undefined`.
- `src/components/whatsapp/CustomerManager.tsx` — invalidação com prefixo `["analytics"]` (sem consultantId) para pegar todas as variantes; barra de diagnóstico no topo da aba Clientes.
- `src/pages/Admin.tsx` — no listener realtime, disparar `queryClient.invalidateQueries({queryKey:["analytics"]})` além do `fetchCustomers({bypassCache:true})`.

### Sem mudanças

- Sem migration.
- Sem mexer no worker/edge.
- Sem mexer em `myClientsFilter` (já corrigido).

Aprova para eu implementar? analise se vai dar certo, cada codigo e cada linha.