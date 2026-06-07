## Diagnóstico — lead 5511971254913

Estado atual no banco:
- `flow_variant = B`
- `conversation_step = "flow:e0f1de51-36c5-4669-9ffd-95c1423e5008"`
- `consultant_id = 0c2711ad-4836-41e6-afba-edd94f698ae3` (Rafael)

Nos logs do whapi-webhook este lead está sendo processado pelo **engine "conversational" (flow legado da Camila)**, não pela Vendedora V2:

```
[conversational] loadFlow: flow=477f8968-1344-4252-b822-8912fdbdb538 steps=10
[conversational] entry stepKey="e0f1de51-..."
[conversational-orch] hit step="e0f1de51-..." route=clarify
[skip-step] mantendo passo_mp8yc0bp (tem slot_key/texto)
[emit-before-goto] emitindo "3e7fb4cd-..." antes de avançar para "passo_mpagqq3g"
✅ [whapi:sendButtons] botões entregues
```

Ou seja: Fluxo B está recebendo botões, "passo_*", "auto-advance por captura", "ButtonsV3" — tudo do motor scripted, exatamente o que deveria estar desligado.

### Por que o bypass anterior falhou

O bypass que adicionei em `whapi-webhook/index.ts:1316` só pula o **engine V3**. Já o bypass dentro de `handlers/bot-flow.ts:632` (que chama `runFluxoBAI`) só é alcançado quando `engine === "sys"`.

Mas para este lead, `conversation_step` começa com `"flow:"`, então `routeEngineV2` devolve `engine = "flow"` e o webhook chama `runConversationalFlow(...)` (linha 1530). A Vendedora nunca é invocada.

O bloco "FONTE ÚNICA DE VERDADE" (1440-1482) ainda piora: mesmo se o step fosse `sys`, ele faz `engine = "flow"` quando o consultor tem `conversational_flow_enabled=true` e existe um `bot_flows` ativo para a variant — e o Rafael tem fluxo ativo para variant B (`477f8968...`), então força tudo pro motor scripted.

Resultado: zero leads B caem na Vendedora V2 hoje, mesmo após a limpeza anterior. O `conversation_step` `"flow:..."` é re-gravado a cada mensagem pelo conversational engine.

Mesmo problema existe em `evolution-webhook/index.ts` (mesma estrutura, linhas 1481 e 1675).

## Correção proposta

### 1. Bypass duro de B antes do dispatcher dos engines legados

Em `supabase/functions/whapi-webhook/index.ts` e `supabase/functions/evolution-webhook/index.ts`, logo após o gate V3 e ANTES do `routeEngineV2` / bloco "FONTE ÚNICA DE VERDADE":

```ts
const _fbVariantLegacy = String((customer as any)?.flow_variant || "").toUpperCase();
const _fbStepLegacy = String((customer as any)?.conversation_step || "");
const _fbStepRaw = stripPrefix(_fbStepLegacy);
const _fbMediaSteps = new Set([
  "aguardando_conta","aguardando_documento","aguardando_humano",
  "aguardando_doc_auto","aguardando_doc_frente","aguardando_doc_verso",
  "aguardando_otp","validando_otp","portal_submitting",
  "cadastro_finalizando","finalizando","complete","cadastro_em_analise",
]);
if (_fbVariantLegacy === "B" && !_fbMediaSteps.has(_fbStepRaw)) {
  // Vendedora V2 só roda no caminho sys (bot-flow.ts → runFluxoBAI).
  // Zera qualquer "flow:<uuid>" / "passo_*" / UUID que o conversational
  // tenha gravado, força engine=sys, e segue para runBotFlow.
  if (_fbStepLegacy.startsWith("flow:") || /^[0-9a-f-]{36}$/i.test(_fbStepRaw) || _fbStepRaw.startsWith("passo_")) {
    (customer as any).conversation_step = null;
    try {
      await supabase.from("customers")
        .update({ conversation_step: null, updated_at: new Date().toISOString() })
        .eq("id", customer.id);
    } catch (_) { /* não bloqueia */ }
  }
  engine = "sys"; // força bot-flow legacy → dispara runFluxoBAI no topo
  console.log(`[fluxo-b-bypass] customer=${customer.id} step_in="${_fbStepLegacy}" → engine=sys (Vendedora V2)`);
}
```

Esse trecho entra antes da declaração `engineUsed = engine` para que o dispatcher já receba `sys`. Onde `engine` é `let` (já é), basta atribuir.

### 2. Pular o bloco "FONTE ÚNICA DE VERDADE" para B

Mesmo arquivo, no `if (engine === "sys" && !isCadastroStep && consultantFlag && customerOverride !== false)` (whapi 1440, evolution equivalente): adicionar `&& _fbVariantLegacy !== "B"` para garantir que B nunca é re-empurrado para `flow`.

### 3. Limpar o lead atual

Migration de reparo (rodar via `supabase--migration`):

```sql
UPDATE public.customers
SET conversation_step = NULL,
    updated_at = now()
WHERE id = 'd5f8f0d7-cf2b-41b3-900c-96a40ac6744f';
```

(Reset cirúrgico só desse lead; a limpeza ampla já rodou na rodada anterior — a recontaminação foi causada pelo bug acima.)

### 4. Deploy

Redeploy de `whapi-webhook` e `evolution-webhook`.

### 5. Validação

- Testar "oi" no 11971254913 pelo Whapi → logs devem mostrar `[fluxo-b-bypass]` + `[fluxo-b] dispatching` + `[fluxo-b] done model=...`, sem `[conversational]`, `passo_*`, `ButtonsV3` ou `auto-advance`.
- Conferir `customers.conversation_step` após algumas mensagens — deve ficar em `null` ou em algum dos `_fbMediaSteps` (nunca `flow:*`).

## Detalhes técnicos

- `routeEngineV2` permanece igual; o bypass acontece antes da decisão por engine.
- Mídia (foto da conta, documento, OTP) e handoff continuam intactos porque `_fbMediaSteps` cobre todos os passos determinísticos que ainda fazem sentido para o Fluxo B.
- Mudança é puramente em código de roteamento dos dois webhooks + um UPDATE pontual. Não toca em `_shared/fluxo-b-ai.ts`, `vendedora/*` nem nas templates.
- Sem mudança de tipos do Supabase, sem nova tabela.
