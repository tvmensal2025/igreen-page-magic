## Objetivo
Remover o botão "Limpar clientes ativos" e fazer o Conversão trazer **todos** os leads parados (anúncios antigos etc.), sem misturar clientes ativos. O filtro natural do fetch cuida disso — hoje ele quebra silenciosamente e devolve 0.

## Causa raiz do "0 clientes"
No fetch de `customers` (ConversaoCockpit.tsx, linha 146) usamos:

```
.not("assinatura_cliente", "is", true)
```

Mas `assinatura_cliente` no schema é **texto**, não boolean. O PostgREST manda `IS NOT TRUE` e o Postgres devolve `argument of IS NOT TRUE must be type boolean, not type text` → a query inteira falha → `rows = []`. Confirmado por SELECT direto.

Sem essa cláusula, existem ~76 leads `whatsapp_lead` elegíveis (dos 83 totais, apenas 6 têm `igreen_code` e 1 status ativo).

## Mudanças

### 1. `src/components/admin/conversao/ConversaoCockpit.tsx`
- **Corrigir fetch (linhas 130-148)**: remover `.not("assinatura_cliente", "is", true)`. Manter `.is("igreen_code", null)`, `.is("data_ativo", null)`, `.is("data_validado", null)`, `.is("data_cadastro", null)`, `.is("pos_venda_stage", null)` e o `.or()` de origem. O bloqueio de `assinatura_cliente` passa para o filtro JS junto de `andamento_igreen`.
- **Ampliar filtro JS (linhas 176-180)**: `CLIENT_STATUSES` continua; adicionar exclusão por `assinatura_cliente` truthy (`'true' | 't' | 'sim' | 'yes' | '1'`, case-insensitive). Assim o "cliente ativo não entra" fica natural, sem depender de tipo boolean.
- **Remover botão e handler**: apagar `promoting`, `promoteParked` (linhas 354-374) e o `<Button>` correspondente no JSX (bloco que usa `Trash2` + "Limpar clientes ativos"). Remover `Trash2` do import de `lucide-react` se ficar sem uso.

### 2. `supabase/functions/admin-promote-parked-leads/index.ts`
Deletar a função inteira (`rm -rf supabase/functions/admin-promote-parked-leads`). Não é mais chamada em lugar nenhum e a exclusão de cliente ativo agora é natural no fetch.

## Fora de escopo
- Sem alteração de schema, RLS, migrations.
- Sem mudança na tela de Captação.
- Não mexer no cálculo de score, ordenação, ou nas ações de IA.

## Verificação
Após aplicar: abrir `/admin` → Central de Conversão → conferir que a fila carrega os leads `whatsapp_lead` (ads antigos incluídos) e que nenhum com `igreen_code`, `data_ativo/validado/cadastro`, `assinatura_cliente` truthy ou `andamento_igreen` em (ativo/aprovado/validado/licenciada/licenciado) aparece.
