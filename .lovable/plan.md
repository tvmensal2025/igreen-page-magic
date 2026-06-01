## Problema
Os números nos cards de estatísticas do dashboard do consultor estão muito grandes (`text-xl sm:text-3xl font-black`), ocupando espaço excessivo e ficando visualmente gritantes.

## Solução
Reduzir o tamanho da fonte nos componentes de KPI para uma escala mais proporcional:

1. **src/components/admin/StatCard.tsx**
   - Alterar `text-xl sm:text-3xl font-black` → `text-lg sm:text-2xl font-bold`
   - Mantém legibilidade e hierarquia visual sem exagerar no tamanho

2. **src/components/superadmin/CaptacaoTab/KpisRow.tsx** (consistência)
   - Alterar `text-2xl font-black` → `text-xl font-bold`

## Resultado esperado
Cards de KPI com números menores e mais equilibrados visualmente, melhor aproveitamento do espaço do card.
