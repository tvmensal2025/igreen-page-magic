# Novo Dashboard — Cadastros da Equipe (revisado após auditoria)

## Diagnóstico da sync (executado agora no banco real)

- Worker `worker-igreen-sync/server.mjs` já puxa `/network-map/data?month=YYYY-MM` no endpoint `/sync-network` e `/sync-all`, e grava em `public.consultant_network` (`codigo_igreen`, `nome`, `patrocinador_codigo`, `nivel`, `cidade`, `uf`, `graduacao`, `mes_ref`, etc.).
- `customers` já tem `registered_by_igreen_id` e `registered_by_name` populados: **562 de 628 clientes têm o licenciado responsável identificado**.
- Porém `consultants.referred_by` está **NULL para todos** — a RPC `get_team_consultant_ids(rafael)` devolve só o id do próprio Rafael. Por isso o toggle atual "Minha equipe" mostra os mesmos números do "Meus clientes".

**Conclusão:** a fonte real da "equipe inteira" NÃO é `consultant_id` — é `registered_by_igreen_id`. Precisamos agrupar por licenciado usando esse campo, e enriquecer com `consultant_network` via join por `codigo_igreen`.

## Como puxamos a equipe (arquitetura correta)

Novo hook `useTeamRegistrations(leaderConsultantId, periodDays)`:

1. Lê `customers` do próprio `consultant_id` do líder (não precisa `.in()` — todos os cadastros da equipe caem no consultant_id de quem tem a credencial iGreen).
2. Agrupa por `registered_by_igreen_id` → cada bucket = um licenciado da rede.
3. Faz `select` em `consultant_network` `where consultant_id = leaderConsultantId` para buscar graduação/cidade/UF/patrocinador de cada `codigo_igreen`.
4. Retorna: `porLicenciado`, `porDia`, `porStatus`, `porOrigem`, `porUF`, `totais`, `comparativoPeriodoAnterior`.

Zero mudança de schema, zero migração, zero mudança no worker. É reuso puro dos dados que o `/sync-all` já grava.

## Botão Sync (já funciona)

`runIgreenSync(userId, "sync_all")` chama a edge function `sync-igreen-customers` → `EdgeRuntime.waitUntil` → worker Easypanel → `/sync-all`.

Fluxo puxa em paralelo: `customers` + `network` + `boletos` + `devolutivas` + `telecom` + `seguros` + `metrics` (respeitando toggles em `igreen_automation_settings`).

Confirmado nos logs de código: `want('network') ? fetchNetwork(...)` está no fluxo default. Depois do sync o novo dashboard mostra dados atualizados sem nenhum ajuste extra.

## Estética (confirmada)

- **Paleta**: mantida — verde iGreen atual (tokens `--primary`/`--accent` de `index.css`).
- **Tipografia**: Space Grotesk (números/títulos) + Inter (corpo). Via `@fontsource`.
- **Layout**: Dashboard clássico.

## Estrutura da tela

```text
┌────────────────────────────────────────────────────────────────┐
│  Toolbar: [Período ▼] [Sync equipe] [PDF]                      │
├────────────────────────────────────────────────────────────────┤
│  KPI ROW                                                       │
│  Cadastros totais │ Licenciados ativos │ Aprovados │ kWh total │
│  (vs período ant.)                                             │
├────────────────────────────────────────────────────────────────┤
│  CADASTROS POR DIA (col-span-2)      │  RANKING LICENCIADOS    │
│  Área empilhada — top 5 licenciados  │  Top 10 por cadastros   │
│  + "outros"                          │  Nome · Graduação · Nº  │
├────────────────────────────────────────────────────────────────┤
│  STATUS (donut)   │ ORIGEM (bar)     │ UF/CIDADE (bar top 8)   │
├────────────────────────────────────────────────────────────────┤
│  TABELA "Cadastros da equipe"                                  │
│  Cliente · Licenciado · Cidade · Status · kWh · Criado em      │
│  Busca + filtro por licenciado + export CSV                    │
└────────────────────────────────────────────────────────────────┘
```

## Componentes (todos em `src/components/admin/team-dashboard/`)

1. `TeamDashboard.tsx` — orquestrador, plugado dentro de `DashboardTab.tsx` acima dos cards atuais para o líder (quem tem credencial iGreen). Não substitui nada, adiciona seção nova.
2. `useTeamRegistrations.ts` — hook novo em `src/hooks/`, encapsula toda a agregação por `registered_by_igreen_id`.
3. `TeamKpiRow.tsx` — 4 `StatCard` com delta de período.
4. `TeamRegistrationsChart.tsx` — Recharts `AreaChart` empilhado (top 5 licenciados + "outros").
5. `TeamConsultantRanking.tsx` — lista com barra proporcional, badge de graduação vindo de `consultant_network`.
6. `TeamStatusDonut.tsx`, `TeamOriginBar.tsx`, `TeamGeographyBar.tsx` — Recharts.
7. `TeamRegistrationsTable.tsx` — `Table` shadcn + busca + filtro licenciado + export CSV.

## Fonts e tokens

- `bun add @fontsource/space-grotesk @fontsource/inter`.
- `src/main.tsx`: imports dos pesos 400/500/700.
- `tailwind.config.ts`: `fontFamily.display = ["Space Grotesk", ...]` e `fontFamily.sans = ["Inter", ...]`.
- Nenhuma cor nova.

## O que NÃO muda

- Schema do banco: zero migrações.
- `worker-igreen-sync/server.mjs`: intocado.
- Edge function `sync-igreen-customers`: intocada.
- `useAnalytics`, `useTeamConsultantIds`, `DashboardTab` (cards antigos), Carteira iGreen, CRM: intocados.

## Riscos e mitigação

- **Rede grande** → paginação de 1000/página no fetch de `customers` (já usado em `useAnalytics`).
- **Licenciado sem `registered_by_name`** (66 clientes hoje) → bucket "Sem licenciado identificado" no ranking, com aviso discreto.
- **`consultant_network` sem match de `codigo_igreen`** → fallback usa `registered_by_name` puro, sem graduação/UF.
- **Sync demorado** → botão "Sync equipe" mostra progresso já implementado (polling 60s) e desabilita durante execução.

## Ordem de implementação

1. Instalar fontes + tokens Tailwind.
2. Criar `useTeamRegistrations.ts` e validar contagem com `SELECT registered_by_igreen_id, count(*) FROM customers ... GROUP BY 1`.
3. `TeamDashboard.tsx` + `TeamKpiRow.tsx` + `TeamRegistrationsChart.tsx`.
4. Ranking + Status + Origem + Geografia.
5. Tabela com filtros e export CSV.
6. Plugar `<TeamDashboard />` no topo de `DashboardTab.tsx`.

Confirma que posso implementar assim?