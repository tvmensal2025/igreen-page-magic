# Arquitetura operacional

## Turno inbound do Grupo A (Whapi e Evolution)

Fluxo oficial: WhatsApp → Grupo A determinístico → FAQ/atalhos → texto e áudio →
pizza/cadências → portal. Fluxo B e motor V3 permanecem desligados.

Os dois canais rodam o mesmo Grupo A e compartilham guard de pausa, drain de
rajada, gate de outreach e commit de outbound. A diferença é só de apresentação:
**Whapi usa botões, Evolution usa opções numeradas** (`sendButtons` do Evolution
formata "1. opção" no próprio texto). Nenhuma correção abaixo troca botão por
número nem o contrário.

Ordem canônica de um turno (2026-08):

1. **Dedupe** por `message_id` (`webhook_message_dedup`).
2. **Anti-flood** por telefone. Quando barra, o inbound ainda é gravado em
   `conversations` e marcado em `pending_inbound_message_id` — anti-flood
   adia, nunca descarta.
3. **Log do inbound** em `conversations`. O instante desse log é a janela do
   turno usada pelo drain.
4. **Lock** por lead (`bot_processing_until`, RPC `try_lock_customer_processing`).
   Mensagem que chega com o lock ocupado vai para a fila pendente.
5. **Motor** (Grupo A determinístico / FAQ / atalhos).
6. **Commit do turno** — `_shared/bot/outbound-commit.ts`:
   **enviar → persistir estado → gravar histórico**. Envio recusado pelo canal
   (`false`, `{ok:false}`, exceção) não avança `conversation_step`, não marca
   `last_bot_reply_at` e não entra em `conversations`.
7. **Drain da rajada** — `_shared/bot/pending-inbound.ts` reprocessa todos os
   inbounds da janela do turno, em ordem, sem repetir a mensagem já tratada.
   A janela é o início do turno (`turnWindowStartIso`), não `pending_inbound_at`:
   a linha em `conversations` é gravada antes do marcador, então a janela do
   marcador deixava a própria mensagem barrada de fora.
8. **Release do lock**.

O `evolution-webhook` persiste o estado **antes** do envio, porque o drain da
fila roda no meio do turno e inverter a ordem mudaria a serialização. Para o
lead não ficar parado numa etapa cuja pergunta nunca chegou, o resultado real
do canal alimenta `shouldRevertStepAfterFailedSend`, que desfaz só o avanço de
etapa. Conservador de propósito: não reverte em `queued`, não reverte se a
rajada foi drenada depois e não reverte quando o silêncio é intencional
(`paused_by_human`, `dnc`, `opt_out`) — nesse caso quem manda é o humano.
Dados extraídos do lead (nome, e-mail, valor da conta) nunca são revertidos.

Isolamento e concorrência:

- O contexto do turno no handler conversacional (pergunta do passo, vars, id
  do lead, texto recebido) vive em `AsyncLocalStorage`, não em variável de
  módulo — dois inbounds simultâneos no mesmo isolate não se contaminam.
  Se o runtime não suportar `enterWith`, cai no objeto compartilhado antigo.
- `wrapSenderWithLivePauseGuard` re-lê o lead antes de cada outbound e é
  fail-closed: leitura com erro não libera o bot. Cobre `sendText`,
  `sendButtons`, `sendMedia` e também `sendTextDetailed`/`sendButtonsDetailed`
  — é por essa variante que o `evolution-webhook` manda a resposta principal
  do turno, e sem o wrapping ela escapava do guard.
- Envio proativo (`cadence-tick`) passa `respectInboundTurn: true` em
  `assertBotOutboundAllowed`; com turno inbound em andamento ou fila pendente
  recente (< 5 min), o toque é adiado para o próximo tick. Marcador pendente
  órfão nunca silencia o lead. Envio manual do consultor não usa esse gate.
- FAQ/atalhos dentro de cadastro rodam com `keepStep: true` e não alteram
  `conversation_step`; a regra comercial de fechamento (`is_closing`) continua
  valendo apenas fora dos passos de cadastro (`NO_QA_STEPS`).
