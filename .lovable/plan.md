## Descoberta

Investiguei o código e os dados. A resposta unânime: **já existe no código o caminho 100% determinístico para diferenciar as campanhas** — mas ele está morto na prática.

### O que o código já sabe fazer (sem tocar em texto de anúncio)

O Meta envia junto de cada mensagem CTWA um objeto `referral` com identificadores únicos por anúncio:

- `referral.source_id` → o **AD ID do Meta** (ex.: `120246304492060645` = Brasilândia; `120246248099900645` etc. = Jaraguá)
- `referral.ctwa_clid` → **click ID único por clique**
- `referral.source_url` → URL do anúncio (contém o ad_id também)

E o banco já está pronto:

- `facebook_campaigns.fb_ad_ids` (JSONB) — populado corretamente:
  - Jaraguá: `[120246248099900645, 120246248100490645, 120246248100890645]`
  - Brasilândia: `[120246304492060645]`
- `facebook_campaigns.tracking_protocol` — populado
- `customers.source_ad_id`, `source_ctwa_clid`, `source_referral` — colunas existem
- Tabela `ctwa_clid_mapping` — pronta pra memoizar clid→campanha

Os webhooks (`evolution-webhook`, `whapi-webhook`) até tentam ler esses campos. **Mas os dados não estão chegando.**

### A prova do problema

Consulta em `customers` dos últimos 30 dias (1.188 leads):

| Campo | Preenchidos |
|---|---|
| `source_ad_id` | **0** |
| `source_ctwa_clid` | **0** |
| `source_referral` | **0** |
| `source_campaign_id` | 2 (só via match de texto) |

Zero. Nenhum lead em 30 dias teve o referral do Meta capturado. Por isso caímos sempre no Jaccard/rodízio/revisão manual — a estrada asfaltada existe, mas ninguém passa por ela.

## Hipóteses do porquê o referral não chega

1. **Path errado de parse na Evolution** — hoje lê `contextInfo.externalAdReply.sourceId`. Versões recentes do Baileys colocam em `message.extendedTextMessage.contextInfo.externalAdReply` ou em `messages[0].message.viewOnceMessage.message.*.contextInfo.externalAdReply`. Se o payload real vier aninhado diferente, o parse retorna `undefined`.
2. **Whapi shape diferente** — hoje lê `rawMsg.referral || rawMsg.context.referral || rawMsg.ad_reply`. Whapi documenta `context.referred_product` e às vezes `referral` só no primeiro evento (`messages.post`), não em eventos subsequentes do mesmo chat.
3. **Referral só vem na PRIMEIRA mensagem do chat** — se o buffer/dedupe agrupa mensagens e a "primeira" processada não é a que contém o referral, perdemos.
4. **Nunca logamos o payload cru** quando o parse falha, então não sabemos qual das três é.

## Plano

### Fase 1 — Diagnóstico (1 arquivo, log estruturado, sem mudar comportamento)

Adicionar em `_shared/ctwa-referral-probe.ts` uma função `probeReferralShape(rawPayload, source)` que:

- Percorre recursivamente o payload procurando por qualquer chave que contenha `referral`, `externalAd`, `ctwa`, `source_id`, `sourceId`, `ad_reply`, `ctwaClid`.
- Se achar → grava em nova tabela `ctwa_referral_probe_log` (payload JSONB, source text, matched_paths text[], created_at) para inspeção.
- Se NÃO achar mas o texto casa com `matchesMetaCtwaPhrase()` (frase-âncora do Meta) → também grava, porque isso confirma que era CTWA e perdemos o referral.

Chamar essa função em 3 pontos: início do evolution-webhook, início do whapi-webhook, dentro do buffer antes do dedupe. Rodar por 24-48h e olhar os payloads reais.

### Fase 2 — Corrigir o parse com base no que o log mostrar

Depois que a probe revelar o shape real, ajustar os parsers em:

- `supabase/functions/evolution-webhook/index.ts` (linhas ~861-894): estender a busca de `externalAdReply` para os caminhos aninhados que o log mostrar. Adicionar fallback recursivo: se não achar no caminho direto, varre a árvore procurando o primeiro `externalAdReply`/`sourceId`.
- `supabase/functions/whapi-webhook/index.ts` (linhas ~843-846): idem, incluindo `context.referred_product`, `ad_reply.source_id`, `referrer.ad_id`.

### Fase 3 — Extrair ad_id da `source_url` como rede de segurança

Mesmo quando `source_id` não vem, o Meta frequentemente manda `source_url` tipo `https://fb.me/xxxxx` ou `https://l.facebook.com/l.php?u=...&ad_id=120246304492060645`. Adicionar em `_shared/campaign-tracking.ts` a função `extractAdIdFromSourceUrl(url)` que faz regex nos padrões conhecidos (`ad_id=`, `/ads/`, `fbclid=` com decode). Se achar, consulta `facebook_campaigns` via `.contains("fb_ad_ids", [id])` — match determinístico.

### Fase 4 — Persistir SEMPRE o payload cru do primeiro evento

Independente de resolver a campanha, gravar `source_referral = payload_bruto` na PRIMEIRA mensagem de todo `customer` novo. Hoje só grava quando conseguimos parsear campos específicos. Assim, mesmo que o parse falhe agora, temos como voltar depois e reprocessar.

### Fase 5 — Nova coluna `customers.source_ad_id` indexada + reprocesso

Rodar um job pontual (edge function `admin-recompute-lead-attribution`) que:

- Lê `customers` dos últimos 30 dias com `source_referral IS NOT NULL` e `source_campaign_id IS NULL`.
- Re-aplica o parser corrigido + `extractAdIdFromSourceUrl`.
- Atribui `source_campaign_id` retroativamente e loga em `campaign_match_log` com `method='retro_referral'`.

### Fase 6 — Escada só é usada quando nenhum sinal Meta veio

Depois que a Fase 2 estiver funcionando, o degrau 3 (protocolo) + os novos degraus 1-3 (source_id, ctwa_clid, ad_id da URL) devem resolver >95% dos leads reais de CTWA. A escada atual (Jaccard, DDD, atividade, rodízio) só roda como último recurso — sem risco de misturar pools, porque só é acionada quando **de fato** não veio nenhum sinal do Meta.

## O que muda em relação ao plano anterior

O plano anterior (fingerprint da frase-âncora) tratava o sintoma. Este trata a **causa**: o Meta já manda a identificação única por anúncio, o banco já está preparado, os parsers já existem — só não estão capturando. Consertar isso resolve **todas** as futuras campanhas do Rafael (e de qualquer consultor) automaticamente, sem depender de escrever textos diferentes nos anúncios.

## Risco

Zero risco de regressão nas Fases 1, 3, 4, 5 (só somam dados). Fase 2 mexe no parse existente — mas o parse atual retorna `undefined` para 100% dos leads, então qualquer coisa melhor do que isso é ganho puro.
