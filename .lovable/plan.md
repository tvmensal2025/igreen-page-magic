## Auditoria profunda do fluxo WhatsApp/Evolution

### O que os dados mostram agora

- O bug anterior de dedupe duplicado realmente existia: antes apareciam apenas outbounds `[inline-sent]`, sem mensagem real.
- Depois da correção, os dois números testados receberam outbound real de boas-vindas:
  - `5511971254913` recebeu o texto de “Olá! Vou te ajudar...” às `14:16:38`.
  - `5511989000650` recebeu o texto de “Olá! Vou te ajudar...” às `14:16:51`.
- O lead `5511989000650` depois enviou um áudio/arquivo; o sistema interpretou como documento/conta, tentou OCR, falhou no Gemini e respondeu “Não consegui ler a conta...”. Ou seja: o webhook está recebendo, processando e enviando mensagens.
- Ainda existe um aviso real de contrato quebrado: `inline_sent_contract_violation` às `14:18:46`, indicando que algum trecho do handler ainda marca `__inline_sent=true` sem garantir outbound real.

### Diagnóstico principal

O fluxo não está “morto” como antes, mas ainda tem riscos de silêncio e uma falha funcional no início:

1. O primeiro passo `d_welcome` envia apenas o texto “Posso começar? 👇”, mas os botões configurados em `_buttons` não são enviados como botões reais nem aparecem listados no texto.
2. O Evolution está enviando sempre texto simples no orquestrador, e há comentário explícito no código dizendo que botões não funcionam na Evolution atual.
3. O passo `d_welcome` tem `wait_for: none`, mas seu fallback é `repeat`; então, depois de enviar o welcome, ele não avança automaticamente para “Pedir conta” e fica esperando uma resposta que não está clara para o usuário.
4. Alguns caminhos ainda usam `__inline_sent=true` como “não envie mais nada”, mesmo quando não houve envio real. A proteção atual detecta isso, mas nem sempre recupera com uma mensagem segura.
5. O cálculo `handlerSentInline = reply === "" && Object.keys(updates).length > 0` ainda mascara silêncio: se o handler apenas muda `conversation_step` sem enviar mensagem, o orquestrador entende como “já respondeu”.

### Problemas encontrados

#### Críticos

1. **Contrato `__inline_sent` ainda inseguro**
   - Arquivo: `supabase/functions/evolution-webhook/handlers/conversational/index.ts`
   - Há caminhos que retornam `__inline_sent=true` em erro, anti-repetição ou redirect de mídia sem confirmar envio real.
   - Sintoma: `inline_sent_contract_violation` nos logs.

2. **Orquestrador confunde update de estado com resposta enviada**
   - Arquivo: `supabase/functions/evolution-webhook/index.ts`
   - `handlerSentInline` considera qualquer update como se fosse envio inline.
   - Sintoma: lead pode avançar no banco sem receber mensagem.

3. **Welcome depende de botões que não são renderizados para o lead**
   - Banco: `bot_flow_steps.captures` tem `_buttons` no passo `d_welcome`.
   - Código: Evolution atualmente envia texto simples, sem botões funcionais.
   - Sintoma: lead recebe “Posso começar? 👇”, mas não recebe opções claras como “1 - Quero simular”.

4. **Primeiro passo não avança para o pedido de conta**
   - Banco: `d_welcome` está com `wait_for: none`, mas `fallback: repeat`.
   - Isso envia welcome e para ali. Se o usuário esperava fluxo automático, parece que “não iniciou”.

#### Graves

5. **Anti-repetição pode silenciar segunda tentativa legítima**
   - Arquivo: `handlers/conversational/index.ts`, função `emitStep`.
   - Quando detecta step/texto recente, retorna `inlineSent: true`, mas isso não significa que algo foi enviado neste turno.

6. **Redirect de arquivo para bot-flow força `__inline_sent=true` mesmo em catch**
   - Se o redirect falha, retorna vazio com `__inline_sent=true`.
   - Isso pode gerar silêncio em erro.

7. **Delay inicial pode estourar timeout da Edge Function**
   - `initial_delay_seconds` aceita até 300s, mas Edge Functions não devem ficar bloqueadas assim.
   - Se algum fluxo configurar delay alto, o inbound fica dedupado e a resposta pode nunca sair.

8. **OCR tentou processar áudio como conta/documento**
   - No teste do número `5511989000650`, o inbound era `audioMessage`, mas entrou como `message_type: document` e foi para OCR de conta.
   - Sintoma: resposta “Não consegui ler a conta” para um áudio, o que confunde o lead.

