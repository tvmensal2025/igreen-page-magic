ALTER TABLE public.campaign_match_log
  DROP CONSTRAINT IF EXISTS campaign_match_log_method_check;

ALTER TABLE public.campaign_match_log
  ADD CONSTRAINT campaign_match_log_method_check
  CHECK (method = ANY (ARRAY[
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
    'keyword'::text
  ]));