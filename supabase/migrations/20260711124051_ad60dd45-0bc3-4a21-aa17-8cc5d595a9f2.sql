
UPDATE public.customers
SET
  referral_partner_id = '4384080b-e777-484d-83e0-364f8385546e',
  source_campaign_id = 'c2530550-8281-468f-bb6b-16127ff2420d',
  source_ad_id = '120246304492060645',
  source_ctwa_clid = 'AfiWA0LZIEeemu6l_yn2FJSH9hpzVUD5eaz_P8TJhgE_QJtDddGjCdUut2oOWxYHdLhzk2mJnRdXGeg77-OQFZ3w47ZDJxmnjNWhi2Od2NUENVzBNDYy2H8S5ZVbqSZ1CvWF_DIjwA',
  lead_source = '"meta_ads"'::jsonb,
  needs_manual_review = false,
  manual_review_reason = NULL,
  tracking_protocol = '187151-260711-0001',
  referral_detected_at = now()
WHERE id = '27129c6c-3e5d-4b5b-9049-5451fda41591';

UPDATE public.rodizio_pool_members
SET lead_count = GREATEST(lead_count - 1, 0)
WHERE pool_id = '677bbfd7-ce58-4218-b823-149197c40bad'
  AND partner_id = '7632bba1-de01-49f1-8f8f-3b28ed469858';

UPDATE public.rodizio_pool_members
SET lead_count = lead_count + 1
WHERE pool_id = 'cfe1b1ef-f468-4ac6-98bb-21181252421c'
  AND partner_id = '4384080b-e777-484d-83e0-364f8385546e';

UPDATE public.referral_partners
SET protocol_seq = GREATEST(protocol_seq, 1)
WHERE id = '4384080b-e777-484d-83e0-364f8385546e';

INSERT INTO public.campaign_match_log (customer_id, campaign_id, method, rodizio_outcome, similarity)
VALUES (
  '27129c6c-3e5d-4b5b-9049-5451fda41591',
  'c2530550-8281-468f-bb6b-16127ff2420d',
  'manual_assignment',
  'reassigned',
  NULL
);
