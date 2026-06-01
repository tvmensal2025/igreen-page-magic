# CRM — "estão faltando pessoas"

## Diagnóstico (banco real, agora)

Consultor Rafael (`0c2711ad-…`):

- **105 deals** no Kanban (94 em `novo_lead`, 6 em `valor_conta`, 5 em `finalizando`, 4 em `doc_enviado`, 3 em `conta_enviada`, 7 reprovado, 6 aprovado, 8/9/10/11 em 30/60/90/120 dias, 1 qualificando).
- **19 deals criados hoje** (01/jun).
- Todos os stages dos deals existem em `kanban_stages` → nenhum card "órfão" sumindo de coluna.
- `consultant_id` do deal bate 100% com o do customer (0 mismatches).

Customers **sem deal** (137 leads totais, 33 sem deal):

| categoria | qtd | exemplo |
|---|---|---|
| `is_test_lead = true` | 25 | "Test1"…"Test15", "JornadaTest", "FinalTest", "Lead Real Simulado" |
| `is_sandbox = true` | 8 | "Maria Silva" / "TestVariantB" / "Test_D_Mapping" (telefones `550000…`) |
| **leads reais sem deal** | **0** | — |

Conclusão objetiva: **não há lead real fora do CRM**. O trigger novo está pegando 100% dos leads que entram. Os 33 "ausentes" são exatamente os testes que o filtro deve esconder.

## Hipóteses do que você está vendo

1. **Filtro do Kanban escondendo cards** — barra de busca preenchida ou "Parou no passo" ≠ "Todos os passos" filtra os 94 da coluna `novo_lead`. Solução: limpar filtros (canto superior direito do CRM).
2. **Leads reais marcados como `is_test_lead`/`is_sandbox` por engano** — preciso de 1 nome/telefone concreto pra confirmar.
3. **Espera ver leads de outros consultores** — Kanban só mostra do consultor logado.

## Plano

### A. Toggle "Mostrar testes/sandbox" no Kanban (5 min, frontend-only)

Adiciono na header do `KanbanBoard.tsx` um pequeno switch ao lado do "Configurar Colunas":

- OFF (default): comportamento atual.
- ON: `useKanbanDeals` busca também leads `is_sandbox=true`/`is_test_lead=true` do mesmo consultor e os marca visualmente (badge cinza "TESTE") no card.

Permite você ver os 33 sem precisar abrir SQL e identificar se algum era real.

### B. Botão "Reclassificar como lead real" no card de teste

No `KanbanDealCard.tsx`, se `is_test_lead` ou `is_sandbox` estiver true, mostra ação rápida que faz:

```sql
UPDATE customers SET is_test_lead=false, is_sandbox=false WHERE id=…
INSERT INTO crm_deals … (mesma lógica do trigger, idempotente)
```

Para o caso (raro) de um lead real ter caído como teste.

### C. Nada no backend

Trigger e backfill continuam exatamente como estão. Sem nova migration.

## Fora do escopo

- Não mexer em fluxo D, engine V3, OCR, captação.
- Não criar deal para `igreen_sync`.
- Não relaxar o trigger para incluir sandbox/test (mantém Kanban limpo por padrão).

## Validação

Após implementação, ligando o toggle você verá os 33 cards de teste; nenhum deve parecer um cliente real. Se um parecer, clica em "Reclassificar" e ele entra no funil normal.
