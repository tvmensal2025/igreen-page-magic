## Diagnóstico

Fiz consulta direta no banco e confirmei que **os 22 clientes SIM foram gravados** no consultor `tvmensal12` (id `9a52cdf3-680a-4bfe-9841-70f8df70c8a2`, portal `censuralivrealiaad@gmail.com`, consultor 124661) — última atualização `2026-07-05 02:08:21`. Todos com `customer_origin='igreen_sync'`, `consultant_id` correto e `registered_by_igreen_id = NULL` (a API do portal novo não devolve esse campo).

Ou seja: o worker sincronizou, a edge gravou. O problema restante é **na tela** — o Admin.tsx exibe cache antigo do `sessionStorage` e o filtro de "Meus clientes" ainda precisa ser combinado com refresh forçado após sincronizar.

Também identifiquei fragilidades no fluxo cliente ↔ worker que fazem parecer que "não puxou":

1. **Cache de `sessionStorage` (`customers_cache_<userId>`)** em `src/pages/Admin.tsx` é lido no `useState` inicial e só é sobrescrito quando `fetchCustomers` termina com sucesso. Se o consultor abre a aba antes do fetch responder, vê a lista antiga (0 registros da primeira vez). Após clicar "Sincronizar", chamamos `onCustomersChange()`, mas ele mantém o cache atual até chegar a resposta — nenhum "loading" visível.
2. **Sem invalidação do React Query** para hooks que dependem dos clientes (`useMyClientsSettings`, `analytics`), o `sessionStorage` fica dessincronizado.
3. Após WAF/`already_running` a UI mostra sucesso do agendamento de retry, mas não faz polling do `igreen_sync_runs` — o consultor não sabe quando terminou de fato.
4. **Sem realtime**: se o worker terminar 5–10s depois do toast, o usuário precisa recarregar manualmente.

## Plano

### 1. Refresh forçado + invalidar cache no clique de Sincronizar
Em `src/pages/Admin.tsx`:
- Expor `fetchCustomers({ bypassCache?: boolean })` que apaga `sessionStorage.customers_cache_*` antes do refetch.
- Após qualquer `runIgreenSync` bem-sucedido, chamar `fetchCustomers({ bypassCache: true })` e re-buscar em 5s (worker às vezes grava alguns segundos depois da resposta HTTP).

### 2. Polling do run mais recente
Em `src/lib/igreenSync.ts` adicionar `waitIgreenSyncFinished(consultantId, runId?)`:
- Faz `SELECT status, counts FROM igreen_sync_runs ORDER BY started_at DESC LIMIT 1` a cada 4s por até 90s.
- `CustomerManager.handleSyncIgreen` usa esse helper: mostra "Aguardando finalizar..." e só chama `onCustomersChange()` quando `status IN ('success','partial')`.

### 3. Realtime opcional em `customers`
Adicionar migration `ALTER PUBLICATION supabase_realtime ADD TABLE public.customers;` e assinar em `Admin.tsx`:
```ts
supabase.channel(`cust-${userId}`)
  .on('postgres_changes', { schema:'public', table:'customers', filter:`consultant_id=eq.${userId}` }, () => fetchCustomers({ bypassCache:true }))
```
Assim, quando o worker terminar tarde, a lista aparece sozinha.

### 4. Botão "Limpar cache local" no card de conexão iGreen
Em `IGreenConnectionCard.tsx`, ação extra:
- Apaga `sessionStorage.customers_cache_<uid>` e `sync_cooldown_until`, chama `fetchCustomers({ bypassCache: true })`. Facilita suporte quando o usuário reporta "não apareceu".

### 5. Log defensivo na edge
Em `sync-igreen-customers/index.ts`, logar contagem final gravada (`upserts`, `consultant_id`) antes de responder. Isso me deixa correlacionar "worker devolveu 21" com "gravou X" nos próximos incidentes.

### Arquivos afetados
- `src/pages/Admin.tsx` — `fetchCustomers({bypassCache})`, realtime, wiring pós-sync
- `src/components/whatsapp/CustomerManager.tsx` — usar `waitIgreenSyncFinished`
- `src/components/admin/IGreenConnectionCard.tsx` — botão "Recarregar clientes"
- `src/lib/igreenSync.ts` — helper `waitIgreenSyncFinished`
- `supabase/migrations/*.sql` — habilitar realtime em `customers`
- `supabase/functions/sync-igreen-customers/index.ts` — log de contagem

Sem mudanças de schema (só publication) e sem mexer no worker desta vez — o worker já está entregando os dados corretamente.

Aprova pra eu implementar?
