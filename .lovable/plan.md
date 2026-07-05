## Diagnóstico completo (estrutura vs. o que está no banco)

Consultor `tvmensal12` (`9a52…c8a2`, iGreen 1241). Último sync `20:26 UTC` com `status='ok'`.


| Fonte                                                | O que existe no banco hoje                                                                                                                    | O que a UI mostra                                                                                                             | Onde vaza                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `customers` (origin=`igreen_sync`)                   | **22** (20 Sirlene + 2 sem lic.)                                                                                                              | Dashboard mostra 22 ✅ · Aba Clientes com filtro Telecom = 0 (correto, é outra tabela)                                         | ok                                                   |
| `network_members`                                    | **7** licenciados (Sirlene, Valdemir, Leandro, Wanderley, Salvino, Jonathan, Denilson)                                                        | Filtro "Licenciado" tanto no Dashboard como em Clientes só mostra **1** (Sirlene) porque lê de `customers.registered_by_name` | **bug**                                              |
| `consultant_network` (legado)                        | **0 rows**                                                                                                                                    | `useNetworkIgreenIds` lê daqui e devolve `[]` → analytics nunca escopa por IDs da rede                                        | **bug**                                              |
| `consultant_commission_settings.cadastro_igreen_ids` | `null`                                                                                                                                        | `myClientsSettings` fica sem os IDs → `filterMyClients` cai no fallback frágil por nome                                       | **bug**                                              |
| `igreen_telecom_customers`                           | **0** (portal retorna 0 para este consultor)                                                                                                  | Aba Clientes › Telecom = 0                                                                                                    | correto, mas UI não avisa "portal iGreen retornou 0" |
| `igreen_seguros_customers`                           | **0** (idem)                                                                                                                                  | Aba Clientes › Seguro = 0                                                                                                     | idem                                                 |
| `igreen_customer_boletos`                            | **1**                                                                                                                                         | Não aparece em Clientes; só em `carteira-green`                                                                               | ok pra este consultor                                |
| `igreen_consultant_metrics`                          | **1**                                                                                                                                         | Só em `carteira-green`                                                                                                        | ok                                                   |
| `igreen_sync_runs.counts`                            | tem só `customers`/`portfolio`; fase B (network/metrics/boletos/telecom/seguros/devolutivas/cashback) rodou mas **nada foi gravado** de volta | Consultor não sabe se rodou nem quantos vieram                                                                                | **bug**                                              |


Ou seja: o worker até busca tudo, mas (a) a UI nunca lista os 7 licenciados que existem em `network_members`, (b) analytics e "Meus Clientes" não sabem quais são os IDs iGreen da minha rede, (c) o consultor não tem visibilidade do que rodou na fase B (parece que nada foi sincronizado além de "22 clientes").

## Plano

### 1. `useNetworkIgreenIds` → ler de `network_members` (fonte atual do sync)

Trocar a query pra `network_members(igreen_id).eq(consultant_id, id)`. Manter `consultant_network` só como fallback pra contas legadas. Assim `myIgreenIds` no `useAnalytics` passa a incluir os 7 IDs da rede e qualquer cliente cadastrado por um licenciado direto (registered_by_igreen_id ∈ {124661, 134933, …}) entra no scope, mesmo quando `consultant_id` local não existe.

### 2. Preencher `cadastroIgreenIds` automaticamente a partir da rede

No `useMyClientsSettings.ts`, quando `consultant_commission_settings.cadastro_igreen_ids` vier vazio, montar a lista a partir de `network_members.igreen_id` do consultor (mesma origem do #1). O `filterMyClients` passa a acertar por ID em vez de depender do nome escrito no portal.

### 3. Novo hook `useNetworkLicenciados` (id + nome + clientes_ativos)

Devolve `Array<{ igreenId: string; name: string; clientesAtivos: number }>` a partir de `network_members`. Usado para popular os dropdowns "Licenciado" com **todos** os 7 nomes, mesmo os que não têm cliente ainda em `customers`. Aplica em:

- `CustomerManager.licenciadoOptions` (Aba Clientes): unir opções derivadas de `myCustomers` + `useNetworkLicenciados`. Deduplicar por igreen_id (chave), fallback nome.
- `DashboardTab.licenciadoOptions`: mesma união, e o valor selecionado passa a filtrar por igreen_id quando disponível (não só por nome).

### 4. Persistir contagens da fase B em `igreen_sync_runs.counts.extras`

Em `supabase/functions/sync-igreen-customers/index.ts` → `runSyncAllBackgroundPhase`: ao final, gravar em `counts.extras` do último run (`update igreen_sync_runs set counts = counts || jsonb_build_object('extras', out) where consultant_id=… order by started_at desc limit 1`). Sem isso o Dashboard nunca sabe se telecom/seguros/rede rodaram.

Também gravar timestamps individuais em `settings` (`last_sync_telecom:<consultantId>`, `last_sync_network:<consultantId>`, etc.) — hoje as chaves são globais, o que sobrescreve entre consultores.

### 5. Barra "Sincronizado: 22 energia · 7 rede · 0 telecom · 0 seguros · 1 boleto · 1 métrica · 05/07 20:26" no topo de Dashboard e Clientes

Componente novo `IGreenSyncStatusBar` que lê o último `igreen_sync_runs` do consultor (Phase A `customers.processed` + `counts.extras.*.processed/imported`) e mostra números explícitos. Se um bloco veio 0 do portal, mostra "0 no portal iGreen" (tooltip) em vez de sumir. Assim o consultor entende: "o worker rodou, o portal não devolveu nada de telecom pra você".

### 6. Empty state do Telecom/Seguros com CTA de re-sync

Em `CustomerManager`, quando `selectedTipo='telefonia'` e `telecomRows.length===0` mas o último `settings.last_sync_telecom:<id>` existe: renderizar "Portal iGreen não devolveu clientes de Telecom pra você (última verificação: …). Rodar de novo." com botão que dispara `runIgreenSync(consultantId, 'sync_telecom')`. Mesmo para seguros.

### 7. Fallback do worker: buscar network mesmo quando `sync_all` é rejeitado por WAF

Hoje se a Fase A cair em WAF, a Fase B nem começa. Manter comportamento, mas adicionar retry silencioso agendado só para `sync_network` + `sync_metrics` (endpoints leves) 60s depois. Isso protege o cenário "clientes já sincronizados ontem, hoje só quero atualizar minha rede".

### Arquivos afetados

- `src/hooks/useNetworkIgreenIds.ts` — trocar tabela para `network_members`, fallback legado.
- `src/hooks/useMyClientsSettings.ts` — hidratar `cadastroIgreenIds` de `network_members` quando o settings row estiver vazio.
- `src/hooks/useNetworkLicenciados.ts` — novo hook.
- `src/components/whatsapp/CustomerManager.tsx` — filtro "Licenciado" unido + empty state Telecom/Seguros com CTA de re-sync.
- `src/components/admin/DashboardTab.tsx` — mesma união no filtro; usa igreen_id.
- `src/components/admin/IGreenSyncStatusBar.tsx` — novo componente, montado em Dashboard e Clientes.
- `supabase/functions/sync-igreen-customers/index.ts` — gravar `counts.extras` no run + timestamps scoped por consultor + retry leve.

### Sem mudanças

- Nada de migration nova (só grava em colunas já existentes).
- Sem tocar em worker externo.
- Sem tocar em `myClientsFilter` (a hidratação do #2 já resolve).

Aprova pra implementar? SIM, MAS SEMPRE TREM QUE PREECHER AUTOMATICAMENTE DE TODOS OS CONSULTORES QUANDO CLICAR, ANALISE E IMPLANTE