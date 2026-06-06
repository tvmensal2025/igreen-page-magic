## Diagnóstico do lead 11971254913

O lead `5511971254913` está no consultor correto `953f7e48-509b-4069-9822-bdad9902be09`, variante `D`.

A sequência real no banco mostra:

```text
03:09:50 bot pediu conta de luz
03:10:35 cliente enviou imagem da conta
03:10:51 cliente confirmou dados da conta com "1"
03:10:55 bot enviou simulação d_resultado
03:11:02 cliente respondeu "1" para continuar cadastro
03:11:06 bot enviou d_welcome de novo, em vez de pedir documento
```

A conta foi recebida e processada. O problema não é OCR nem envio da conta de energia.

## Causa encontrada

Existe uma contaminação de step entre consultores/fluxos:

- A mensagem inbound `03:11:02` ficou marcada com `conversation_step = 4df1f90a-0248-4df0-9473-4c910f1b22bd`.
- Esse step `4df1...` pertence a outro consultor (`0c2711ad-4836-41e6-afba-edd94f698ae3`) no fluxo `Fluxo Whapi (botões)`.
- O fluxo ativo correto do lead é outro: `b539a8a2-3ba2-4d36-9d7b-0f3d3df129b3`.
- O `d_resultado` correto desse lead é `fa170374-fc84-45de-815a-b1535ab24958`, que aponta corretamente para `d_pedir_documento` (`6dc972a2-b2b2-4669-96fc-5937d08af0dc`).

Também há um ponto perigoso no código Evolution pós-confirmação da conta:

```ts
.from("bot_flow_steps").select("*")
.eq("id", _successId)
.eq("is_active", true)
.maybeSingle()
```

Esse lookup busca por ID sem prender no `flow_id` ativo. Se o fallback/success_goto contém ID antigo ou de outro fluxo, o sistema pode salvar o step errado no customer. Depois, quando o cliente responde `1`, o resolver não encontra esse step no fluxo correto e o bot cai em reentrada/boas-vindas.

## Correção planejada

1. Corrigir `evolution-webhook/handlers/bot-flow.ts`
   - No bloco `post-confirm-conta`, carregar `_successId` sempre com:
     - `.eq("flow_id", _flowRowSuccess.id)`
     - `.eq("id", _successId)`
   - Se o ID não pertencer ao fluxo ativo, ignorar esse ID e buscar o `d_resultado` do fluxo correto por `step_key`/posição.
   - Nunca persistir `conversation_step` com ID de step de outro fluxo.

2. Aplicar a mesma proteção no `whapi-webhook/handlers/bot-flow.ts`
   - Ele já está mais próximo do correto em alguns trechos, mas também há lookup pós-conta por ID sem `flow_id`.
   - Padronizar os dois canais para impedir contaminação cruzada.

3. Fortalecer o resolver de step customizado
   - Quando `customer.conversation_step` for UUID e não existir no fluxo ativo do consultor:
     - não reenviar welcome;
     - tentar recuperar pelo último outbound do próprio cliente com `conversation_step` textual (`d_resultado`, `ask_quero_cadastrar`) ou pelo `step_key` equivalente no fluxo ativo;
     - se a resposta for `1`/`quero cadastrar` após uma simulação, avançar para `ask_quero_cadastrar` ou `aguardando_doc_auto`, conforme regra atual de separação conta/documento.

4. Corrigir o lead específico no banco após o patch
   - Ajustar `customers.conversation_step` de `flow:dfa0e6d9...` para o estado correto pós-simulação.
   - Como o cliente já clicou `1` para continuar, o estado ideal é pedir documento (`aguardando_doc_auto`) ou reemitir o CTA `ask_quero_cadastrar`, dependendo da regra que você preferir manter.
   - Minha recomendação: reemitir o CTA `ask_quero_cadastrar` se quiser preservar a regra “documento só dispara após clique”; ou enviar direto o pedido de documento porque ele já clicou `1`.

5. Validar
   - Consultar o lead novamente.
   - Conferir que nenhum step de `consultant_id = 0c2711...` aparece em conversas/customers desse lead.
   - Testar mentalmente o fluxo:

```text
confirmando_dados_conta + 1
→ envia d_resultado do fluxo b539...
→ customer fica em fa170... ou ask_quero_cadastrar
→ cliente responde 1
→ vai para d_pedir_documento / aguardando_doc_auto
```

## Resultado esperado

Após a correção, o lead `11971254913` não deve mais voltar para o início após a simulação. Ao responder `1`/`quero me cadastrar`, ele deve receber o pedido de documento e seguir o cadastro normalmente.