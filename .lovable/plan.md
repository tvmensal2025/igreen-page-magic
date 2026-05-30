# O que aconteceu com 5511971254913 (customer `bf89171d…`, variant D)

Reconstrução pelos logs do `whapi-webhook` (09:28:59 → 09:29:18):

1. Bot estava em `d_pedir_documento` (variant D, fluxo `320bf22c…`) e enviou corretamente: *"Show, BRUNO! 🙌 Agora preciso de mais uma foto…"*
2. Logo em seguida o chain-resolver chamou `findNextActiveFlowStep(...)` como fallback (o `d_pedir_documento` está com `transitions: []`).
3. **Bug:** `findNextActiveFlowStep` está com `.eq("variant", "A")` **hardcoded** (linha 340 do `whapi-webhook/handlers/bot-flow.ts`, idem `evolution-webhook` linha ~347). Resultado: para um lead variant **D**, a função foi buscar o "próximo passo" no fluxo errado (**Fluxo Padrão**, `66a19db4…`) e devolveu `passo_mpagqq3g` (UUID `bdc7ebb3…`, position 6 de outro flow).
4. `conversation_step` foi gravado como `bdc7ebb3…` — um passo que **não existe** no fluxo da variant D do consultor.
5. O lead respondeu mandando a CNH (PDF). O webhook acionou o **step-mismatch-cure**, viu que `bdc7ebb3…` não pertence à variant D e resetou para `welcome`.
6. O handler conversational viu "📸 arquivo recebido em step=welcome" e redirecionou para `aguardando_conta` (conta de luz) — caminho errado, o bot estava pedindo documento.
7. O dispatcher tentou re-emitir `d_pedir_conta` e `d_resultado`, mas o anti-rep (10 min) bloqueou ambos. Resultado: **o PDF do CNH não foi processado, nenhuma resposta foi enviada → travou**. E o usuário viu o funil "voltar" da etapa de documento para conta de luz → percepção de **duplicação**.

A ordem que você definiu (conta de luz → simulação → documento) está correta no `bot_flow_steps`. O problema foi puramente o leak entre flows causado pelo `variant="A"` fixo.

# Correções

## 1. `findNextActiveFlowStep` — usar a variant real do lead

Em `supabase/functions/whapi-webhook/handlers/bot-flow.ts` (≈l.331) e `evolution-webhook/handlers/bot-flow.ts` (≈l.338):

- Adicionar parâmetro `variant?: string` no `opts`.
- Substituir `.eq("variant", "A")` por `.eq("variant", opts.variant || "A")`.
- Alternativa mais robusta: aceitar `flowId?: string` direto e, quando presente, pular o lookup em `bot_flows` (filtra `bot_flow_steps.flow_id = flowId`). Isso impede qualquer cross-flow mesmo se a variant for desconhecida.

## 2. Atualizar todas as call sites

Nos 2 webhooks (whapi + evolution), todos os 5 pontos que chamam `findNextActiveFlowStep` devem passar `variant: customer.flow_variant` (e/ou `flowId` quando o `stepRow.flow_id` já é conhecido pelo resolver). Pontos identificados:

- `whapi-webhook/handlers/bot-flow.ts`: l.2819, l.2872, l.3504, l.3512
- `evolution-webhook/handlers/bot-flow.ts`: l.2450, l.2483, l.3051, l.3058, l.3082

## 3. Cura inteligente do `step-mismatch-cure`

Em `whapi-webhook/index.ts` (≈l.1388) e `evolution-webhook/index.ts` (≈l.1258):

Hoje, quando o step é estranho à variant, reseta para `welcome`. Trocar por:

1. Olhar `customers.last_custom_prompt_at` + log do último prompt; se o último step disparado for um `capture_*`, snap `conversation_step` para esse step (em vez de `welcome`).
2. Senão, snap para o primeiro step ativo da variant correta (mantém comportamento atual).

Isso garante que um PDF chegando depois do bot pedir documento entre em `capture_documento` (não `capture_conta`).

## 4. Recuperação imediata do lead `bf89171d…`

Migration única (manual, pontual):

- `UPDATE customers SET conversation_step = '58f0a7e2-16ce-4ee2-ad07-1466ce7e9f1f' WHERE id = 'bf89171d-d4ef-484b-b3a8-80e201b5c83c'` — coloca de volta em `d_pedir_documento`.
- Não mexer em `electricity_bill_*` (simulação já tinha sido feita antes).
- O lead pode reenviar a CNH e o fluxo segue normalmente.

## 5. Validação pós-deploy

- Lead novo variant D → conta de luz → simulação → documento → email → telefone → finalizar (sem leak para `passo_mpagqq3g`).
- Mesmo teste em variant A (Fluxo Padrão) continua usando o fluxo correto.
- Logs não mostram mais `passo_mpagqq3g` em chains de variant D.

# Fora de escopo

- Reescrever transitions de `d_pedir_documento` (adicionar default → `d_pedir_email`) — vale como hardening separado, mas a correção do `findNextActiveFlowStep` já basta porque `getNextMissingStep` lida com o "depois do documento".
- OCR/classificação automática de mídia inbound.
