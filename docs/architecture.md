# Arquitetura operacional

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
