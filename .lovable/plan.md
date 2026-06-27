## Diagnóstico profundo

O problema não é só “duplicidade”; é uma mistura de duas regras conflitantes:

1. **O passo da simulação (`d_resultado`) está configurado com botões e transições**, mas no banco aparece com `wait_for: none`.
   - Isso permite que o motor interprete o passo como “pode continuar sozinho”.
   - O `d_resultado` tem botões como `✅ Continuar Cadastro`, `🎥 Como funciona`, `Falar com representante`, e deveria obrigatoriamente aguardar resposta.

2. **O handler pós-confirmação da conta ainda tem caminhos que despacham documento direto.**
   - Em `confirmando_dados_conta`, depois de enviar a simulação, existe gate para parar quando detecta botões.
   - Mas ainda existem fallbacks que dizem “nenhum próximo passo seguro — pedindo doc direto” e mandam `capture_documento` sem clique.
   - Isso é exatamente o comportamento que você está vendo: simulação chega e em seguida vem “Show! manda documento”.

3. **O motor novo de fluxo (`conversational/index.ts`) também pode cascatear.**
   - A função `goToStep` considera `wait_for=none` como permissão para avançar para próximo passo por posição/fallback/default.
   - Hoje ele só para se o texto parecer pergunta, se tiver captura textual, ou se `wait_for !== none`.
   - Mas um passo com botões/transições também deve ser tratado como “esperar resposta”, mesmo que esteja marcado como `none`.

4. **O sistema está usando um step artificial (`ask_quero_cadastrar`) em alguns casos.**
   - Isso funcionou como remendo para parar antes do documento.
   - Mas não respeita totalmente o “ir para o passo X” configurado no próprio Flow Builder.
   - O correto é: depois da simulação, manter o cliente no próprio passo da simulação ou no step configurado, e quando ele responder/clicar, seguir a transição configurada, não repetir sempre.

## Regra correta que vou aplicar

Depois que a conta é confirmada e a simulação é enviada:

```text
confirmando_dados_conta
  → envia d_resultado / simulação
  → PARA
  → salva conversation_step = id real do d_resultado
  → aguarda clique/resposta do cliente
  → se clicar Continuar Cadastro, segue goto_step_id configurado
  → se clicar Dúvida/Como funciona, segue o passo configurado
  → se clicar Humano, chama humano
```

Ou seja: **não manda documento automaticamente após a simulação**, a menos que o passo de simulação não tenha botão, não tenha transição e esteja explicitamente configurado para auto-avançar.

## Plano de correção

1. **Blindar o pós-confirmação da conta**
   - Ajustar `supabase/functions/whapi-webhook/handlers/bot-flow.ts`.
   - Quando o passo enviado após a conta tiver botões, transições ou destino configurado, salvar o `conversation_step` como o **id real do passo enviado** (`d_resultado`), não como `ask_quero_cadastrar`.
   - Remover o fallback agressivo que pede documento direto quando não encontra “próximo passo seguro”; nesse caso ele deve parar no último passo enviado e aguardar.

2. **Fazer o motor respeitar botões/transições como “esperar resposta”**
   - Ajustar `supabase/functions/whapi-webhook/handlers/conversational/index.ts`.
   - A regra de cascata deve parar quando o passo tiver:
     - botões em `captures._buttons`, ou
     - `transitions` configuradas que dependem de resposta, ou
     - `fallback.mode = repeat` / `ai_answer`.
   - Assim `wait_for=none` não vai mais atropelar passos interativos.

3. **Respeitar “ir para passo X” em vez de repetir sempre**
   - Quando o cliente responder no passo da simulação, usar as `transitions` do próprio `d_resultado`.
   - Se a resposta casar com “Continuar Cadastro”, ir para o `goto_step_id` configurado, que hoje aponta para `d_pedir_documento`.
   - Se a resposta for dúvida, ir para o passo configurado de dúvidas.
   - Se não casar, aí sim usar fallback/repeat conforme configurado.

4. **Sincronizar Evolution se necessário**
   - O problema principal está no Whapi/custom flow, mas vou conferir se o Evolution tem trecho equivalente.
   - Se houver o mesmo auto-avanço, aplicar a mesma regra para manter paridade.

5. **Adicionar teste de regressão**
   - Criar/ajustar teste para garantir:
     - depois de confirmar a conta, envia `d_resultado`;
     - não envia `capture_documento` no mesmo turno;
     - persiste o step real da simulação;
     - só vai para documento após clique/resposta compatível.

## Resultado esperado

- O cliente recebe a simulação e o bot para.
- O documento só é pedido depois do clique/resposta configurada.
- Se você configurar o passo para ir para outro “passo X”, o bot segue esse passo.
- Se você configurar para repetir, ele repete; se configurar para avançar, ele avança.
- O fluxo deixa de depender do remendo fixo `ask_quero_cadastrar` e passa a respeitar o Flow Builder.