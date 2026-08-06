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

## Validação e implantação

- Front: `npm run typecheck` e `npx vitest run`.
- Edge Functions: `deno check` e `deno test`.
- Produção: push na `main`, CI verde no mesmo SHA e workflow manual
  `Deploy Edge Functions`.
- Banco: migrations versionadas em `supabase/migrations/`.
- Segredos de produção ficam no GitHub/Supabase; nenhum valor secreto é
  versionado.
