## Diagnóstico do fluxo do lead 11971254913

Pelo histórico real do customer `42d4821f-1d75-4162-b0c2-8613fa19b960`, o fluxo não está mais travando por duplicação do `capture_*`, mas ainda está incoerente por três causas principais:

### 1. Mensagem/mídia fora de lugar após confirmar a conta
Sequência real:

```text
09:55:24 cliente enviou conta
09:55:46 cliente confirmou conta: ✅ SIM
09:56:10 bot enviou áudio [como_funciona]
09:56:31 bot enviou vídeo [como_funciona]
09:56:35 bot enviou resultado da simulação
```

Isso está errado. Depois que a conta já foi lida e confirmada, o bot não deveria mandar “Como funciona” de novo. O correto é ir direto para a simulação/resultado e parar no CTA de cadastro.

Causa provável: a configuração do fluxo D ainda permite que o pós-confirmação da conta passe por `d_como_funciona` antes de `d_resultado`, ou o `success_goto_step_id`/cadeia de mensagens está apontando para o passo errado.

### 2. CNH foi tratada como RG e virou “verso”
Sequência real:

```text
09:57:21 bot pediu documento: RG frente/verso ou CNH frente
09:57:33 cliente enviou arquivo
09:58:06 bot respondeu: “Frente recebida! Agora envie o VERSO do RG”
09:58:26 cliente enviou outro arquivo
09:58:39 bot pediu CPF
```

No customer atual:

```text
document_type = rg_antigo
document_front_url = preenchido
document_back_url = preenchido com PDF de CNH Digital
```

Ou seja: o primeiro documento foi classificado como `rg_antigo`, então o bot pediu verso. Depois, o arquivo de CNH Digital enviado pelo cliente foi salvo como se fosse `document_back_url`/verso do RG. Isso contaminou o OCR e levou o motor a pedir CPF/RG manualmente.

Causa técnica: `detectDocumentTypeDetailed` só pergunta ao usuário quando falha totalmente (`fallback` + confiança 0). Se o Gemini chuta `rg_antigo` com baixa/média confiança, o handler aceita e já pede verso. Para documento, chute não pode avançar.

### 3. CPF/RG foram pedidos em sequência porque o OCR não recuperou campos essenciais
O motor atual usa `getNextMissingStep`:

```text
nome → cpf → rg → nascimento → telefone → email → endereço...
```

Então, quando o OCR do documento salva nome mas não salva CPF/RG/data com confiança, ele pergunta campo por campo. Isso é tecnicamente esperado, mas ruim para experiência quando o cliente acabou de enviar CNH. Antes de pedir CPF/RG manualmente, o sistema precisa rodar OCR focado e validar se o arquivo enviado era CNH, RG frente, RG verso ou conta.

## Plano de correção definitiva

### 1. Corrigir o pós-conta para nunca enviar “Como funciona” depois da conta confirmada
- Ajustar a regra do pós-`confirmando_dados_conta` para permitir apenas:
  1. `d_resultado` / simulação;
  2. CTA “Cadastrar agora”;
  3. parada em `ask_quero_cadastrar`.
- Se a configuração do fluxo apontar para `d_como_funciona`, o código deve pular esse passo nessa fase.
- Corrigir no banco a configuração do fluxo D para que `capture_conta.fallback.success_goto_step_id` aponte diretamente para `d_resultado`.

### 2. Blindar classificação de documento
No `aguardando_doc_auto`:

- Não aceitar `rg_antigo`/`rg_novo` por baixa confiança.
- Se a confiança da classificação for baixa ou ambígua, salvar a imagem como frente pendente e perguntar:

```text
Recebi o documento, mas preciso confirmar: é RG ou CNH?
```

- Só pedir verso quando houver certeza de que é RG.
- Se for CNH, marcar imediatamente:

```text
document_type = cnh
document_back_url = nao_aplicavel
```

E nunca pedir verso.

### 3. Reclassificar arquivo recebido no passo de verso
No `aguardando_doc_verso`:

