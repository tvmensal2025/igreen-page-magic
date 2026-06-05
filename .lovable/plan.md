## Diagnóstico

Reproduzi o caso do lead **JOSE FELICIO (5511971254913)** consultando `conversations` e `customers`:

```
19:30:24  bot →  d_resultado (simulação + botão "Quero me cadastrar")
19:30:56  lead → "1"
19:31:02  bot →  d_welcome (reset! "Olá! 👋 ... 1️⃣ Quero simular ...")
```

O lead clicou/digitou "1" para continuar o cadastro, mas o bot **voltou para o welcome** em vez de avançar para `d_pedir_documento` (transição correta configurada no passo `d_resultado`).

### Causa raiz

Em `supabase/functions/evolution-webhook/index.ts:1486-1542` existe um guard chamado **"AUTO-CURA DE STEP ÓRFÃO ENTRE VARIANTES"**. Ele faz lookup do step atual filtrando:

```sql
WHERE bot_flows.consultant_id = <instance.consultant_id>
  AND bot_flows.variant = <customer.flow_variant>
  AND is_active = true
```

Se não encontrar, considera o step órfão e força `conversation_step = 'welcome'`.

Mas o consultor da instância (`953f7e48-...`) tem o próprio `bot_flows` com **`sync_mode='public'`**, o que faz `resolveFlowId` (`_shared/resolve-flow.ts`) redirecionar TODO o roteamento para o fluxo PÚBLICO (`consultant_id=0c2711ad-...`, `is_public=true`). Logo, o bot grava `conversation_step` apontando para UUIDs de steps que pertencem ao consultor do template público — e a "cura" não enxerga esses steps porque filtra só pelo consultor da instância.

Resultado: TODO passo do fluxo D rodando em modo `sync_mode='public'` cai como "órfão" e o lead é resetado para welcome em cada turno. Hoje funciona "às vezes" só porque outras camadas (`runEngineV3`, `runConversationalFlow`, redirect por mídia) interceptam antes em certos cenários — mas quando o usuário responde texto puro num passo `flow:<uuid>`, o reset dispara.

## Correção

Alinhar a query da "cura" com a lógica do `resolveFlowId`: aceitar o step se ele pertencer ao fluxo do consultor **OU** ao fluxo PÚBLICO da mesma variante (quando o consultor está em `sync_mode='public'`).

### Mudança única — `supabase/functions/evolution-webhook/index.ts`

No bloco `step-mismatch-cure` (~linha 1496-1542), substituir a query atual por uma que aceite as duas fontes válidas de steps:

```ts
const { data: ownFlow } = await supabase
  .from("bot_flows")
  .select("id, sync_mode")
  .eq("consultant_id", instanceData.consultant_id)
  .eq("variant", variant)
  .eq("is_active", true)
  .maybeSingle();

const allowedFlowIds: string[] = [];
if (ownFlow?.id) allowedFlowIds.push(ownFlow.id);
// Se o consultor está em sync_mode='public', os steps reais vêm do template público
if (!ownFlow || String(ownFlow.sync_mode ?? "public").toLowerCase() === "public") {
  const { data: pubFlow } = await supabase
    .from("bot_flows")
    .select("id")
    .eq("is_public", true)
    .eq("is_active", true)
    .eq("variant", variant)
    .maybeSingle();
  if (pubFlow?.id) allowedFlowIds.push(pubFlow.id);
}

const { data: stepLookup } = await supabase
  .from("bot_flow_steps")
  .select("id")
  .or(`id.eq.${_stepRaw},step_key.eq.${_stepRaw}`)
  .eq("is_active", true)
  .in("flow_id", allowedFlowIds)
  .limit(1);

const found = Array.isArray(stepLookup) && stepLookup.length > 0;
```

O resto da lógica (reset para welcome quando realmente órfão, log, insert em `bot_step_transitions`) permanece igual.

### Validação

1. Reexecutar mentalmente o turno do lead JOSE: `_stepRaw="4df1f90a-..."`, variant=D → query agora inclui flow público `320bf22c` → step encontrado → cura NÃO dispara → engine processa transição → "1" casa `trigger_phrases=["1",...]` → `goto_step_id=58f0a7e2` (`d_pedir_documento`) ✅
2. Cenário órfão real (lead com step de variante antiga após troca): step não está nem no fluxo do consultor nem no público da variante atual → cura ainda dispara, reset para welcome preservado ✅
3. Consultor com fluxo próprio (`sync_mode='custom'`): query NÃO inclui público → comportamento atual preservado ✅

### Notas

- Mudança cirúrgica num único bloco. Sem migração de schema.
- Não toca em `resolveFlowId`, runner v3, nem no classificador de intent — o problema está exclusivamente na "cura" do orquestrador.
- Após o deploy, rodar uma query para identificar leads atualmente travados em `conversation_step='welcome'` com `previous_conversation_step` apontando para UUID, e opcionalmente avisar suporte.
