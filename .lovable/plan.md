# Enxugar o Dashboard da Equipe

O bloco novo `TeamDashboard` acabou repetindo o que o dashboard antigo já mostra logo abaixo (Cadastros totais, Aprovados, kWh, Status, Estados, Ranking, Tabela). O antigo é melhor. Vamos manter só o que é realmente novo: **o gráfico de "Cadastros por dia · top 5 licenciados"**, e levar o **ranking visual** para o mesmo local do ranking já existente (CustomerCharts).

## O que muda

### 1. `src/components/admin/team-dashboard/TeamDashboard.tsx` (enxugar)
Manter apenas:
- Header curto ("Cadastros da equipe · últimos N dias · X licenciados ativos" + badge de variação vs período anterior).
- **Gráfico de área empilhada** por dia com os top 5 licenciados (o único visual que o antigo não tem).

Remover:
- KPI row (Cadastros totais, Licenciados ativos, Aprovados, kWh) — já existe no bloco de baixo.
- Card "Ranking de licenciados" — vai migrar para `CustomerCharts`.
- Grid Status / Origem / Estados (top 8) — Status e Estados já aparecem no `CustomerCharts`/`GeographyCard`; Origem não é prioridade.
- Tabela "Cadastros da equipe" + filtros + export CSV — o CRM/lista de clientes já cumpre esse papel.

Isso deixa o componente com ~80 linhas focadas no gráfico temporal.

### 2. `src/components/admin/CustomerCharts.tsx` (receber o ranking rico)
No lugar (ou ao lado) do gráfico de barras horizontais atual de "Top licenciados", passar a mostrar a lista ranqueada com barra de progresso proporcional, número de cadastros, graduação e UF — o mesmo visual que estava no `TeamDashboard`. Fonte de dados: continuar usando `topLicenciados` que já chega via props. Assim o ranking fica junto dos outros gráficos de clientes iGreen, sem duplicar seção.

### 3. `src/hooks/useTeamRegistrations.ts`
Sem mudança de contrato. Os campos `porStatus`, `porOrigem`, `porUF`, `customers` deixam de ser consumidos pelo `TeamDashboard`, mas ficam no hook (custo zero, útil para futuro). Só isso.

### 4. `src/components/admin/DashboardTab.tsx`
Continua chamando `<TeamDashboard />` no mesmo lugar — agora ele renderiza só o gráfico temporal + header. Nenhuma outra alteração necessária.

## Resultado visual

```text
[ Toolbar: filtro licenciado / sync / período / PDF ]

[ Header: Cadastros da equipe · 30 dias · ▲12% ]
[ Gráfico de área empilhada · top 5 licenciados por dia ]

[ 4 KPIs antigos: Total Clientes · kWh · Ticket · Economia ]
[ CustomerCharts: Status + Ranking rico de licenciados ]
[ Top consumidores ] [ Geografia ] [ Retenção ]
```

Sem duplicações, sem "Estados top 8" repetido, sem tabela paralela — o antigo volta a ser a fonte principal e o novo agrega só a série temporal por licenciado.
