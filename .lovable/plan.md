# Corrigir métricas do rodízio + intervalo configurável por pool

Dois problemas para resolver:

1. **Mensagem foi enviada com métricas zeradas** — a função lia `facebook_metrics_daily`, que só é populada 1x/dia pelo cron `facebook-metrics-sync`. Para a campanha nova do Jaraguá essa tabela tinha 0 linhas, então tudo saiu R$ 0,00 / 0 alcance. Isso passa impressão errada e não pode acontecer.

2. **Intervalo fixo em 10 min** — você quer poder escolher 10min, 30min, 1h, 2h ou qualquer período por rodízio.

## O que muda

### A) Métricas em tempo real (via Meta Graph Insights)
- A função `rodizio-metrics-broadcast` passa a buscar métricas **ao vivo na Meta API**, não da tabela local
- Usa `loadCampaignConnection` + `fbFetch` (helpers já existentes em `_shared/fb-graph.ts`, mesmos usados por `facebook-campaign-status`)
- Endpoints:
  - `/{fb_campaign_id}/insights?fields=spend,impressions,reach,actions&date_preset=today`
  - Mesmo endpoint com `date_preset=last_7d` para o histórico
  - `actions` traz `onsite_conversion.messaging_conversation_started_7d` → número REAL de conversas iniciadas pelo CTWA (mesmo antes de virar lead no CRM)
- Leads reais: `count(customers.id where source_campaign_id=X)` — mantém, mas soma junto com `messaging_conversations_started` da Meta (mostra os 2: "Conversas iniciadas: N (Meta) · Leads no CRM: M")
- Cache: guarda o resultado em memória por 5 min para não bater na Meta a cada parceiro do mesmo pool

### B) Guard "nunca enviar vazio"
Se **todos** os indicadores da Meta vierem zerados E o gasto for 0 E a campanha tem menos de 30 min de vida → **não envia** (marca `skipped: cold_start` no retorno). Isso evita o "quase-roubando" que aconteceu.

Se a Meta API falhar (erro/timeout), envia mensagem alternativa:
> ⚠️ Não consegui puxar as métricas ao vivo agora. Vou tentar de novo na próxima janela.

Nunca envia número zero como se fosse verdade sem checar antes.

### C) Intervalo configurável por rodízio
- Nova coluna: `rodizio_pools.metrics_broadcast_interval_minutes int default 10` (valores permitidos: 0, 10, 30, 60, 120, 240 — 0 = desligado)
- Cron continua rodando a cada 10 min, mas dentro da função:
  ```
  const slotMin = Math.floor(nowMinutes / interval) * interval
  if (last_sent_slot === slotMin) skip
  ```
  Ou seja, pool com intervalo de 60 min só envia quando o minuto atual é múltiplo de 60.
- Dedup existente (`outbound_message_log.idempotency_key`) passa a usar o `slotMin` do próprio pool no lugar do slot fixo de 10 min

### D) UI: seletor de frequência
No card do rodízio da campanha (dialog `CampaignRodizioLeadsDialog`), adicionar um `Select`:

```
🔔 Frequência das atualizações no WhatsApp:
[ Desligado | 10 min | 30 min | 1 hora | 2 horas | 4 horas ]  (padrão: 10 min)
```

Salva direto em `rodizio_pools.metrics_broadcast_interval_minutes`.

## Arquivos

**Editar**
- `supabase/functions/rodizio-metrics-broadcast/index.ts` — Meta Insights ao vivo, guard de vazio, respeita `metrics_broadcast_interval_minutes`
- `supabase/functions/_shared/rodizio-metrics-format.ts` — nova linha "Conversas iniciadas (Meta)"; texto de fallback para erro
- `src/components/admin/ads/CampaignRodizioLeadsDialog.tsx` (ou onde exibimos o card do rodízio) — `<Select>` de frequência

**Migration**
- `ALTER TABLE rodizio_pools ADD COLUMN metrics_broadcast_interval_minutes int NOT NULL DEFAULT 10 CHECK (metrics_broadcast_interval_minutes IN (0,10,30,60,120,240));`

## Formato novo da mensagem

```
📊 *RODÍZIO — Atualização*
━━━━━━━━━━━━━━━━━━
🎯 Jaraguá · iGreen
🕐 08/07 15:20

💰 *Hoje (ao vivo)*
├ Investido: R$ 7,10
├ Alcance: 479 pessoas
├ Impressões: 512
├ Conversas iniciadas: 0
└ Leads no CRM: 0

📆 *Últimos 7 dias*
├ Investido: R$ 7,10
└ Leads: 0

👥 *Você no rodízio*
├ Posição: 2º de 5
└ Seus leads: 0

😴 Campanha rodando, ainda sem conversas. Meta leva 24–48h para calibrar.

_Próxima atualização em ~10 min_
```

Dados 100% vindos da Meta em tempo real, mais os leads reais do CRM — sem depender de sync diário.
