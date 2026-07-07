
# Diagnóstico corrigido — duplicatas de clientes iGreen

Você tinha razão. A análise anterior estava incompleta. Auditei o código do sync + o banco e o bug de duplicação é **backend, não UI**.

## O que está acontecendo (evidência do banco)

Só no consultor Rafael:
- **40 linhas extras** por `igreen_code` duplicado
- **33 linhas extras** por CPF duplicado

Exemplo real: GERSON DA SILVA FERREIRA (igreen_code `1116769`) aparece 2×:

| id | phone_whatsapp | status | criado em |
|---|---|---|---|
| 4ddba20d… | `5511963955727` (real) | devolutiva | 2026-06-15 |
| 34bdcdc7… | `sem_celular_1116769` (placeholder) | contato_incompleto | 2026-07-06 |

## Causa raiz (código)

Em `supabase/functions/sync-igreen-customers/index.ts`:

1. **`buildRecord()` linhas 97-105**: quando o portal devolve o cliente **sem campo `celular`** (acontece quando a linha vem só do enriquecimento ou do detalhe, não da listagem), gera placeholder `sem_celular_<codigo>`.
2. **`persistCustomers()` linha 1802**: `upsert(..., { onConflict: "phone_whatsapp,consultant_id" })` — deduplica **só por telefone**.
3. Resultado: cliente já existe no banco com telefone real de uma run anterior. Nova run gera placeholder diferente. Postgres não acha conflito e **INSERE uma segunda linha**. Toda run que perde o celular duplica.

E como o placeholder força `status = 'contato_incompleto'` (linha 120-122), as duplicatas inflam os "Contato incompleto" — que eu tinha atribuído erradamente à "rede indireta" no plano anterior.

## Correções necessárias (nesta ordem)

### 1. Migration — dedupe + constraint (backend, obrigatório)

```sql
-- Passo A: mover boletos/devolutivas/etc que apontem para as linhas placeholder
--   para a linha "boa" (mesmo consultant_id + igreen_code, telefone real).
-- Passo B: DELETE nas linhas placeholder onde existe gêmea com telefone real.
-- Passo C: índice único parcial para bloquear regressão:
CREATE UNIQUE INDEX customers_igreen_code_per_consultant
  ON public.customers (consultant_id, igreen_code)
  WHERE igreen_code IS NOT NULL AND customer_origin = 'igreen_sync';
```

Antes de rodar, faço `SELECT` de auditoria pra confirmar que o Passo B só remove linhas com `phone_whatsapp LIKE 'sem_celular_%'` e que existe gêmea real.

### 2. Fix na edge function `sync-igreen-customers`

- **`buildRecord`**: parar de forçar placeholder no primeiro momento. Retornar `{ record, needsPhoneLookup: true }` quando não tiver celular real.
- **`persistCustomers`**: antes de gerar placeholder, buscar `SELECT phone_whatsapp FROM customers WHERE consultant_id=? AND igreen_code=?`. Se existir com telefone real, **reusar esse telefone** (o upsert vira UPDATE da linha existente). Só cai no `sem_celular_<code>` se realmente é primeira aparição do cliente.
- **Preferir upsert por igreen_code** quando disponível: rodar upsert `onConflict: "consultant_id,igreen_code"` para todo registro que tiver `igreen_code`, e o antigo `phone_whatsapp,consultant_id` só para os poucos sem código (raros).

### 3. Só ENTÃO fazer os fixes de UI que estavam no plano anterior

Depois da limpeza, os números caem para o real. Aí sim vale mexer em:
- T1 case-sensitivity `andamento_igreen === "Validado"` → normalizar (`validado|adimplente|menos_30d`).
- T4 rótulo do `contato_incompleto` (mas com muito menos volume, provavelmente nem precisa mais tanto).
- T2 limit 5000 no `useChats`.
- T6 polish do IGreenConnectionCard.

## Ordem de execução

1. **Migration dedupe + constraint** (crítico — está criando lixo a cada sync).
2. **Fix `persistCustomers` para reusar telefone existente por igreen_code** (fecha a torneira).
3. **Fix case-sensitivity `andamento_igreen`** (destrava Recebíveis R$ 0,00).
4. **T4 badge + T2 limit + T6 polish** (cosmético, faz por último).

## Arquivos que vão mudar

```
supabase/migrations/<novo>.sql                            -- dedupe + índice único
supabase/functions/sync-igreen-customers/index.ts         -- lookup por igreen_code antes do placeholder
src/features/produtos/acompanhamento/greenCommission.ts   -- isValidadoIgreen()
src/features/produtos/acompanhamento/greenData.ts         -- usar helper nos 4 pontos
src/features/produtos/acompanhamento/__tests__/greenCommission.test.ts
src/components/admin/lib/customerStatusLabels.ts          -- badge revisto
src/hooks/useChats.ts                                     -- limit 5000
src/components/admin/IGreenConnectionCard.tsx             -- badges por conta
```

## Fora de escopo
- Worker Playwright (`worker-igreen-sync/`) não muda — problema é 100% no edge que persiste.
- Nenhuma mudança em RLS.
- Não deletar clientes que só têm placeholder e não têm gêmea real — pode ser cliente legítimo sem celular.
