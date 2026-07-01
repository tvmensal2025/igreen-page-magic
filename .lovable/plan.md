## Problema

No dashboard `/admin`:
1. **Total de cadastros** e **Total de kWh** só contam clientes vinculados ao `consultant_id` do usuário logado (ou da equipe estrita). Cadastros feitos por outros licenciados da rede (identificados por `registered_by_igreen_id`) ficam de fora.
2. **Ranking de licenciados** aparece vazio (usa dados DEMO) porque a mesma consulta escopada exclui os clientes cujo `consultant_id` não bate com a equipe local — a maioria da carteira iGreen (`igreen_sync`) não tem `consultant_id` correspondente.

## Solução (só camada de leitura, sem mudar schema)

Ajustar `src/hooks/useAnalytics.ts` para, no bloco de `customers`, ampliar a coleta e usar `registered_by_igreen_id` como fonte de verdade para carteira iGreen.

### Passos

1. **Buscar `igreen_id` do consultor logado + `cadastro_igreen_ids` extras** (já é feito em `myClientsSettings`). Montar `myIgreenIds = [myIgreenId, ...cadastroIgreenIds]` (strings, sem nulos).

2. **Segunda query paralela** para trazer clientes da carteira por licenciado:
   - `.from("customers").select(<mesmos campos>).eq("customer_origin", "igreen_sync"|"igreen_extension").in("registered_by_igreen_id", myIgreenIds)` (paginada).
   - Fazer merge com `allCustomers` por `id` (Map) para não duplicar.

3. **Recalcular `scopedWalletCustomers`**:
   - Union: clientes com `consultant_id` na equipe + clientes com `registered_by_igreen_id ∈ myIgreenIds`.
   - Isso alimenta automaticamente `totalCustomers` (Total de cadastros), `totalKw` (Total de kWh) e `customersByStatus`.

4. **Ranking `topLicenciados`**:
   - Chave preferencial passa a ser `registered_by_igreen_id` (fallback para nome); rótulo exibido continua `registered_by_name` (ou `#igid`).
   - Ordenar desc por `deals`, top 10. Não usar mais o DEMO.

5. **`CustomerCharts.tsx`**: remover o array `DEMO_LICENCIADOS` e o fallback `topLicenciados?.length ? … : DEMO`. Se `topLicenciados` vier vazio, mostrar o estado "Nenhum licenciado vinculado ainda" já existente.

### Fora do escopo

- Não alterar schema, RLS ou tabelas.
- Não mexer em `TeamDashboard` (usa `useTeamRegistrations`, que já agrega por `registered_by_igreen_id`).
- Não tocar em captação/WhatsApp — mudança fica restrita à carteira iGreen que alimenta o dashboard admin.

### Verificação

- Abrir `/admin` como consultor com `igreen_id` preenchido e checar se: (a) Total de cadastros bate com a soma real da rede; (b) Total de kWh reflete o novo total; (c) Ranking lista os licenciados reais com contagem correta.
