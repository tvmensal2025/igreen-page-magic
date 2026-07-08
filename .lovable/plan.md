## Objetivo

Quando o anúncio for aprovado pela Meta (campanha entra em `ACTIVE`), avisar TODOS os parceiros do rodízio, uma única vez, com uma mensagem no WhatsApp dizendo que a campanha foi aprovada e que a partir de agora eles vão receber uma atualização de métricas **a cada 1 hora** (novo padrão). Também remover a opção de "10 min" da UI e usar 1 hora como padrão em toda a plataforma.

## Mudanças

### 1. Novo padrão de intervalo: 1 hora (tira "10 min")

**Migração SQL** (`rodizio_pools.metrics_broadcast_interval_minutes`):

- `ALTER COLUMN ... SET DEFAULT 60`
- `UPDATE rodizio_pools SET metrics_broadcast_interval_minutes = 60 WHERE metrics_broadcast_interval_minutes = 10` (migra pools existentes que estavam em 10 min para 1 h).

**UI — remover item "A cada 10 min" e trocar default de leitura para 60:**

- `src/components/whatsapp/RodiziosBroadcastPanel.tsx`: remove `<SelectItem value="10">`; troca `?? 10` por `?? 60`.
- `src/components/admin/ads/CampaignRodizioLeadsDialog.tsx`: remove `<SelectItem value="10">`; troca os dois `?? 10` por `?? 60`; troca `useState<number>(10)` por `useState<number>(60)`.

**Edge function** `supabase/functions/rodizio-metrics-broadcast/index.ts`:

- Troca `Number(pool.metrics_broadcast_interval_minutes ?? 10)` por `?? 60`.
- Atualiza os comentários do topo (`Roda a cada 10 min…`, `0=off, 10/30/60/120/240`) para refletir que o novo mínimo válido é 30 min e o padrão é 60.
- Mantém o cron rodando na cadência atual (o dedup por slot já garante 1× por hora quando `intervalMin = 60`).

### 2. Mensagem "Campanha aprovada" — envio único por pool

Adicionar coluna de controle em `rodizio_pools`:

```sql
ALTER TABLE public.rodizio_pools
  ADD COLUMN IF NOT EXISTS approval_notified_at timestamptz;
```

(sem novas policies — a tabela já é acessada via `service_role` pela edge function).

Em `rodizio-metrics-broadcast/index.ts`, antes do envio normal de métricas de cada pool:

1. Buscar `approval_notified_at` no `select` da pool.
2. Se `approval_notified_at IS NULL` e a campanha estiver `ACTIVE` na Meta (usa o `effective_status` já disponível via `fetchLiveMetrics`, ou faz uma chamada leve a `/{fb_campaign_id}?fields=effective_status`), enviar para cada parceiro elegível a mensagem de aprovação (novo helper `formatCampaignApprovedMessage` em `_shared/rodizio-metrics-format.ts`):
  ```
   ✅ *Campanha aprovada pela Meta!*
   🎯 {nome da campanha}

   A partir de agora você vai receber uma atualização
   com as métricas ao vivo *a cada 1 hora*.

   Bons Leads ! 🚀
  ```
3. Marcar `approval_notified_at = now()` na pool (idempotente — nunca reenvia).
4. Nesse mesmo tick, pular o disparo normal de métricas (evita 2 mensagens seguidas). O próximo slot já manda o card de métricas.

Dedup adicional por parceiro via `outbound_message_log` com chave `rodizio_approved:{partner_id}:{camp.id}` para blindar contra corrida entre invocações do cron.

### 3. Fora de escopo

- Não muda a lógica do `facebook-create-campaign` (aprovação/publicação inicial) nem o `facebook-campaign-status`.
- Não altera texto do card de métricas em si (`formatRodizioMetricsMessage`) — apenas a nota de rodapé "Próxima atualização em ~1 hora" já aparece automaticamente porque usa `intervalMinutes`.

## Detalhes técnicos

- Cron do `rodizio-metrics-broadcast` (a cada 10 min) permanece; apenas a cadência efetiva por pool muda (slot = `floor(minutes/60)`).
- `approval_notified_at` só é setado após o envio bem-sucedido a pelo menos 1 parceiro elegível — evita "queimar" a notificação em pools sem parceiros conectados.
- Se o usuário tinha manualmente escolhido `10` no seletor, a migração o promove a `60`. Caso ele queira ficar em 30 min, continua podendo escolher pelo seletor.
- Nenhum novo secret, nenhuma mudança em RLS ou GRANTs.

## Arquivos alterados

- `supabase/migrations/<novo>.sql` (default 60 + update linhas 10→60 + coluna `approval_notified_at`)
- `supabase/functions/rodizio-metrics-broadcast/index.ts`
- `supabase/functions/_shared/rodizio-metrics-format.ts`
- `src/components/whatsapp/RodiziosBroadcastPanel.tsx`
- `src/components/admin/ads/CampaignRodizioLeadsDialog.tsx`