- Resposta de FAQ recusada pelo canal não entra em `conversations` e não marca
  a dúvida como respondida — o turno segue para o tratamento normal em vez de
  encerrar como se o lead tivesse sido atendido.
- Áudio e vídeo nunca se repetem para o mesmo lead, e o slot dessa regra é
  queimado em duas fases: `dispatchMediaOnce` (`_shared/media-dedupe.ts`)
  reserva, envia e só confirma se o canal aceitar. Envio recusado — erro do
  canal, humano assumiu no meio da cascata, mídia fora do ar — libera a reserva
  e a mídia pode sair no próximo turno. Antes o slot era confirmado antes do
  envio e um áudio que falhava ficava queimado para sempre naquele lead.
  `canSendMediaOnce` (confirmação imediata) segue existindo para o envio manual
  do consultor, onde a falha é visível e ele pode reenviar.

### Histórico só registra o que o canal aceitou

`commitOutboundTurn` cobre a resposta principal do turno, mas os handlers também
enviam fora dele: texto de abertura, cascata de passos, mídia da FAQ, CTA pós-IA,
nudge, botão de finalizar, fallback de dispatch. Nesses pontos o send era
`await`-ado e o `insert` em `conversations` vinha logo abaixo, sem olhar o
retorno.

Isso importa porque `sendText`/`sendMedia`/`sendButtons`/`sendOptions` **recusam
sem lançar exceção**: guard de pausa humana, destino não resolvido
(`whapi_dest_unresolved`), erro HTTP do canal. O `try/catch` em volta não pega
nada e o consultor via no CRM uma conversa que o lead nunca recebeu — inclusive
com `delivery_status: "sent"` gravado à mão em alguns pontos.

Agora todo `insert` de outbound passa por `isSendConfirmed`
(`_shared/bot/outbound-commit.ts`). Onde já existia `catch` que registra
`message_type: "text_failed"`, a recusa sem exceção é convertida em
`throw new Error("send_refused_by_channel")` para cair no mesmo tratamento, em
vez de criar um segundo caminho de falha.

Duas redes contra regressão, que precisam concordar:
`scripts/audit-outbound-sem-guarda.ts` (levantamento, imprime o trecho) e
`src/test/outbound-sempre-guardado.test.ts` (falha o CI). Ao adicionar um envio
novo, os dois devem continuar em zero.

### Áudio personalizado não vaza entre leads

O stitch de áudio é chaveado por consultor + slot + gênero + **nome
normalizado** (`stitch:<slot>:<ver>:<gênero>:<nome>`), e as intros seguem o mesmo
padrão. Sem fonte confiável de nome (`resolveWaDisplayName`), não personaliza.
`wa-audio-stitch.ts` não tem estado mutável de módulo, e o warm recebe
`captureUpdates.name` do turno — não um `customer` relido depois que outro turno
mexeu na linha. Coberto por `src/test/audio-turno-correto.test.ts`.

## Retomada após atendimento humano

Quando o consultor assume uma conversa, todos os caminhos devem manter as duas
camadas sincronizadas:

1. `customers`: `bot_paused=true`, motivo humano e responsável em
   `assigned_human_id`;
2. `lead_cadence_state`: `paused_reason='handoff_humano'` e
   `next_action_at` agendado para reavaliação após 48 horas.

Os webhooks Whapi/Evolution e a edge `customer-takeover` usam
`_shared/bot/handoff-resume.ts`. Os caminhos diretos da interface usam
`pauseCadenceForHandoff` e `resumeCadenceFromHandoff`, em
`src/lib/handoffReturnToPizza.ts`.

No vencimento, `cadence-tick` consulta a última mensagem em `conversations`.
Se ainda não completou 48 horas de silêncio, reagenda. Se completou, limpa
`bot_paused`, `bot_paused_reason`, `bot_paused_until` e `assigned_human_id`
antes de devolver a cadência. Bloqueio, opt-out, reclamação, `bulk_pro` e
`do_not_contact` nunca são liberados por tempo.

