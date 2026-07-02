## Análise: TOP 10 Clientes por Consumo

Auditei o card `TopConsumersCard.tsx` contra o banco (562 clientes iGreen, 555 com `media_consumo`). Achei **6 problemas de dado desinformado/desatualizado** — nenhum é bug de segurança, mas o card hoje engana o usuário.

### Achados

**1. Coluna "Conta" está sempre "—" (100% dos clientes)**
`electricity_bill_value` é `NULL` para **todos os 562 clientes iGreen** — o portal não devolve esse campo. O Dashboard já contorna isso estimando `media_consumo × R$ 0,95` (linha 116-122 de `DashboardTab.tsx`), mas o card não usa essa fórmula. Resultado: o KPI mais visível da linha ("Conta") não aparece nunca.

**2. Unidade errada: "kW" em vez de "kWh"**
`media_consumo` é consumo mensal em **kWh**, não potência instantânea (kW). Linha 57: `{...} kW`.

**3. Badge "—" ou slug técnico em 8 de 10 clientes**
`STATUS_BADGE` só cobre 5 status (`approved`, `active`, `pending`, `rejected`, `devolutiva`). Os status reais do top 10 hoje são `contato_incompleto`, `awaiting_signature`, `data_complete`, `registered_igreen`, `contract_sent` — todos caem no fallback e mostram o slug cru ou "—". O Dashboard tem o mapa completo em `statusLabels` (linha 130) — está duplicado sem sincronia.

**4. Cliente de teste no top real**
"EMPRESA TESTE BATERIA LTDA" (1500 kWh) aparece no top 10 de produção. Card não filtra `is_sandbox = true` nem nomes claramente de teste.

**5. "Frescor do dado" invisível**
O último sync completo foi ontem 01/jul às 23:16 (`igreen_sync_runs`). O usuário não vê essa data no card, então não sabe se está olhando dado de 1 hora ou de 1 semana atrás. Um cliente com sync travado (o de hoje 09:00 está `running` há horas) veria dado defasado sem alerta.

**6. Card sem ação**
Clicar num cliente do top não faz nada. O objetivo do card ("onde está sua maior comissão") pede que o usuário consiga abrir o cliente pra agir (cobrar, atualizar, contatar).

### Correções propostas

1. **Estimar `Conta` quando faltar** — reusar a fórmula do Dashboard (`kwh × 0,95`) e marcar o valor com um `~` discreto pra indicar estimativa, com tooltip "Estimado — portal iGreen não devolve valor da conta".
2. **Trocar "kW" por "kWh"** (linha 57).
3. **Mapa de status completo** — importar/compartilhar o `statusLabels` do Dashboard em vez de duplicar, e adicionar cores para `contato_incompleto` (vermelho suave — pede ação) e `awaiting_signature` (âmbar).
4. **Filtrar sandbox e teste óbvio** — `!c.is_sandbox` + descartar nomes que casem `/teste|test|empresa teste/i`.
5. **Rodapé com "Atualizado há X"** — buscar `max(finished_at) WHERE status='ok'` de `igreen_sync_runs` e exibir "Atualizado há 2h" no header do card; se > 24h, badge âmbar "Dado defasado — rode o sync".
6. **Linha clicável** — envolver o `<li>` num handler que abre o CustomerDetailDrawer (já existente no admin) pelo `customer.id`.

### Fora de escopo (não tocar agora)
- Sync do iGreen travado em `running` — problema de backend, é outro plano.
- Padronização do campo `electricity_bill_value` no schema — só resolveria se o portal iGreen expusesse; hoje a estimativa é o certo.

### Diagnóstico técnico

Arquivos a mexer:
- `src/components/admin/TopConsumersCard.tsx` — recebe `electricity_bill_value` cru, sem `is_sandbox`, sem hook de última sincronização, sem onClick.
- `src/components/admin/DashboardTab.tsx` — passar `customers` já com `bill_estimated` calculado (ou passar a função `billOf`), e passar `lastSyncAt` + `onOpenCustomer`.
- Novo helper (opcional): `src/components/admin/lib/customerStatusLabels.ts` — extrair `statusLabels` + `STATUS_BADGE` do Dashboard para reuso.