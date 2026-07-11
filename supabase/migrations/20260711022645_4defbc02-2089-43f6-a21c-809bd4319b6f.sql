
ALTER TABLE public.campaign_match_log DROP CONSTRAINT IF EXISTS campaign_match_log_method_check;
ALTER TABLE public.campaign_match_log ADD CONSTRAINT campaign_match_log_method_check
  CHECK (method = ANY (ARRAY[
    'ad_id','ctwa_clid','exact_message','tsvector','unmatched','cached_campaign',
    'ad_id_or_ctwa_clid','fallback_single_active_pool','meta_ctwa_phrase_unmatched',
    'manual_backfill','short_code','keyword','protocol','rodizio_next',
    'manual_assignment','initial_message',
    'ddd_city_match','recent_strong_activity','fallback_rotation'
  ]));