O pré-passo do `cadence-tick` recupera registros legados com
`next_action_at IS NULL`, evitando que uma integração antiga deixe o lead
invisível ao claim.

## Portal e QR de parceiros

`qr-redirect` resolve o parceiro e o canal WhatsApp, filtra diagnóstico e
preview de link, e deduplica leituras repetidas do mesmo alvo em 15 segundos.
`get_partner_banner_portal` aplica a mesma janela ao histórico e devolve
`outside_cycle`, explicando por que cada lead não está na pizza A/B/C.

## Recusa de documento por tipo errado

Quando `detectDocumentTypeDetailed` devolve `outro` (conta de luz, selfie,
boleto, página em branco), o handler recusa o arquivo, mantém o lead no passo
e **conta a tentativa** em `ocr_doc_attempts`. Ao atingir `max_retries` do
passo `capture_documento` com `then: "humano"`, pausa o bot com
`bot_paused_reason = doc_tipo_invalido_max_retries` e avisa que vai chamar o
consultor.

Antes a recusa não contava tentativa. Como o texto da recusa é idêntico a cada
envio e o turno suprime outbound repetido dentro de 60 s (`isDuplicate` em
`whapi-webhook/index.ts`), o lead recebia o aviso duas vezes e depois só
silêncio — sem escalada, porque o contador nunca saía de 0. A mensagem de
escalada difere da recusa simples, então ela passa pelo filtro de repetição.

Variantes D/MG usam `fallback: {mode: "repeat"}`: contam a tentativa mas não
escalam. É configuração do fluxo, não do código.

## Corte de conta baixa (valor mínimo da esteira)

`LOW_BILL_MIN_VALUE = 100` em `_shared/bot/low-bill-reentry.ts`. Lead que
informa conta abaixo disso **no passo que pergunta o valor** sai da esteira:
`status = rejected`, `bot_paused_reason = low_bill_value`,
`conversation_step = valor_baixo`.

A decisão vive em `evaluateLowBillCutoff`, chamada pelos dois handlers
conversacionais logo depois de persistir a captura e **antes** do avanço
pós-captura (`resolveLandingStep`) — invertida, o lead já teria saído do passo
do valor e seguiria para foto da conta e documento.

O corte só olha o passo cujas `captures` incluem `electricity_bill_value`. Um
número citado de passagem em outro passo ("pago uns 50 de água") não
desqualifica ninguém.

A recusa é reversível: `low_bill_value` é exatamente o motivo que
`evaluateLowBillReentry` reconhece, então o lead que volta dizendo que a conta
subiu (ou com intenção clara de cadastro) é religado no Grupo A.

O corte já existia nos passos conversacionais legados (`qualificacao`,
`pos_video`), mas consultor com fluxo do construtor nunca cai neles — há lock
explícito remapeando os legados. Na prática a regra não rodava: o E2E de
2026-08 levou um lead de R$ 60 até o pedido de documento ouvindo "economia de
R$ 4 a R$ 12".

### `captures` decide o que o passo pede, não o título

Mesmo depois de instalado, o corte continuou sem rodar. O passo do valor tem
título *"Áudio (nome) + texto pedir valor da conta"* e slot
`a2_audio_activate_name`: os dois citam o nome porque o **áudio** é
personalizado, não porque o passo peça nome. A heurística `stepIsAskName`
casava `\bnome\b` no título, o bloco `!stepIsAskName` não capturava o valor e
`captureUpdates.electricity_bill_value` chegava vazio ao corte.

Agora só `captures` e `step_type` — dados estruturados que o consultor declara —
decidem que um passo pede nome. Título e `slot_key` são texto livre e passaram a
valer apenas quando o passo **não** declara captura de `electricity_bill_value`.
É o espelho da proteção que já existia do outro lado: o branding "Conta de Luz"
no `message_text` do `a1` fazia `isValueStep=true` no passo do nome.

O roteiro E2E também dava PASS falso aqui: no cenário `valor_baixo` qualquer
pausa virava `low_value`, inclusive pausa por documento recusado. `classifyStop`
passou a olhar `bot_paused_reason`, e o check exige que o lead **não** tenha
chegado a `aguardando_conta`/`aguardando_doc_auto`.

