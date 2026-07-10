-- Nunca misturar distribuição manual / fallback de pool com leads de campanha Meta.
--
-- Remove source_campaign_id + lead_source=meta_ads de customers SEM prova Meta
-- (source_ad_id / ctwa_clid / source_ctwa_clid). Mantém referral_partner_id
-- (distribuição manual continua válida; só deixa de inflar métricas de anúncio).
--
-- Também anota campaign_match_log de methods fracos para auditoria.

COMMENT ON COLUMN public.customers.source_campaign_id IS
  'Campanha Meta atribuída. Para métricas/contagens de anúncio, exigir também prova: source_ad_id OU ctwa_clid OU source_ctwa_clid. Sem prova = distribuição/heurística, não contar como lead de campanha.';

-- Snapshot: quantos serão limpos (visível no log da migration via NOTICE)
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
  FROM public.customers c
  WHERE c.source_campaign_id IS NOT NULL
    AND c.source_ad_id IS NULL
    AND coalesce(c.ctwa_clid, '') = ''
    AND coalesce(c.source_ctwa_clid, '') = '';
  RAISE NOTICE 'unmix_manual_from_meta_campaign: customers a limpar = %', n;
END $$;

UPDATE public.customers c
SET
  source_campaign_id = NULL,
  lead_source = CASE
    WHEN c.lead_source #>> '{}' = 'meta_ads' THEN NULL
    ELSE c.lead_source
  END,
  updated_at = now()
WHERE c.source_campaign_id IS NOT NULL
  AND c.source_ad_id IS NULL
  AND coalesce(c.ctwa_clid, '') = ''
  AND coalesce(c.source_ctwa_clid, '') = '';

-- Marca logs fracos (não apaga — auditoria). message_sample ganha prefixo se ainda não tiver.
UPDATE public.campaign_match_log
SET message_sample = left(
  '[unmixed_not_meta_proof] ' || coalesce(message_sample, ''),
  500
)
WHERE method IN ('manual_backfill', 'fallback_single_active_pool', 'meta_ctwa_phrase_unmatched')
  AND coalesce(message_sample, '') NOT LIKE '[unmixed_not_meta_proof]%';

-- Se o reconcile CRM tinha inflado facebook_metrics_daily.leads acima
-- do que a Meta reportou, volta para o valor Meta (meta_lead_actions / meta_conversations).
UPDATE public.facebook_metrics_daily m
SET
  leads = GREATEST(
    coalesce(m.meta_lead_actions, 0),
    coalesce(m.meta_conversations, 0),
    coalesce(m.messaging_conversations_started, 0)
  ),
  updated_at = now()
WHERE m.leads > GREATEST(
  coalesce(m.meta_lead_actions, 0),
  coalesce(m.meta_conversations, 0),
  coalesce(m.messaging_conversations_started, 0)
);
