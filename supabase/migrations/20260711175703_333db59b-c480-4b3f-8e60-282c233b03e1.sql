CREATE OR REPLACE FUNCTION public.enforce_customer_meta_ad_campaign_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_id uuid;
  v_partner_is_member boolean := false;
  v_partner_changed boolean := false;
  v_source_or_campaign_changed boolean := false;
BEGIN
  IF NEW.source_ad_id IS NULL OR btrim(NEW.source_ad_id::text) = '' OR NEW.consultant_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT fc.id
    INTO v_campaign_id
  FROM public.facebook_campaigns fc
  WHERE fc.consultant_id = NEW.consultant_id
    AND fc.fb_ad_ids @> jsonb_build_array(NEW.source_ad_id::text)
  ORDER BY
    CASE fc.status
      WHEN 'active' THEN 0
      WHEN 'pending_review' THEN 1
      WHEN 'paused' THEN 2
      ELSE 3
    END,
    COALESCE(fc.updated_at, fc.created_at) DESC
  LIMIT 1;

  -- Se ainda não temos a campanha cadastrada para esse AD ID, não chuta.
  IF v_campaign_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_partner_changed := TG_OP = 'INSERT' OR OLD.referral_partner_id IS DISTINCT FROM NEW.referral_partner_id;
  v_source_or_campaign_changed := TG_OP = 'INSERT'
    OR OLD.source_ad_id IS DISTINCT FROM NEW.source_ad_id
    OR OLD.source_campaign_id IS DISTINCT FROM NEW.source_campaign_id;

  IF NEW.source_campaign_id IS DISTINCT FROM v_campaign_id THEN
    NEW.source_campaign_id := v_campaign_id;
    IF NEW.lead_source IS NULL THEN
      NEW.lead_source := to_jsonb('meta_ads'::text);
    END IF;
  END IF;

  -- Com AD ID forte, parceiro precisa pertencer à pool ativa da campanha dona.
  IF NEW.referral_partner_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.rodizio_pools p
      JOIN public.rodizio_pool_members m ON m.pool_id = p.id
      WHERE p.campaign_id = v_campaign_id
        AND p.is_active = true
        AND m.partner_id = NEW.referral_partner_id
    ) INTO v_partner_is_member;

    IF NOT v_partner_is_member THEN
      -- Quando o AD ID/campanha chegou depois de uma atribuição antiga por
      -- fallback, limpa o parceiro para permitir recalcular certo.
      IF v_source_or_campaign_changed AND NOT v_partner_changed THEN
        NEW.referral_partner_id := NULL;
        NEW.referral_detected_at := NULL;
      ELSE
        RAISE EXCEPTION 'campaign_ad_id_mismatch: source_ad_id % belongs to campaign %, partner % is not in that campaign pool',
          NEW.source_ad_id, v_campaign_id, NEW.referral_partner_id
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;