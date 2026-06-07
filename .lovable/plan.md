# Por que o lead nasce em D quando só B está ativo

## Causa raiz

No `supabase/functions/whapi-webhook/index.ts:469`, quando o lead é criado, o código chama:

```ts
const abVariant = await pickFlowVariant(supabase);
```

Esse helper (`supabase/functions/_shared/pick-flow-variant.ts`) **sempre sorteia entre `"A"` e `"D"`** (50/50), lendo só `settings.flow_ab_mode`. Ele **ignora completamente** o `consultants.active_variants` que o painel `/admin/fluxos` controla via `VariantDistributionBar`.

Resultado: mesmo com só o Fluxo **B** ativo no consultor, todo lead novo nasce com `flow_variant='A'` ou `'D'` — e como nenhum fluxo A/D está publicado, a engine cai no fallback de D / mostra comportamento errado.

Já existe no banco a função correta — `public.assign_flow_variant(_consultant_id uuid)` — que:
1. Lê `consultants.active_variants`
2. Filtra só as variantes que têm `bot_flows.is_active = true`
3. Faz round-robin determinístico por `count(customers) % len(disponíveis)`
4. Default seguro = `'A'` se nada disponível

O webhook simplesmente não está usando ela.

## Plano de correção

### 1. `supabase/functions/whapi-webhook/index.ts` (linha ~469)

Substituir:
```ts
const abVariant = await pickFlowVariant(supabase);
```
por chamada RPC à função existente:
```ts
const { data: assigned } = await supabase.rpc("assign_flow_variant", {
  _consultant_id: superAdminConsultantId,
});
const abVariant = (assigned as string) || "A";
```
Remover o import de `pickFlowVariant` no topo do arquivo.

### 2. `supabase/functions/evolution-webhook/index.ts` (linha ~679, insert do novo customer)

Hoje o insert não seta `flow_variant` — o campo fica `NULL` e depois é lido como `"A"`. Para respeitar `active_variants` (consultor pode ter só B/C/etc.), adicionar antes do insert:

```ts
const { data: assigned } = await supabase.rpc("assign_flow_variant", {
  _consultant_id: instanceData.consultant_id,
});
```
e incluir `flow_variant: (assigned as string) || "A"` no objeto do `.insert(...)`.

### 3. Deixar `pick-flow-variant.ts` como legado

Não deletar agora (pode estar referenciado em testes/diagnose). Apenas garantir que os dois webhooks de produção não chamem mais.

## Verificação pós-deploy

- Criar lead de teste no Whapi → confere `customers.flow_variant = 'B'` (ou outra variante ativa).
- Repetir no Evolution → mesma checagem.
- Conferir nos logs do webhook que o primeiro outbound usa o fluxo B (não o D).

## Notas

- Nada de UI muda — a correção é toda em edge functions.
- Round-robin é determinístico (count % len), então 2 leads na mesma variante única continuarão indo todos para ela — comportamento desejado quando só B está ativo.
