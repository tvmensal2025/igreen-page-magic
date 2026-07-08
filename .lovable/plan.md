## Ajuste dos 4 cards de topo do Dashboard

Arquivo único: `src/components/admin/DashboardTab.tsx` (bloco `useMemo filteredMetrics` + 1 StatCard).

### 1. Base dos cards de kWh vira a carteira toda (572)

`totalKw`, `avgKw` e o novo card de recorrência passam a operar sobre `walletForTotal` (que respeita filtro de licenciado, mas ignora "meus diretos"). Os gráficos secundários continuam sobre `filtered`.

### 2. Substituir "Ticket médio (conta)" por **"Recorrência garantida (mês)"**

Fórmula por cliente **aprovado** (`status === 'approved'`) na carteira sincronizada:

```
bill(c)     = c.electricity_bill_value > 0
                ? c.electricity_bill_value
                : (c.media_consumo || 0) * 0.95   // tarifa média BR

pct(c)      = (c.registered_by_igreen_id === meuIgreenId ? 0.04 : 0.01)
              + (isGestor ? 0.005 : 0)

recorrencia = Σ bill(c) * pct(c) sobre todos os aprovados
```

Regras:
- **Direto** = `registered_by_igreen_id === myClientsSettings.myIgreenId` → 4%
- **Indireto (rede)** = qualquer outro `registered_by_igreen_id` → 1%
- **Gestor +0,5%** = lê flag do consultor no banco. Vou verificar em `consultants` quais colunas existem (`is_gestor`, `is_leader`, `role`, `cargo`, `nivel_gestao`...). Se nenhuma existir, uso o fato de o consultor ter >1 licenciado direto na rede como proxy (`teamIds.length > 1` já é calculado como `isLeader`). Fica documentado no card via `title` do tooltip.
- **Só approved** — nome do card é "Recorrência garantida" porque é o que já está gerando comissão de fato.

Card:
```text
Recorrência garantida
R$ 4,2 mil
aprovados · 4% diretos + 1% rede (+0,5% gestor)
```

### 3. Layout final dos 4 cards

```text
Total de cadastros | Média kWh/cliente | Recorrência garantida | Total de kWh
       572         |      210 kW       |     R$ 4,2 mil        |  120.120 kW
                   |  Total: 120k kW   | aprovados · 4%+1%+0,5%|  soma da média
```

### Sem impacto

- Sync, banco, edge functions: sem mudança.
- Gráficos abaixo continuam usando `filtered` (respeita escopo "Meu/Equipe").

### Arquivos

- `src/components/admin/DashboardTab.tsx`