### Plano de correção

#### 1. Corrigir o contrato de envio inline

- Alterar todos os retornos `__inline_sent=true` para só acontecerem quando:
  - `sender.sendText` retornou sucesso; ou
  - `sender.sendMedia` retornou sucesso; ou
  - uma linha outbound real foi gravada em `conversations`.
- Em caminhos de anti-repetição, usar uma flag interna diferente, por exemplo `__suppressed_duplicate`, sem fingir que houve envio.
- Em caminhos de erro/catch, nunca retornar `__inline_sent=true`.

#### 2. Corrigir o `handlerSentInline` no orquestrador

- Substituir a regra atual:
  ```text
  reply vazio + qualquer update = assume envio inline
  ```
- Por uma regra segura:
  ```text
  só assume envio inline se __inline_sent=true e houver outbound real recente
  ```
- Se houver update de step sem reply e sem outbound real, gerar fallback seguro baseado no step atual ou enviar uma mensagem curta de recuperação.

#### 3. Fazer o welcome funcionar sem botões nativos

Como a Evolution atual está enviando texto simples, converter `_buttons` em opções numeradas dentro do texto quando o step tiver botões configurados.

Exemplo:
```text
Posso começar? 👇

1️⃣ Quero simular
2️⃣ Como funciona
3️⃣ Falar com Rafael
```

Isso mantém as transições atuais, porque elas já aceitam `1`, `2`, `3`, `quero simular`, `como funciona`, `humano`, etc.

#### 4. Ajustar comportamento do primeiro passo

Definir uma regra clara para `d_welcome`:

- Se o passo tem `_buttons`, ele deve ser tratado como passo que espera resposta, mesmo se `wait_for` estiver `none`.
- Assim o sistema não tenta cascatear nem fica em estado ambíguo.
- Opcionalmente, se a intenção for pular direto para conta, ajustar fallback/transição do banco, mas a correção mais segura é respeitar o prompt de escolha.

#### 5. Tratar áudio separadamente de conta/documento

- Se `hasAudio=true`, não redirecionar para OCR de conta.
- Transcrever áudio quando aplicável, ou responder pedindo foto da conta se o lead está em `aguardando_conta`.
- Isso evita “Não consegui ler a conta” quando o lead mandou áudio.

#### 6. Capar delay inicial

- Reduzir teto síncrono de `initial_delay_seconds` para um valor seguro, por exemplo 10–15s.
- Se precisar de delay maior, não bloquear a Edge Function neste turno.

#### 7. Auditar e limpar estado dos leads de teste

Depois da correção, resetar somente os leads afetados:

- `937defb9-e206-4779-9855-92753883cf08`
- `1cf4edd9-9c20-46e5-99e1-f024d2f670bb`

Campos a revisar:

- `bot_paused=false`
- `assigned_human_id=null`
- `conversation_step=welcome` ou `null`, conforme entrada esperada
- limpar dedupe recente desses números/instância apenas se necessário para reteste

#### 8. Validação completa

Testar os dois cenários:

1. Novo número manda `Oi`
   - Deve criar/usar lead correto.
   - Deve enviar welcome com opções visíveis.
   - Não pode aparecer `[inline-sent]` como única resposta.
   - Não pode aparecer `inline_sent_contract_violation`.

2. Lead responde `1` ou `quero simular`
   - Deve avançar para `d_pedir_conta` ou `aguardando_conta`, conforme configuração.
   - Deve enviar pedido de foto da conta.

3. Lead manda áudio quando está aguardando conta
   - Não deve tentar OCR como imagem/documento.
   - Deve pedir foto/arquivo da conta de luz.

### Arquivos que serão alterados

- `supabase/functions/evolution-webhook/index.ts`
  - Corrigir `handlerSentInline`.
  - Fortalecer fallback quando `__inline_sent` viola contrato.

- `supabase/functions/evolution-webhook/handlers/conversational/index.ts`
  - Corrigir retornos `__inline_sent`.
  - Converter botões configurados em texto numerado para Evolution.
  - Ajustar anti-repetição para não fingir envio.
  - Evitar OCR de áudio como conta/documento.
  - Capar delay inicial.

- Possível ajuste de dados via Supabase, sem schema novo:
  - Reset controlado dos leads de teste.
  - Sem migration de estrutura, salvo se aparecer necessidade durante a implementação.

### Resultado esperado

Depois da correção, o fluxo deve iniciar de forma visível para qualquer número novo, mostrar opções claras, avançar após resposta do lead e não depender mais de marcadores internos como `[inline-sent]` para mascarar envio real.