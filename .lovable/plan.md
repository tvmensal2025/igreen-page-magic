# Broadcast de métricas do rodízio a cada 10 min via WhatsApp

Envio automático de um resumo formatado com emojis para cada parceiro que está participando de um rodízio ativo, para eles pararem de perguntar como está a campanha.

## O que vai ser enviado

Uma mensagem WhatsApp por parceiro, a cada 10 min, no formato:

```
📊 *RODÍZIO — Últimas atualizações*
━━━━━━━━━━━━━━━━━━
🎯 Campanha: Jaraguá · iGreen
🕐 12/07 14:30

💰 *Hoje*
├ Gasto: R$ 42,80
├ Alcance: 2.145 pessoas
├ Leads recebidos: 3
└ Custo/lead: R$ 14,26

📆 *Total (7 dias)*
├ Investido: R$ 187,40
└ Leads: 12

👥 *Você no rodízio*
├ Posição na fila: 2º de 5
├ Leads seus (total): 3
└ Próximo lead: em breve 🚀

_Próxima atualização em ~10 min_
```

Emojis específicos por situação:
- 🔥 quando entrou lead nos últimos 10 min
- 😴 quando 0 leads nas últimas 2h ("Campanha rodando, mas ainda sem leads")
- ⚠️ quando campanha pausada/rejeitada
- ✅ quando parceiro recebeu lead novo desde o último envio

## Como vai funcionar

### 1. Nova edge function `rodizio-metrics-broadcast`
- Roda a cada 10 min via `pg_cron` + `pg_net`
- Fluxo:
  1. Busca todas as `rodizio_pools` ativas ligadas a campanhas `status='active'`
  2. Para cada pool, calcula métricas da campanha (hoje + 7 dias) usando `facebook_metrics_daily` + `customers` (com `source_campaign_id`)
  3. Para cada `rodizio_pool_members` → busca `referral_partners.notification_phone` + `lead_count` + `position`
  4. Monta mensagem personalizada e envia via `sendRawToNumber` (Whapi primeiro, Evolution fallback — helper já existe em `_shared/notify-consultant.ts`)
- Só envia entre 08h e 22h BRT (não spammar de madrugada)
- Dedup por `partner_id + campaign_id + slot_10min` via `outbound_message_log.idempotency_key` — se pg_cron dobrar, não envia 2x

### 2. Opt-out por parceiro
- Nova coluna: `referral_partners.rodizio_metrics_enabled boolean default true`
- Botão "Receber atualizações a cada 10 min" no card do parceiro (aba Rodízio da campanha) — liga/desliga
- Parceiro sem `notification_phone` é ignorado (silencioso)

### 3. Agendamento
- SQL manual via tool insert (não migration, por conter URL+anon key):
```sql
select cron.schedule(
  'rodizio-metrics-10min',
  '*/10 8-21 * * *',  -- a cada 10 min, das 08h às 21h BRT (11-00 UTC)
  $$ select net.http_post(
    url:='https://…/functions/v1/rodizio-metrics-broadcast', …
  ); $$
);
```

### 4. Aviso especial "novo lead entrou"
Quando o parceiro recebe um lead entre um envio e outro, na próxima mensagem sobe pro topo:
```
🔥 *VOCÊ RECEBEU 1 LEAD NOVO!*
👤 João Silva — recebido às 14:22
```

## Arquivos

**Novos**
- `supabase/functions/rodizio-metrics-broadcast/index.ts` — a função em si
- `supabase/functions/_shared/rodizio-metrics-format.ts` — montagem da mensagem (testável isolado)

**Editar**
- `_shared/notify-consultant.ts` — exportar `sendRawToNumber` (hoje é interno)
- `src/components/admin/ads/campaign-wizard/RodizioBlock.tsx` — toggle "Receber métricas a cada 10 min" por parceiro
- `src/components/admin/ads/CampaignsList.tsx` (ou onde exibe parceiros do rodízio) — mesmo toggle

**Migration**
- Adicionar `referral_partners.rodizio_metrics_enabled boolean default true`

**SQL via insert tool (não migration)**
- Schedule pg_cron
- Backfill: `UPDATE referral_partners SET rodizio_metrics_enabled = true`

## Detalhes técnicos

- Uso de `facebook_metrics_daily` (já populado pelo cron `facebook-metrics-sync`) para spend/alcance — evita bater no Meta a cada 10 min
- Leads do dia via `count()` em `customers WHERE source_campaign_id = X AND created_at >= today_brt`
- Custo/lead calculado só se `leads_hoje > 0`; caso contrário mostra "—"
- Rate limit: máximo 1 mensagem por parceiro a cada 10 min (garantido pelo idempotency_key = `rodizio_metrics:{partner_id}:{campaign_id}:{floor(unix/600)}`)
- Se todas as campanhas estão pausadas ou não há mudança desde o último envio, a função envia mesmo assim (o parceiro precisa saber que "nada mudou"), mas pula se `status='paused'` explícito e passou mais de 1h sem retomar

## Perguntas antes de implementar

1. **Horário de envio**: 08h–22h BRT ou o rodízio funciona 24/7 e você quer mandar sempre?
2. **Só campanha ou consolidado?** Se o mesmo parceiro está em 3 rodízios diferentes, envio 3 mensagens separadas ou 1 consolidada?
3. **Toggle default ligado ou desligado?** Ligar automático para todos ou parceiro precisa opt-in?
