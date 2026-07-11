## Diagnóstico — por que SANDRA foi para o Francisco em vez do Rodrigo

O lead **SANDRA (55 38 98447681)** entrou em `2026-07-11 08:37`, vindo do anúncio **"Aumento em cima de aumento? Ative seu benefício"**, `ad_id = 120246304492060645`.

Esse `ad_id` pertence à campanha **"Brasilândia de Minas" (Rodrigo Horácio)** — confirmado no banco (`facebook_campaigns.fb_ad_ids`). Por isso o Meta contabilizou +1 conversa no anúncio do Rodrigo.

**Mas o sistema atribuiu para o Francisco.** Motivo:

1. O Whapi enviou o referral no caminho `**messages[0].context.ad.source.id**` e `**messages[0].context.ad.ctwa**` — formato Whapi.
2. Nosso `_shared/lead-attribution.ts` só lê os formatos antigos: `rawMessage.referral`, `context.referred_product`, `context.referral`, `context.ad_reply`. **Nunca lê `context.ad`.**
3. Resultado: `source_ad_id`, `source_ctwa_clid` e `source_referral` ficaram **NULL** em `customers`.
4. Sem esses IDs, o resolver caiu na **estratégia 2 (Jaccard)** — texto "Olá! Posso ter mais informações sobre isso?" não bate com nenhum `initial_message` — e depois na **fallback rotation**, que escolheu a campanha Jaraguá (Francisco) porque tem mais atividade recente e mesmo UF (MG).
5. `ctwa_referral_probe_log` confirma: `matched_paths: []` e `extracted: {source_ad_id: null, ctwa_clid: null}` — mas o payload cru mostra tudo lá dentro de `context.ad`.

## Correção proposta

### 1. Ensinar o parser a ler o shape do Whapi (`context.ad.*`)

Em `supabase/functions/_shared/lead-attribution.ts`, na Estratégia 1, adicionar leitura de:

- `rawMessage.context.ad.source.id` → `ad_id`
- `rawMessage.context.ad.source.url` → `source_url` (também passa pelo `extractAdIdFromSourceUrl`)
- `rawMessage.context.ad.ctwa` → `ctwa_clid`
- `rawMessage.context.ad.source.type` → `source_type`
- Preservar o objeto inteiro `context.ad` em `source_referral` quando for esse formato.

### 2. Atualizar o probe recursivo

Em `supabase/functions/_shared/ctwa-referral-probe.ts`:

- Detectar padrão contextual: quando a chave `ad` contém sub-objeto `source` com `id`, tratar esse `id` como `source_ad_id` e `url` como `source_url`.
- Detectar chave `ctwa` (nome usado pelo Whapi, sem sufixo `_clid`) como `ctwa_clid`.
- Assim o probe futuro registra `matched_paths` corretos e não perdemos mais leads.

### 3. Reatribuir SANDRA agora

Rodar UPDATE manual:

- `source_ad_id = '120246304492060645'`
- `source_campaign_id = 'c2530550-…'` (Brasilândia)
- `referral_partner_id = 4384080b-…` (Rodrigo Horácio)
- `tracking_protocol` recalculado com prefixo do Rodrigo
- Log em `campaign_match_log` com `method = 'retro_ad_id_fix'`
- Reverter contador Francisco (`lead_count -= 1`) e incrementar Rodrigo (`lead_count += 1`)
- **NÃO** notificar Rodrigo agora — kill switch ainda está OFF; ficar como registro. ( notifique o rodrigo sim )

### 4. Rodar retro-atribuição nos últimos 30 dias

Chamar `admin-recompute-lead-attribution` com `dry_run=false` — agora que o extrator lê `context.ad.source.id`, ele vai casar leads antigos que caíram no fallback errado. Retorno mostra quantos foram corrigidos e quais.

### 5. Teste de regressão

Adicionar teste unitário com o payload real da SANDRA (arquivo fixture) validando que `attributeLeadSource` retorna:

- `method: "ctwa_referral"`
- `source_campaign_id: c2530550-…`
- `source_ctwa_clid: AfiWA0LZ…`

## Detalhes técnicos

**Arquivos a editar:**

- `supabase/functions/_shared/lead-attribution.ts` — nova leitura de `context.ad`
- `supabase/functions/_shared/ctwa-referral-probe.ts` — reconhecer `ad.source.id` / `ad.ctwa`
- `supabase/functions/_shared/__tests__/lead-attribution_test.ts` (novo) — fixture SANDRA

**Migração:** nenhuma. Apenas UPDATE manual pontual em `customers`, `rodizio_pool_members`, `campaign_match_log` para consertar SANDRA e rodar a retro-atribuição.

**Kill switch:** permanece OFF; nenhuma mensagem sai para clientes. O parceiro Rodrigo **não** será notificado agora — só passará a receber quando você ligar `notify_partner_leads_batch` no `/admin/agendamentos-central`.

**Impacto no motor de cadência:** zero por enquanto (tudo desligado). Quando ligar, novos leads dessa campanha caem direto no pool do Rodrigo.