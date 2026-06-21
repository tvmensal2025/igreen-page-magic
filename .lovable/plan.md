# Análise: o cadastro vai do início ao fim?

## Resposta curta
**Quase, mas ainda não.** Os pilares estão certos (`resolveResumeStep`, idempotência em `aguardando_conta`, migration de auditoria), mas encontrei **2 falhas residuais** que ainda permitem o sintoma (pedir a conta de novo / não pedir o verso). Sem corrigir, o cadastro pode reiniciar parcialmente em alguns caminhos.

## O que está OK (verificado em código)
1. `resolveResumeStep(customer)` em `_shared/conversation-helpers.ts` (linhas 364-377): ordem correta — conta → confirma conta → doc frente → doc verso → confirma doc → demais campos.
2. `aguardando_conta` (whapi `bot-flow.ts:3503`, evolution `:3204`): idempotência funciona — se `hasBillData + bill_data_confirmed_at`, retoma sem re-OCR.
3. `ask_quero_cadastrar` (whapi `:5456`, evolution `:5039`): retoma direto se já tem doc.
4. Migration `silent_step_reset_log` + trigger `audit_silent_step_reset`: ativa, vai logar a causa raiz dos resets.

## Bugs residuais encontrados

### BUG 1 (crítico) — Resume no dispatcher mal aninhado
Em `whapi-webhook/handlers/bot-flow.ts` (linhas 2951-2988) e `evolution-webhook/handlers/bot-flow.ts` (linhas 2670-2706), o bloco de RESUME determinístico foi escrito **dentro** do `if ((stype === "capture_documento") && !hasBillData(customer)) { try { ... } }`. Estrutura atual:

```text
if (capture_documento && !hasBillData) {
  try {
    if (contaStep) { step = "aguardando_conta"; ... }
    // ← bloco RESUME está AQUI, escopo errado
  } catch {}
}
```

**Efeito:** o resume só roda quando o flow tenta `capture_documento` sem conta ainda — exatamente o caso em que `hasBillData=false` e `resolveResumeStep` devolve `"aguardando_conta"` (no-op). Para **todos os outros caminhos** (dispatcher mandando `capture_conta` após reset silencioso, ou `aguardando_doc_auto/verso` com dados já salvos) o resume **não dispara**. Esse é o caminho exato do bug que o cliente reportou.

**Correção:** mover o bloco RESUME para **fora** do `if` do guard doc-before-bill, como irmão (sibling) — roda sempre que `step ∈ {aguardando_conta, aguardando_doc_auto, aguardando_doc_verso}` no dispatcher, independentemente do `stype` mapeado.

### BUG 2 (médio) — `aguardando_doc_auto` sem idempotência
`case "aguardando_doc_auto"` (whapi `:4288`, evolution equivalente) **não tem** o guard de idempotência que `aguardando_conta` ganhou. Se o customer já tem `document_front_url` válido e a mídia é reenviada (cenário pós-reset), o handler roda `detectDocumentTypeDetailed` + OCR de novo, podendo sobrescrever campos.

**Correção:** adicionar no topo do case (espelho de `aguardando_conta`):
```ts
if (!shouldSkipAsk("document_front", customer)) { /* segue fluxo normal */ }
else {
  const resumed = resolveResumeStep(customer);
  updates.conversation_step = resumed;
  reply = isFile
    ? `Já recebi seu documento ✅ Vamos continuar 👇\n\n${getReplyForStep(resumed, customer)}`
    : getReplyForStep(resumed, customer);
  break;
}
```
E o mesmo em `aguardando_doc_verso` (skip se `document_back_url` já existe ou se for CNH).

## Mudanças propostas (build mode)

1. `supabase/functions/whapi-webhook/handlers/bot-flow.ts`
   - Mover bloco RESUME (linhas 2968-2985) para depois do fechamento do `if (capture_documento && !hasBillData)` (após linha 2988).
   - Adicionar guard de idempotência no topo de `case "aguardando_doc_auto"` (linha 4288) e `case "aguardando_doc_verso"` (linha 4613).
2. `supabase/functions/evolution-webhook/handlers/bot-flow.ts`
   - Mesma reorganização do bloco RESUME (linhas 2686-2703 → mover para fora).
   - Mesmos guards de idempotência nos cases de doc.
3. Sem migration nova. Sem mudança de UI.

## Verificação após o fix
- Reler os blocos editados (`code--view`).
- `supabase--read_query`: conferir que `silent_step_reset_log` ainda está vazio (nenhum reset disparado pela mudança).
- Rodar um cenário manual ou checar `edge_function_logs` do whapi-webhook procurando `[resume] dispatcher quis ...` — só deve aparecer quando dispatcher tenta passo já cumprido.

## Conclusão
Com BUG 1 + BUG 2 corrigidos, o cadastro segue do início ao fim mesmo em caso de reset silencioso: dados ficam salvos e o bot retoma exatamente onde parou, sem repetir conta nem pular verso. Os 4 itens já implementados anteriormente continuam válidos — só faltava completar o wiring.
