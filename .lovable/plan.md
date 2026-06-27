Vou rodar uma auditoria do pipeline `facebook-create-campaign → facebook-sync-metrics → carteira → Performance` e corrigir os 4 problemas que você marcou. Mexo só em edge functions; UI fica como está.

## 1) Capa do vídeo errada (cache servindo thumb antiga)

**Diagnóstico (`facebook-create-campaign` linhas 511–608):**
- `let thumbUrl = body.video.thumb_url || null` — se o wizard NÃO mandar `thumb_url`, cai no `ad_video_library.thumb_url` cacheado pelo `url` do vídeo.
- Se você trocou a capa mas reaproveitou o mesmo vídeo, o cache devolve a thumb ANTIGA e ela é usada no `videoData.image_url` (linha 658).
- Pior: o fallback "auto-resolve thumbnail" só dispara quando `!thumbUrl`, então a thumb cacheada nunca é recalculada.

**Correção:**
- Sempre que `body.video.thumb_url` chegar preenchido, ele tem prioridade absoluta (já tem, ok).
- Quando NÃO chegar, parar de usar `cachedVid.thumb_url`. Em vez disso, sempre pedir `GET /{fb_video_id}/thumbnails` e pegar a `is_preferred` (que é o frame que o Meta gera da capa real do vídeo).
- Persistir essa thumb_url no cache marcando `thumb_source = "meta_preferred"`; se o usuário enviar uma custom no próximo publish, sobrescreve.
- Validar com HEAD que `thumbUrl` retorna 200 antes de mandar pro Meta; se 404/expirada, refaz o fetch.

## 2) Orçamento: gasto diário nunca passar do definido + sem margem extra

**Diagnóstico:**
- Hoje a campanha sobe com `daily_budget` (linha 388) + `spend_cap` calculado por rateio de carteira (linha 256: `Math.max(30000, liquidMetaBudget / activeCount)`), NÃO por `daily × duration_days`.
- O Meta permite `daily_budget` flutuar até **+25 %** num dia (compensa em outros). Isso é o que faz "R$ 30/dia virar R$ 37 num dia".
- O `spend_cap` atual pode ficar bem acima de `daily × duração` (sobra de carteira vira teto), criando margem invisível.

**Correção:**
- Trocar para **`lifetime_budget`** quando `duration_days` for definido: `lifetime_budget = daily_budget × duration_days` + `end_time` exato. Lifetime é teto absoluto: Meta nunca passa disso.
- Travar o pacing: `pacing_type=["standard"]` e remover qualquer aceleração.
- `spend_cap` da campanha = `daily × duration_days` (sem markup, sem rateio de carteira). O rateio anti-prejuízo continua, mas como **piso de saldo exigido**, não como teto inflado.
- `end_time` exato (UTC) baseado em `started_at + duration_days × 86400`. Auto-pause no `facebook-sync-metrics` checa se `now > end_time` e pausa a campanha.
- Se `duration_days` for null (campanha sem prazo), mantém `daily_budget` + `spend_cap = max(30000, daily × 7)` como hoje.

## 3) Cobrança da carteira = gasto Meta + taxa visível

**Diagnóstico (`facebook-sync-metrics` linhas 192–232):**
- Lê `spend` do insights → `deltaSpend = spend - already_debited` → debita `delta × (1 + feePct)`.
- Lógica está correta, mas tem 2 gaps:
  - `synced_to_wallet_cents` é setado para `spend` mesmo quando o `debit_consultant_wallet` falha (linha 244 fora do try). Em falha, o delta nunca mais é recuperado → cobrança a menos.
  - A descrição da `wallet_transactions` não mostra "taxa de plataforma R$ X" separada do gasto Meta.

**Correção:**
- Mover `synced_to_wallet_cents = spend` para DENTRO do `try` do debit, só atualizar quando RPC retornar sucesso.
- Adicionar `metadata.platform_fee_cents` explícito e usar na `description`: `"Meta R$ 12,30 + taxa R$ 2,46 = R$ 14,76"`.
- Reconciliação noturna: nova função `facebook-balance-reconcile-daily` que compara `SUM(facebook_metrics_daily.gross_spend_cents)` × (1+fee) contra `SUM(wallet_transactions.amount_cents)` da campanha e gera um ajuste se divergir > R$ 0,10.

