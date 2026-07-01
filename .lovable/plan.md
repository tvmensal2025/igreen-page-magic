# Ajustes rápidos no Dashboard

## 1. Ranking de licenciados vazio
Hoje o ranking usa `topLicenciados` do `useAnalytics`, que só conta clientes onde `registered_by_name` está preenchido — muitos clientes iGreen só têm `registered_by_igreen_id`, por isso a lista aparece vazia.

Fix em `src/hooks/useAnalytics.ts`: alimentar `topLicenciados` também a partir de `registered_by_igreen_id`. Chave do bucket = `registered_by_name` quando existir, senão `#<igreen_id>`. Se ainda assim vazio, cair para "Sem licenciado" agrupado. Sem mudança de contrato — o `CustomerCharts` continua consumindo `topLicenciados`.

## 2. Renomear KPIs em `src/components/admin/DashboardTab.tsx`
- `Total de Clientes` → **Total de cadastros**
- Cartão `Economia gerada` (`PiggyBank`) vira **Total de kWh** exibindo `filteredMetrics.totalKw` formatado (`XX.XXX kW`), subtítulo `soma da média de consumo`, ícone `Zap`. Removemos o cálculo de `economiaGerada` do card, mas mantemos no `useMemo` para não quebrar nada.
- (Os cards `Média kWh/cliente` e `Ticket médio` continuam iguais.)

## 3. Mover "Cadastros da Equipe" para o final
Em `DashboardTab.tsx`, remover o `<TeamDashboard />` de cima (linhas 267–274) e reinserir **após** `<RetentionCard />` (que contém os aniversariantes), antes do `<Dialog />` de credenciais.

Nenhuma mudança em backend/tipos.