- Antes de salvar como verso, rodar detecção do arquivo recebido.
- Se o arquivo parecer CNH/PDF de CNH, não salvar como verso de RG.
- Nesse caso, substituir a frente pelo arquivo correto, marcar `document_type=cnh`, `document_back_url=nao_aplicavel` e processar como CNH.
- Se parecer conta de luz, responder que ali é o passo do documento e pedir RG/CNH, sem sobrescrever documento.
- Se parecer outra frente de RG em vez de verso, avisar que precisa do verso.

### 4. Rodar OCR focado antes de pedir CPF/RG/data manualmente
Antes de cair em `ask_cpf`, `ask_rg` ou `ask_birth_date`:

- Rodar segunda passada focada em CPF.
- Rodar passada focada em RG/registro.
- Rodar passada focada em nascimento.
- Só pedir manualmente o que realmente continuar faltando.
- Se faltarem vários campos, pedir em uma única mensagem clara, em vez de várias perguntas soltas.

Exemplo:

```text
Consegui ler seu documento, mas alguns dados ficaram ilegíveis.
Me envie em uma mensagem só:
CPF:
RG ou registro da CNH:
Data de nascimento:
```

### 5. Ajustar texto para CNH
- Quando `document_type=cnh`, não usar “verso” nem “RG”.
- Se precisar do número, pedir como “RG/registro da CNH”, não apenas “RG”.
- Mensagem correta quando CPF não é lido:

```text
Não consegui ler o CPF na CNH. Digite os 11 números do CPF para continuar.
```

### 6. Auditar e corrigir mídias do fluxo D
Configuração encontrada:

- `d_como_funciona` tem áudio/vídeo e está sendo enviado após conta confirmada, onde não deveria.
- `d_confirmar_telefone` tem um áudio configurado com conteúdo aparentemente de outro contexto (“Esse vídeo que eu mandei...”), ligado ao slot `passo_mpagqq3g`.
- `consultants.flow_step_media_order` tem overrides diferentes do `media_order` salvo em `bot_flow_steps`, então a UI pode estar mandando mídia em ordem inesperada.

Correção:

- Remover/desativar mídia incorreta no passo de telefone.
- Garantir que passos de captura (`capture_conta`, `capture_documento`, `capture_email`, `confirm_phone`) enviem só o prompt correto e não mídias antigas fora de contexto.
- Deixar `d_resultado` como único passo pós-conta antes do CTA.

### 7. Recuperar o lead 11971254913
Como esse lead já foi enviado ao portal com documento contaminado, a recuperação segura é:

- Pausar o envio automático desse customer, se ainda estiver em processamento.
- Limpar somente os campos de documento contaminados:
  - `document_type`
  - `document_front_url`
  - `document_front_base64`
  - `document_back_url`
  - `media_message_id`
  - `cpf`, `rg`, `data_nascimento` se vieram dessa leitura incorreta
- Manter dados bons da conta de luz.
- Voltar para `ask_quero_cadastrar` ou `aguardando_doc_auto` e pedir o documento novamente com a regra nova.

### 8. Validação final
Testar a jornada real em três cenários:

1. Conta → confirmar → resultado → CTA → CNH frente/PDF
   - Não envia “Como funciona” após conta.
   - Não pede verso.
   - Extrai CPF/RG/data ou pede só faltantes.

2. Conta → confirmar → resultado → CTA → RG frente → RG verso
   - Só pede verso após confirmar que é RG.
   - Não aceita CNH como verso.

3. Cliente envia documento no passo errado da conta
   - Não salva CNH como conta.
   - Responde com orientação correta e mantém o passo coerente.

## Arquivos/camadas que serão alterados após aprovação

- `supabase/functions/whapi-webhook/handlers/bot-flow.ts`
- `supabase/functions/evolution-webhook/handlers/bot-flow.ts`
- `supabase/functions/_shared/detect-doc-type.ts`
- `supabase/functions/_shared/ocr.ts`, se precisar reutilizar OCR focado já existente
- Migration pontual para corrigir configuração do fluxo D e recuperar o customer `42d4821f...`

