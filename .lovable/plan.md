## Diagnóstico das mensagens enviadas

Confirmei no banco por que a mensagem saiu com informação errada:

1. **"Próximo do giro: Rafael" nas 3 mensagens** — Os 6 leads foram criados via SQL sem `source_campaign_id` (todos NULL). No código, quando não há `source_campaign_id` e o parceiro está em vários pools, o `notify-partner-leads-batch` pega `memberships[0]` (ordem indefinida do Postgres). Nesse caso caiu no pool **Jaraguá** (`counter=0`), então `nextIdx = 0 % 3 = 0` → posição 0 = **Rafael** em todas as 3 mensagens. Deveria ter caído em Uberlândia (`counter=5 → 5%3=2 → Abel`), mas como o lead não tem `source_campaign_id`, a função não tem como saber.

2. **"Leads gerados: —"** — as campanhas `Jaraguá` e `Uberlândia` têm `leads_count` NULL em `facebook_campaigns` e não têm nenhuma linha em `facebook_metrics_daily`. A função só olha essas duas fontes → cai no fallback "—".

3. **"Total investido: —"** — mesma causa (sem `facebook_metrics_daily`).

## Correções no `notify-partner-leads-batch/index.ts`

**Regra guia:** nunca enviar dado que possa estar errado. Se não há como calcular com certeza, **omitir a linha** em vez de mostrar "—" ou um valor duvidoso.

### 1. Resolução do pool (evitar pool errado)
- Se `source_campaign_id` do lead é NULL **e** o parceiro está em >1 pool: **não incluir** o bloco "SEU RODÍZIO" na mensagem (posição/próximo do giro ficam de fora). Registrar no `results` que o pool ficou ambíguo.
- Se `source_campaign_id` existe: buscar em `rodizio_pools` pelo `campaign_id`. Se não achar match: também omitir o bloco de rodízio.
- Só mostrar posição/próximo quando o pool foi resolvido sem ambiguidade.

### 2. "Próximo do giro" correto
- Calcular `nextIdx = poolCounter % totalPositions` como hoje, mas **se `nextMember.partner_id === partnerId`** (o próximo seria ele mesmo, o que confunde), trocar para o **subsequente** (`(poolCounter+1) % totalPositions`) e rotular como "Depois de você:".
- Isso resolve o caso em que o parceiro que acabou de receber é justamente o "próximo do giro" — a mensagem deixaria de dizer "Próximo do giro: Rafael" para o próprio Rafael.

### 3. "Leads gerados" com fallback confiável
Ordem de precedência (usa a primeira que retornar valor real, senão omite a linha):
1. `SUM(facebook_metrics_daily.leads)` da campanha.
2. `facebook_campaigns.leads_count`.
3. `SELECT COUNT(*) FROM customers WHERE source_campaign_id = X` (leads realmente capturados pela plataforma para essa campanha).

Se todas as 3 retornarem 0/NULL: **omitir** a linha "🎯 Leads gerados" em vez de mostrar "—".

### 4. "Total investido" com fallback
1. `SUM(facebook_metrics_daily.spend_cents)`.
2. `SUM(ad_spend_daily.spend_cents)` da mesma campanha (se existir).
3. Se nada: **omitir** a linha em vez de "—".

### 5. Bloco "CAMPANHA" — omitir campos sem dado
- `Ativa desde: —` / `Status: —` / `Orçamento/dia: —` → cada linha só entra se o valor real existir. Se nenhum campo da campanha existe (lead sem `source_campaign_id`), mostrar apenas `📢 Lead orgânico / atribuição manual` no lugar do bloco.

### 6. Contador de "Leads recebidos por você"
- Hoje usa `rodizio_pool_members.lead_count` (contador do pool). Trocar para: `SELECT COUNT(*) FROM customers WHERE referral_partner_id = partnerId AND consultant_id = ownerConsultantId` (verdade absoluta), com filtro opcional por pool via `source_campaign_id IN (pool.campaign_id)`.

### 7. Log de auditoria
- Ao enviar, gravar em `campaign_match_log` com `method='partner_notify'`, `payload` contendo o texto final da mensagem, para termos rastreabilidade do que foi enviado a quem.

## Nada muda no fluxo automático
`notify-consultant.ts` e o webhook `lead-intake` continuam iguais. A correção é isolada em `notify-partner-leads-batch/index.ts`. Não vou reenviar as mensagens já enviadas — como o usuário pediu, ficam como estão; a correção vale para as próximas.

## Verificação após deploy
1. Chamar a função em modo `dry_run` (adicionar flag no body que retorna o texto sem enviar) com os mesmos 6 `customer_ids` e conferir manualmente que:
   - Wudysson (Rafael, Jaraguá) → bloco rodízio some (pool ambíguo, sem source_campaign_id) OU aparece com "Depois de você: Francisco".
   - Francisco → "Depois de você: Abel".
   - Abel → "Depois de você: Rafael".
   - Nenhuma linha "—" na mensagem.
2. Só depois, remover a flag e usar para envios reais.

## Arquivos afetados
- `supabase/functions/notify-partner-leads-batch/index.ts` — reescrever seções de resolução de pool, fallback de campanha e montagem do texto; adicionar flag `dry_run`.
