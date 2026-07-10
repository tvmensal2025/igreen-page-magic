-- Amplia methods de campaign_match_log (protocol/rodizio_next eram rejeitados)
-- e backfill seguro de leads Uberlândia já atribuídos sem source_campaign_id.

ALTER TABLE public.campaign_match_log
  DROP CONSTRAINT IF EXISTS campaign_match_log_method_check;

ALTER TABLE public.campaign_match_log
  ADD CONSTRAINT campaign_match_log_method_check CHECK (
    method = ANY (ARRAY[
      'ad_id'::text,
      'ctwa_clid'::text,
      'exact_message'::text,
      'tsvector'::text,
      'unmatched'::text,
      'cached_campaign'::text,
      'ad_id_or_ctwa_clid'::text,
      'fallback_single_active_pool'::text,
      'meta_ctwa_phrase_unmatched'::text,
      'manual_backfill'::text,
      'short_code'::text,
      'keyword'::text,
      'protocol'::text,
      'rodizio_next'::text,
      'manual_assignment'::text,
      'initial_message'::text
    ])
  );

UPDATE public.customers c
SET source_campaign_id = 'ce44a165-d380-4934-8dee-c9e1c9114775',
    lead_source = '"meta_ads"'::jsonb,
    updated_at = now()
FROM public.campaign_match_log l
WHERE l.customer_id = c.id
  AND l.method = 'manual_backfill'
  AND l.message_sample ILIKE '%Uberlândia%'
  AND c.source_campaign_id IS NULL
  AND c.created_at >= '2026-07-08';

-- Leads BH já com parceiro do rodízio Uberlândia, sem source_campaign_id
UPDATE public.customers
SET source_campaign_id = 'ce44a165-d380-4934-8dee-c9e1c9114775',
    lead_source = '"meta_ads"'::jsonb,
    updated_at = now()
WHERE id IN (
  'f68d78ab-5e5c-4166-95ba-274e41a58493',
  'e26bfc76-82ff-49c4-8566-95192e3cff50'
)
AND source_campaign_id IS NULL
AND referral_partner_id IS NOT NULL;

UPDATE public.campaign_match_log
SET campaign_id = 'ce44a165-d380-4934-8dee-c9e1c9114775'
WHERE method = 'manual_backfill'
  AND campaign_id IS NULL
  AND message_sample ILIKE '%Uberlândia%';
