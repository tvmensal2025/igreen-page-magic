## Diagnóstico

Hoje o consultor `rafael-ferreira` tem 2 pools ativas:
- **Jaraguá** → campanha `active` (FB-85533) ✅
- **Uberlândia/Uberaba/BH** → campanha **`paused`** (FB-77735) ❌ mas `rodizio_pools.is_active = true`

Consequências:
1. **Atribuição**: os resolvers (`single-pool-campaign-resolver`, `resolveCampaignByTrackingProtocol`, match por `initial_message`) já filtram por `status in (active, pending_review)` — leads recentes só foram para Jaraguá. Log confirma. Mas a proteção depende do filtro em cada caller e é frágil.
2. **Notificação em lote (`notify-partner-leads-batch`)**: se um customer antigo tiver `source_campaign_id` da pausada, a mensagem enviada ao parceiro mostra bloco de "📢 Campanha" com **status "⏸️ pausada", investido, orçamento e leads da pausada** — dado errado que não deveria sair.
3. **`leads_count` inflado**: contagem `Seus leads totais` soma todos os leads do parceiro sem separar por campanha, misturando fase antiga com fase nova.

## O que muda

### 1. Bloquear rodízio na origem quando campanha está pausada
Em `rodizio-assignment` / caminhos que chegam a `rodizio_next`: adicionar checagem final "campanha alvo está em `active`/`pending_review`?" Se não, tratar como não-elegível e marcar `campaign_paused_ignored` no log.

### 2. Auto-sincronizar `rodizio_pools.is_active` com `facebook_campaigns.status`
- Trigger em `facebook_campaigns` (AFTER UPDATE OF status): quando vai para `paused`/`archived`/`deleted`, `is_active=false` nos pools daquela campanha; quando volta para `active`, `is_active=true`.
- Backfill imediato: pool da Uberlândia → `is_active=false`.

### 3. `notify-partner-leads-batch` — nunca vazar campanha pausada
- Se `campaignStatus !== 'active'` e `!== 'pending_review'`: **omitir todo o bloco `📢 Campanha`** (não mostrar status "pausada" nem valores). O lead ainda pode ser notificado (é do parceiro), mas sem publicidade de dados incorretos.
- `myLeadsCount` passa a ser escopado por **pool ativo** do parceiro (soma dos leads onde `source_campaign_id` pertence a campanha ativa daquele pool), não mais "todos os leads do parceiro".
- `spend_cents` e `leads_count` já vêm por `campaign_id` — mantém, mas só exibe se a campanha estiver ativa.

### 4. UI / mensagem individual de novo lead (`notifyPartnerNewLead`)
Sem campanha na mensagem hoje — sem mudança.

### 5. Sanity backfill
- Log via `campaign_match_log`: nenhum lead das últimas 24h foi para a pausada (só Jaraguá). Nada a corrigir em dados de leads. Apenas desativar o pool órfão.

## Detalhes técnicos

- **Migração**: função `sync_pool_active_with_campaign()` + trigger `AFTER UPDATE OF status ON facebook_campaigns`; backfill `UPDATE rodizio_pools SET is_active=false WHERE campaign_id IN (paused/archived)`.
- **`notify-partner-leads-batch/index.ts`**: adicionar guarda `const isCampaignLive = campaignStatus === 'active' || campaignStatus === 'pending_review'` e envolver todo o bloco `hasCampFields` nela; recalcular `myLeadsCount` filtrando por `source_campaign_id` das campanhas ativas do parceiro.
- **`_shared/rodizio-assignment.ts`** (ou o caller no webhook antes de `rodizio_next`): rejeitar quando campanha está fora de `active/pending_review`.
- **Sem mudança de schema em `customers`**.

## Fora de escopo
- Reabrir a campanha da Uberlândia (decisão do usuário).
- Reprocessar mensagens antigas.
