## Problema

Hoje a "Recorrência garantida" só usa a carteira sincronizada localmente (os 572 clientes iGreen). Isso subestima o valor: a maior parte da sua receita de 1% vem de clientes da **rede abaixo** que não estão nessa carteira local — eles estão registrados apenas em `network_members` (agregados por licenciado).

## Nova fórmula

```text
Recorrência garantida (mês) =
    4%  x  Σ conta_mensal(cliente aprovado direto meu)
  + 1%  x  Σ base_mensal(licenciado da minha rede, qualquer nível)
  + 0,5% x (soma dos dois) se isGestor
```

### Direto (4%) — igual ao que já temos
Base: carteira sincronizada (`walletForTotal`), apenas `status = approved`, apenas quando `registered_by_igreen_id === meuIgreenId`. `bill = electricity_bill_value` (ou `media_consumo × 0,95` como fallback).

### Indireto (1%) — NOVO, via `network_members`
Não temos as contas individuais da rede, mas temos o agregado mensal por licenciado. Usar:

```text
base_licenciado = gp_mes  (green points do mês, já é a base bonificável)
```

Somar `gp_mes` de **todos os `network_members` do consultant_id logado** (rede inteira, todos os níveis — a tabela já é o downline completo).

### Gestor (+0,5%)
Aplicar sobre `direto + indireto` quando `isLeader` for `true` (proxy atual).

## Implementação

Arquivo único: `src/components/admin/DashboardTab.tsx`

1. Novo hook `useNetworkGpMes(userId)` (ou inline no `useQuery` já existente): `SELECT sum(gp_mes) FROM network_members WHERE consultant_id = :userId`.
2. No `useMemo filteredMetrics`:
   - `diretoBase = Σ bill(c)` para aprovados com `registered_by_igreen_id === meuIgreenId`
   - `indiretoBase = networkGpMes` (do hook)
   - `recorrenciaGarantida = diretoBase * 0.04 + indiretoBase * 0.01 + (isLeader ? (diretoBase + indiretoBase) * 0.005 : 0)`
3. Atualizar `subtitle` do StatCard para mostrar as duas parcelas separadas, ex.: `"4% diretos (Rxxx) + 1% rede (Ryyy) + 0,5% gestor"`.

Nada muda em sync, edge functions ou schema. Só leitura de `network_members.gp_mes`.

## Ressalva

`gp_mes` é a proxy mais próxima do faturamento mensal da rede que temos hoje. Se preferir usar outra coluna como base (`bonificavel`, `gi_mes`, etc.), é só trocar o campo no hook.
