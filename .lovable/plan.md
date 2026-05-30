## Diagnóstico do erro no lead 11971254913

O reset criou um customer novo (`42d4821f...`) e o fluxo voltou a andar, mas o erro continuou por outro motivo:

1. A conta de luz foi recebida em `aguardando_conta`, mas os dados de conta ficaram vazios (`electricity_bill_value = null`, `bill_base64 = false`). Mesmo assim o fluxo avançou e enviou `d_resultado` com variáveis não preenchidas: `R$`  e `{{economia_range}}`.
2. Ao clicar em “Cadastrar agora”, o bot entrou em `d_pedir_documento`.
3. O documento/CNH foi recebido e o handler processou como `aguardando_doc_auto`, porém logo depois o resolver custom re-emitiu `d_pedir_documento` e, por fallback de posição, avançou para `d_pedir_email`.
4. Resultado: o lead recebeu pedido de documento duplicado e depois pedido de e-mail; quando enviou o e-mail, o bot já estava tentando validar CPF (`ask_cpf`) porque o OCR da CNH não extraiu CPF. Por isso saiu “CPF inválido”.

Ou seja: não é mais o bug antigo do `variant='A'`. Agora são dois problemas no motor:

- `capture_documento` está sendo tratado como se fosse passo de mensagem e avança para e-mail logo após reemitir o prompt.
- `capture_conta` permitiu avançar para simulação mesmo sem dados OCR/valor válidos.

## Plano de correção

### 1. Impedir que `capture_*` avance como mensagem

Nos dois webhooks:

- `supabase/functions/whapi-webhook/handlers/bot-flow.ts`
- `supabase/functions/evolution-webhook/handlers/bot-flow.ts`

Ajustar o resolver de `bot_flow_steps` para que, quando o step custom for `capture_conta`, `capture_documento`, `capture_email` ou `confirm_phone`, ele apenas roteie para o handler legacy correto e pare ali.

Comportamento esperado:

- `d_pedir_documento` emite o texto uma vez e fica em `aguardando_doc_auto`.
- Quando o lead manda CNH/RG, o documento é processado.
- O fluxo só avança para `d_pedir_email` depois do handler de documento concluir e decidir o próximo passo.

### 2. Bloquear simulação se a conta não foi lida

No processamento de conta (`aguardando_conta`):

- Se OCR/extração não preencher valor/nome/conta mínima, manter o lead em `aguardando_conta` ou no campo de edição necessário.
- Não permitir `d_resultado` com `R$`  vazio ou `{{economia_range}}` cru.

### 3. Corrigir avanço pós-CNH sem CPF

No handler `aguardando_doc_auto`:

- Se CNH/RG foi recebido, salvar `document_front_url/base64` e tentar OCR imediatamente.
- Se o OCR não extrair CPF, pedir CPF com uma mensagem correta (“Não consegui ler o CPF no documento, digite os 11 números”), sem tratar e-mail como CPF.
- Se extrair CPF, seguir para e-mail/telefone conforme faltantes.

### 4. Anti-duplicação pontual para prompt custom

Garantir que `last_custom_prompt_at` seja gravado também quando um `capture_*` custom é emitido, para o handler legacy não re-pedir a mesma coisa nos próximos minutos.

### 5. Recuperação do lead 11971254913

Criar uma migration pontual para recolocar o customer ativo (`42d4821f...`) em um estado coerente:

- Se documento foi salvo, colocar em `ask_cpf` com mensagem correta no próximo inbound.
- Se não foi salvo, voltar para `aguardando_doc_auto`/`d_pedir_documento` e pedir para reenviar a CNH.

Pelos dados atuais, `document_front_url` e `document_front_base64` estão vazios, então a recuperação segura é voltar para `aguardando_doc_auto` e pedir reenvio do documento.

### 6. Validação

Após implementar:

- Testar nos logs/DB que `11971254913` não recebe mais `d_pedir_documento` duplicado.
- Confirmar que `d_resultado` só aparece com valor/economia preenchidos.
- Confirmar que CNH PDF em `aguardando_doc_auto` salva documento e avança para CPF/e-mail sem pular etapas.

## Arquivos afetados

- `supabase/functions/whapi-webhook/handlers/bot-flow.ts`
- `supabase/functions/evolution-webhook/handlers/bot-flow.ts`
- resetar o 11971254913 para iniciar do 0 o fluxo
- &nbsp;