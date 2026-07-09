
## Diagnóstico — por que caiu em revisão manual

A lead **Meire Vailant** (customer `3ab5d189…`, consultor Rafael Ferreira) chegou com a frase-âncora do CTWA do Meta, mas **sem nenhum sinal determinístico**:
- `source_ad_id` = NULL (Meta não enviou o AD ID neste clique)
- `source_ctwa_clid` = NULL
- `source_referral` = NULL (nenhum `externalAdReply` no payload)
- Texto da mensagem não bateu com o `initial_message` de nenhuma campanha ativa (as duas campanhas do Rafael começam com "Olá! Quero saber mais sobre a redução…" e "Oi! Gostaria de entender melhor…"; a Meire mandou "Olá, posso ter mais informações sobre isso?", que é a **frase-âncora genérica** do Meta quando o anúncio não pré-preenche o texto)

O sistema fez o certo pela regra atual ("blindagem do rodízio"): sem sinal seguro, **não chuta** — manda pra revisão manual pra não ir pro parceiro errado. Só que o Rafael tem 2 pools ativas simultâneas (Jaraguá e Uberlândia) com **anúncios em veiculação nos mesmos dias e mesma keyword-âncora**, então quando o Meta engole o `ad_id`/`ctwa_clid`, é impossível saber de qual anúncio veio.

## O que fazer agora (uma ação, dois passos)

### 1. Atribuir a Meire manualmente (dado correto)
- `source_campaign_id` = `ce44a165…` (Uberlândia — próxima da vez pelo counter=5, 3 posições → posição 2 = **Abel**)
- `referral_partner_id` = `52df8e31…` (**Abel Oliveira**)
- `lead_source` = `meta_ads` (já está)
- `needs_manual_review` = `false`, `manual_review_reason` = null
- Avançar o counter da pool Uberlândia (5 → 6) e o `lead_count` do Abel (1 → 2), para o rodízio continuar coerente

### 2. Disparar a mensagem bonita ao Abel
Invocar `notify-partner-leads-batch` com `customer_ids: ["3ab5d189-b1bc-4179-a071-7187e64b8a74"]` e `force: true` (a lead já tem `last_partner_notified_at` da mensagem de revisão manual — precisa forçar re-envio).

O texto do Abel vai conter (dados reais confirmados no banco):
- Nome, telefone, cidade
- Campanha: Uberlândia, Uberaba, Belo Horizonte · 2026-07-08 (ativa)
- Rodízio: Você está na posição 3 · Depois de você: Rafael
- Leads gerados / total investido: vindos de `facebook_metrics_daily` (ou omitidos se ausentes — regra vigente)

## Melhoria estrutural (evita repetir o problema)

Aplicar em `supabase/functions/evolution-webhook/index.ts` (e mesmo bloco no `whapi-webhook/index.ts`) uma **4ª tentativa antes** de mandar pra revisão manual:

**Regra:** se a frase-âncora do Meta bateu **E** o consultor tem exatamente uma pool ativa **cujo `initial_message` bate por similaridade Jaccard ≥ 0.4 com o texto recebido**, atribuir a essa campanha (mesmo com match fraco).

Se **mais de uma** pool ativa dá match parcial (caso do Rafael com Jaraguá + Uberlândia), **continua** indo pra revisão manual (regra "não chuta" preservada). A blindagem do rodízio só perdoa quando há candidato ÚNICO — não recria o furo original.

Adicional para reduzir ambiguidade futura:
- Adicionar aviso no admin quando o consultor cria a 2ª campanha com **mesma keyword de abertura** de outra já ativa ("Isso vai forçar leads em revisão manual quando o Meta não mandar o AD ID — considere diferenciar a frase inicial").

## Arquivos afetados

- **Escrita direta no banco** (via ferramenta `supabase--insert`, um `UPDATE` no customer + `UPDATE` no pool + `UPDATE` no member — não é migração de schema):
  - `public.customers` — Meire → Abel/Uberlândia
  - `public.rodizio_pools` — counter Uberlândia 5→6
  - `public.rodizio_pool_members` — lead_count do Abel 1→2
- **Chamada de edge function** `notify-partner-leads-batch` (via `curl_edge_functions`) com `force: true` para enviar a mensagem ao Abel.
- **`supabase/functions/evolution-webhook/index.ts`** e **`supabase/functions/whapi-webhook/index.ts`** — adicionar a 4ª tentativa (similaridade Jaccard com pool única) antes do `matchesMetaCtwaPhrase → markManualReview`.

## Verificação após

1. `SELECT source_campaign_id, referral_partner_id, needs_manual_review FROM customers WHERE id = '3ab5d189…'` → todos preenchidos, review=false.
2. Consultar logs da edge function → 1 mensagem enviada com sucesso para o telefone `5514997927003` (Abel).
3. Não mexer nas mensagens anteriores.