## 4) Performance: spend / impressões / cliques / CTR / CPL / leads

**Diagnóstico:**
- `useAdMetrics` lê `facebook_metrics_daily` corretamente para spend/impr/cliques/CTR.
- `leads` vem de `customers.lead_source='meta_ads'` — pega leads de OUTRAS campanhas do mesmo consultor e dá CPL agregado errado por campanha. O sync já reconcilia `customers_acquired` por `source_campaign_id`, mas o painel não usa esse campo.
- `messaging_conversation_started` tem 6 action_types possíveis (linhas 14–21 do sync). Estão todos somados — ok, mas o `max(leadsDirect, conv)` na hora de persistir mistura sinais e infla.
- Cron de sync roda a cada 30min, mas se a função estoura CPU no loop de breakdown (`for (const c of campaigns)` sem `await` paralelo controlado), atualizações ficam atrasadas → painel mostra zerado.

**Correção:**
- `useAdMetrics`: trocar a soma de leads por `SUM(facebook_metrics_daily.leads)` (já reconciliado por `source_campaign_id` no sync) em vez de contar `customers.lead_source`.
- No sync, persistir 3 colunas distintas: `meta_lead_actions` (cru), `meta_conversations` (cru), `leads` (= max dos dois pós-reconciliação CRM). Hoje o "leads" misturado dá CPL volátil.
- Adicionar `cost_per_lead_cents` calculado SEMPRE como `gross_spend_cents / NULLIF(leads,0)` no upsert (já existe, validar consistência).
- Confirmar via `supabase--analytics_query` que o cron `facebook-sync-metrics` está rodando a cada 30 min e o tempo de execução está < 60s. Se não, paralelizar com `Promise.allSettled` em batches de 5 campanhas.
- Botão "Sincronizar agora" no painel — verificar se já dispara `facebook-sync-metrics` com `consultant_id` no body (já dispara).

## Detalhes técnicos

```text
edge fns alteradas:
  supabase/functions/facebook-create-campaign/index.ts
    - linhas 511–608: thumb sempre via Meta /thumbnails (is_preferred), cache invalidado por hash
    - linhas 200–260: spend_cap = daily × duration_days; quando duration_days, usa lifetime_budget
    - linhas 380–400: adicionar end_time, pacing_type=["standard"], trocar daily_budget→lifetime_budget condicional

  supabase/functions/facebook-sync-metrics/index.ts
    - linhas 192–252: mover synced_to_wallet_cents para dentro do try; metadata.platform_fee_cents
    - linhas 164–253: separar meta_lead_actions / meta_conversations / leads
    - top do loop: paralelizar campanhas em batches de 5 via Promise.allSettled
    - auto-pause: checar end_time vs now() antes de buscar insights

  src/hooks/useAdMetrics.ts
    - leads = SUM(facebook_metrics_daily.leads) em vez de count(customers.lead_source)

migração SQL (schema):
  ALTER TABLE facebook_metrics_daily
    ADD COLUMN IF NOT EXISTS meta_lead_actions int DEFAULT 0,
    ADD COLUMN IF NOT EXISTS meta_conversations int DEFAULT 0,
    ADD COLUMN IF NOT EXISTS platform_fee_cents int DEFAULT 0;
  ALTER TABLE facebook_campaigns
    ADD COLUMN IF NOT EXISTS end_time_utc timestamptz;
  ALTER TABLE ad_video_library
    ADD COLUMN IF NOT EXISTS thumb_source text DEFAULT 'user';

validação (depois do deploy):
  1. supabase--curl_edge_functions /facebook-create-campaign com payload mínimo (video + duration_days=3)
     → conferir no Meta Ads Manager que campanha subiu com lifetime_budget e thumb correta
  2. supabase--edge_function_logs facebook-sync-metrics → ver log "thumb auto-resolved"
  3. supabase--read_query SUM(spend_cents) vs SUM(wallet_transactions.amount_cents) → checar reconciliação
```

## Fora de escopo
- UI da aba Performance fica intocada — só o hook `useAdMetrics` muda fonte de dados.
- Wizard de publicação fica como está — só passo a respeitar `thumb_url` que ele já manda.
