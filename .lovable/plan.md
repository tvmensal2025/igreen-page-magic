## Análise profunda — Fluxo A não está seguindo as etapas

### O que verifiquei no banco

**Fluxo A (`28acf20a-eaac-4548-8cf9-041781c41f56`, variant=A, is_active=true) — 5 steps:**


| pos | step_key                          | step_type            | captures                                                            |
| --- | --------------------------------- | -------------------- | ------------------------------------------------------------------- |
| 1   | `passo_mqozng6u` (id `3d69389d…`) | `capture_conta`      | `**[]` vazio**                                                      |
| 2   | `passo_mqoznqri`                  | `capture_documento`  | `[{kind:media, name:documento_cliente, auto_detect_doc_type:true}]` |
| 3   | `passo_mqoznz0g`                  | `capture_email`      | `[{kind:text, name:email}]`                                         |
| 4   | `passo_mqozocdy`                  | `confirm_phone`      | `[{kind:text, name:telefone}]`                                      |
| 5   | `passo_mqozop4s`                  | `finalizar_cadastro` | `[]`                                                                |


**Lead `5511971254913` (customer `02eda00b…`):**

- `conversation_step = 3d69389d…` (step 1)
- `previous_conversation_step = welcome`
- `ocr_conta_attempts = 0` ← OCR nunca rodou
- `flow_variant = A`

**Conversa registrada:**

- 15:37:10 — inbound "Oi" (step=null)
- 15:44:03 — inbound imagem (step já = step 1)
- **0 outbound registrados** (nem o prompt do step 1)

**outbound_message_log:** última tentativa 09:48 de hoje, todas com `result_status: failed`.

**Logs whapi-webhook (16:15 e 16:19):** imagens entrando, mas `parseWhapiMessage` retornou null e marcou "Mensagem ignorada".

### Onde está quebrando — 3 camadas

**1. Bug do router-bridge (já corrigido + deployado nesta sessão)**
`whapi-webhook/index.ts:1766-1795` — quando o `conversation_step` é UUID de `capture_conta`, o bridge força `engine=sys` (que tem OCR), mas o bloco logo abaixo revertia pra `flow`. Resultado: PDF/imagem caía no handler conversacional sem OCR e o bot ficava mudo. Flag `bridgeForcedSysForCapture` agora bloqueia a reversão.

**2. `captures: []` vazio no step 1**
O step 1 (`capture_conta`) não declara `name: conta_luz, kind: media` como os outros. O `custom-step-resolver` (bot-flow.ts:3032) mapeia `capture_conta` → legacy `aguardando_conta`, que sabe processar a imagem mesmo sem `captures` preenchido — mas a inconsistência pode causar o resolver a tratar como "no-match" e re-emitir prompt.

**3. `parseWhapiMessage` ignorando imagens recentes (16:15 / 16:19)**
Pelo summary do log (`fromMe:[false], type:[image], count:1`), a função NÃO deveria retornar null. Sem `chat_id` no log, suspeito de `@status` ou variante de @newsletter não coberta. Precisa logar o motivo do null.

### Plano de ação

**A. Verificar se o fix do router-bridge resolveu (5 min)**

1. Resetar o `conversation_step` do customer `02eda00b…` pra `null` (forçar re-welcome) OU pedir pro Rafael mandar nova conta agora.
2. Conferir em `outbound_message_log` se aparece um envio com `result_status='sent'` em vez de `failed`.
3. Conferir `ocr_conta_attempts` virou ≥ 1.

**B. Instrumentar `parseWhapiMessage` pra explicar o null**
Trocar `return null` por logs específicos (`group`, `from_me_api`, `empty`, `unknown_type`) e re-deployar — sem isso continuamos cegos sobre as imagens "ignoradas".

**C. Normalizar step 1 (`captures: []` → `captures: [{kind:media, name:conta_luz, required:true, accepts:[image,document], retry_text:"📸 Pode reenviar a foto da sua conta de luz?"}]`)**
Deixa o step igual aos outros e elimina caminho de "no-match".

**D. Investigar por que o welcome de step 1 nunca foi enviado pro lead**

- Verificar se `consultantFlag` está true pro super-admin
- Verificar se `customerOverride` não está `false`
- Conferir histórico de erros do whapi-proxy entre 15:37 e 15:45

### Perguntas antes de implementar

- Posso **resetar o `conversation_step` do lead 5511971254913 pra null** pra testar o fix limpo? (apaga progresso atual do cadastro dele)
- Quer que eu **adicione o capture do step 1** já nesta passada, ou só instrumentar/testar primeiro? SIM MAS ANALISE TODOS E JA FACA EM SEGUIDA TODOS COM O TEXTO QUE ESTA LA E QUE SIGA CADA ETAPA COMO TEM QUE SEGUIR TODAS
- Confirma que **só estamos olhando Whapi (super admin Rafael)** e não Evolution? Evolution está offline (`needs_reconnect`) mas não é o canal deste lead.