### O corte definitivo mora na porta da simulação

Mesmo com a captura consertada, o lead de R$ 60 ainda passava. A telemetria de
`ai_decisions` mostrou por quê: no turno em que o lead responde "60", o
`step_before` registrado já é `a3_explain_with_buttons` — a captura e o avanço
acontecem antes, e o corte da fase de captura só enxerga `captureUpdates` do
turno corrente. Qualquer caminho que preencha o valor fora dali (OCR da conta,
motor legado) escapava.

O corte passou a valer também dentro de `goToStep`, colado na guarda R6: o passo
cujo texto cita `{{valor_conta}}`/`{{economia_*}}` não é emitido se o valor
faltar **nem** se estiver abaixo de `LOW_BILL_MIN_VALUE`. É o gargalo por onde
toda simulação passa, então independe de onde o valor foi capturado. O corte da
fase de captura continua no lugar — ele responde mais cedo, no mesmo turno.

## Uma mensagem do lead avança um passo, não dois

`a1_ask_name` tem transição `default` para `a2_text_ask_bill_value`, que tem
`default` para `a3_explain_with_buttons`. Quando o lead mandava só o nome, o
motor pousava no `a2`, emitia a pergunta do valor por `emitCurrentBeforeGoto` e
em seguida aplicava a `default` do próprio `a2` — usando a mesma mensagem ("Joao
Silva") como se fosse a resposta do valor. O lead recebia, no mesmo turno, a
pergunta e a simulação: *"Com base no valor de **R$ **, hoje você consegue
economizar cerca de todos os meses"*.

Duas proteções, em camadas:

1. **Causa** — `emitCurrentBeforeGoto` devolve `true` quando o passo que acabou
   de emitir ainda tem campo hard sem captura (`name`, `electricity_bill_value`,
   `cpf`, `phone_whatsapp`). Os três caminhos de avanço (fallback configurado,
   transition `default`, próximo por posição) param aí via `stayOnCurrentStep()`,
   que mantém `conversation_step` no passo atual e **preserva `captureUpdates`** —
   sem isso o nome recém-capturado se perderia e o bot perguntaria de novo.
   Emitir a pergunta é o próprio reconhecimento de que ela não foi respondida;
   avançar no mesmo turno se contradiz.

2. **Rede de segurança** — `goToStep` não emite passo cujo `message_text`
   referencie `{{valor_conta}}`, `{{economia_range|faixa|mensal|anual}}` ou
   `{{valor}}` enquanto o lead não tiver `electricity_bill_value >= 30`; pede o
   valor no lugar. É a mesma guarda R6 que já existia em
   `handlers/bot-flow.ts` (`dispatchStepFromFlow`) e faltava no conversacional.
   O limite olha `captureUpdates` antes do `customer`, senão bloquearia justo o
   turno que traz o valor.

Regressão: `src/test/valor-antes-da-simulacao.test.ts`.

## FAQ e atalhos: o fluxo público A é a fonte única

O catálogo canônico vive em dois lugares que precisam contar a mesma história: a
UI do superadmin lê `src/lib/objectionShortcuts.ts` e o bot lê `bot_flow_qa` do
fluxo público `Sofia — Ativação Multicanal` (variant `A`). Cada consultor tem o
próprio fluxo, então antes o conteúdo divergia — havia fluxo com 0, 24, 33 e 40
cards, e o intent "Como funciona" não existia em nenhum.

`sync_qa_from_master_flow(_flow_id)` espelha o master num fluxo alvo: cria o que
falta, atualiza texto e gatilhos do que existe e apaga os intents listados em
`DEPRECATED_QA_INTENTS`. `sync_qa_all_flows_from_master()` percorre **todos** os
fluxos (não filtra `is_active`, então fluxo arquivado também fica pronto para
quando voltar), e o trigger `auto_seed_faq_on_flow_create` passou a usar o master
ao criar fluxo novo, com os seed packs antigos só como fallback. Migration:
`20260806182000_qa_master_sync_all_flows.sql`.

O preço da fonte única: resposta de intent canônico que o consultor tenha
editado à mão volta ao texto do master no próximo sync. Card com intent que não
existe no master é preservado — é ali que mora a customização legítima.

Estado esperado depois do backfill: 36 cards em cada fluxo ativo, sem card nem
gatilho repetido. Gatilhos de uma palavra só foram removidos — casavam com
qualquer frase e roubavam a vez do fluxo determinístico.

## Recondução depois de uma dúvida

Responder a dúvida sem dizer o que o passo espera deixa o lead parado. O
fechamento contextual mora em `_shared/qa-step-close.ts` e vale para os dois
canais.

`withQaStepClose` recebe o **`step_key`**, não o UUID do passo. O conversacional
passava `conversation_step` cru (`flow:<uuid>`), o mapa de fechamento nunca
casava e o lead recebia a explicação sem recondução. O `resolveFaqReturnStep`
também passou a rodar **antes** de montar o texto: `a3b` não tem botões e o
fechamento tem que falar do `a3`, o passo onde o lead realmente fica.

`stripSoftFlowClose` (em `_shared/format-reply.ts`) tira o "Se tiver qualquer
outra dúvida, é só me chamar" para o fechamento do passo ocupar o lugar — ele é
mais útil. Pergunta de verdade no fim do texto é preservada, e textos de handoff
("vou chamar alguém do time") não recebem fechamento.

Três guardas evitam mandar a mesma coisa duas vezes:

1. Quando o FAQ tem áudio, o texto não é enviado (regra de não repetir o áudio
   por escrito). Só nesse caso o fechamento sai como mensagem própria — a
   condição exige `audioEmitted`, que implica texto suprimido.
2. `reemitStepButtons` manda apenas "Quando quiser, escolha uma opção:" com os
   botões; nunca repete o `message_text` do passo. Devolve `false` em passo sem
   botão (`a2` pede o valor por texto), e aí o fechamento cobre o CTA.
3. O retorno marca `__inline_sent`, então `_finalize` não acrescenta o reentry
   automático da pergunta do passo.

A resposta do orquestrador de IA passa pelo mesmo fechamento, com `skip` quando
há handoff. Regressão: `_shared/qa-step-close_test.ts`.

## Lead que volta dias depois: cadência B/C → Grupo A

Todo lead entra no Grupo A (`a1` nome → `a2` valor → `a3` economia → `a5b` →
`a6` foto → cadastro). Se para de responder, a cadência assume: **A** (nudge,
sem cota), **B** (reengajamento, `cap_b`) e **C** (recall, `cap_c`). Quando ele
responde a B ou C, `isCadenceReturnContext` devolve ao Grupo A — não existe
fluxo paralelo — e a cadência pausa 72h por `lead_responded`.

O retorno não pode re-perguntar o que já se sabe. `resolveLandingStep` pula todo
passo cujos campos já estão preenchidos (`name` de fonte confiável ou push-name
plausível via `isNameFilledForFlowSkip`, `electricity_bill_value ≥ 100`, `cpf`,
`phone_whatsapp`), limitado a 5 saltos com `visited` set.
`name_source` de `cadence`/`whatsapp_profile` **não** conta como
confiável para *saudação* ("Oi Nome") — ver `safeFirstNameForAddress`. Para
**avançar o funil**, push-name plausível (`isUsableCustomerName`) pula o a1 via
`isNameFilledForFlowSkip`: o lead vai direto ao valor/simulação sem ficar preso
quando manda saudação ou off-topic ("Isso é um teste") — caso Viviane 11971073983.

Valor informado no próprio turno do retorno é gravado antes do motor rodar
(`cadence_typed_bill`), então o `a2` é pulado e o lead cai direto na simulação.
Faixa de botão (200/500/800) grava a estimativa da faixa — o COLD_1 promete
"apenas com a faixa" — e também pula o `a2`. Valor preciso antigo nunca é
substituído por estimativa de faixa (`mergeBillValue`). Texto ambíguo ("ok") ou
off-topic com valor já salvo avança mantendo o valor (`known_bill_forward` antes
do FAQ). `looksLikeQuestion` só com `?` ou termos de objeção — não por contagem
de palavras.

No Grupo A, orquestrador de dúvida **nunca** pausa o bot (`ai_handoff_duvidas`):
responde + reconduz ao passo.

Evidência em produção: lead de 12/07 esfriou, recebeu `COLD_2` e em 05/08
respondeu só "150,00". O valor foi gravado, o `a2` pulado e o `a3` emitido com
*"Com base no valor de R$ 150,00"*. Caso Dulce (07/08): respondeu faixa
`R$300 a R$700` após COLD_1 — antes do fix o bot re-pedia o valor no `a2`;
depois grava estimativa ou mantém valor preciso existente e segue ao `a3`.

## Conversa E2E do Grupo A (sem envio real)

Duas formas de rodar a mesma conversa simulada; ambas usam o roteiro único em
`supabase/functions/bot-e2e-runner/scenario-script.ts`.

- Edge `bot-e2e-runner` (precisa de deploy + JWT admin).
- `scripts/e2e-grupo-a-local.ts` roda da máquina local contra o `whapi-webhook`
  já publicado — `verify_jwt = false` permite a chamada com a apikey anon.

Nada sai no WhatsApp: telefone na faixa `5500000…` faz `isTestPhone` trocar o
sender real pelo `mockSender`. O lead sandbox e a linha de `bot_test_runs` são
criados por SQL administrativo (RLS bloqueia o JWT do consultor) e passados em
`E2E_RUN_ID` / `E2E_CUSTOMER_ID` / `E2E_PHONE`. Remova o lead ao fim da bateria.

O roteiro traduz `flow:<uuid>` para `step_key` via `loadStepIndex` antes de
decidir a resposta. Sem isso nenhum branch casa e o lead simulado responde o
default para tudo — a suíte "roda" sem testar nada. O check *Roteiro cobriu os
passos do fluxo* existe para essa defasagem falhar de forma explícita quando
alguém renomear passos no construtor.

Respostas de passo com botão usam o número do gatilho (`"1"`, `"2"`, `"3"`),
que está em `trigger_phrases` junto do id — serve para Whapi (botão) e para
Evolution (opção numérica).

## Aviso boleto chegou → iGreen Club

- Config editável: `boleto_notify_config` (hora BRT, textos) + toggle
  `igreen_automation_settings.auto_wa_boleto_chegou` (default OFF).
- Cron horário `igreen-boleto-notify-hourly` → edge `igreen-boleto-notify`.
  Na hora configurada dispara `sync-igreen-customers` com `mode=sync_boletos`
  (exceção ao bloqueio Evomi do sync full).
- Boleto novo → fila `customer_auto_message_log` (`boleto_chegou:{mes}`).
  Boleto que chega já quitado não entra na fila e, se entrou, o dispatcher
  marca `skipped_pago` (`isBoletoStatusPago`).
- Pacote Zap (toggles): `send_audio` / `send_text` (áudio e/ou texto);
  `button_enabled` opt-in do botão “Receber boleto” (arquivo). Links
  **Android/iOS do app Club sempre** em mensagem própria. Sem a palavra “PDF”.
- Acesso ao Club vai pelo **e-mail do cadastro** (`customers.email`), nunca
  pelo link com o id. Sem e-mail, a mensagem só orienta a entrar com o e-mail
  do cadastro. Var do texto: `{{email_acesso}}`.
- Helper: `_shared/boleto-notify.ts`. UI: Automações iGreen.

## Validação e implantação

- Front: `npm run typecheck` e `npx vitest run`.
- Edge Functions: `deno check` e `deno test`.
- Produção: push na `main`, CI verde no mesmo SHA e workflow manual
  `Deploy Edge Functions`.
- Banco: migrations versionadas em `supabase/migrations/`.
- Segredos de produção ficam no GitHub/Supabase; nenhum valor secreto é
  versionado.
