-- Novas pools de rodízio: intervalo de métricas 3h + quiet 21h–09h.
-- UPDATE de pool existente NÃO sobrescreve o intervalo já configurado.

ALTER TABLE public.rodizio_pools
  ALTER COLUMN metrics_broadcast_interval_minutes SET DEFAULT 180;

CREATE OR REPLACE FUNCTION public.configure_rodizio_pool(
  p_campaign_id uuid,
  p_enabled boolean,
  p_partner_ids uuid[],
  p_label text DEFAULT NULL
)
RETURNS TABLE(pool_id uuid, members integer, enabled boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_consultant_id uuid;
  v_campaign_status text;
  v_pool_id uuid;
  v_partner_id uuid;
  v_position integer := 0;
  v_count integer := 0;
  v_requested_count integer := COALESCE(array_length(p_partner_ids, 1), 0);
BEGIN
  SELECT fc.consultant_id, fc.status
    INTO v_consultant_id, v_campaign_status
    FROM public.facebook_campaigns fc
   WHERE fc.id = p_campaign_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_uid IS NOT NULL
     AND v_uid <> v_consultant_id
     AND NOT COALESCE(public.is_super_admin(v_uid), false) THEN
    RAISE EXCEPTION 'forbidden: configure_rodizio_pool' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(p_enabled, false) AND v_requested_count = 0 THEN
    RAISE EXCEPTION 'partner_required' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_enabled, false) AND EXISTS (
    SELECT 1
    FROM unnest(p_partner_ids) requested(id)
    LEFT JOIN public.referral_partners rp
      ON rp.id = requested.id
     AND rp.consultant_id = v_consultant_id
     AND rp.is_active IS TRUE
    WHERE requested.id IS NULL OR rp.id IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid_or_inactive_partner' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_enabled, false)
     AND (SELECT count(DISTINCT id) FROM unnest(p_partner_ids) requested(id)) <> v_requested_count THEN
    RAISE EXCEPTION 'duplicate_partner' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.rodizio_pools (
    campaign_id, consultant_id, label, is_enabled, is_active,
    metrics_broadcast_interval_minutes, metrics_quiet_start_hour, metrics_quiet_end_hour
  ) VALUES (
    p_campaign_id,
    v_consultant_id,
    left(COALESCE(NULLIF(trim(p_label), ''), 'Rodízio'), 120),
    COALESCE(p_enabled, false),
    COALESCE(p_enabled, false) AND v_campaign_status = 'active',
    180,
    21,
    9
  )
  ON CONFLICT (campaign_id) WHERE campaign_id IS NOT NULL
  DO UPDATE SET
    consultant_id = EXCLUDED.consultant_id,
    label = EXCLUDED.label,
    is_enabled = EXCLUDED.is_enabled,
    is_active = EXCLUDED.is_active,
    updated_at = now()
  RETURNING id INTO v_pool_id;

  IF NOT COALESCE(p_enabled, false) THEN
    SELECT count(*)::integer INTO v_count
      FROM public.rodizio_pool_members m
     WHERE m.pool_id = v_pool_id;
    pool_id := v_pool_id;
    members := v_count;
    enabled := false;
    RETURN NEXT;
    RETURN;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.rodizio_requested_members (
    partner_id uuid PRIMARY KEY,
    position integer NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.rodizio_requested_members;

  FOREACH v_partner_id IN ARRAY p_partner_ids LOOP
    INSERT INTO pg_temp.rodizio_requested_members(partner_id, position)
    VALUES (v_partner_id, v_position);
    v_position := v_position + 1;
  END LOOP;

  DELETE FROM public.rodizio_pool_members m
   WHERE m.pool_id = v_pool_id
     AND NOT EXISTS (
       SELECT 1 FROM pg_temp.rodizio_requested_members r
       WHERE r.partner_id = m.partner_id
     );

  UPDATE public.rodizio_pool_members m
     SET position = m.position + 1000000
   WHERE m.pool_id = v_pool_id;

  INSERT INTO public.rodizio_pool_members(pool_id, partner_id, position, lead_count)
  SELECT v_pool_id, r.partner_id, r.position, 0
    FROM pg_temp.rodizio_requested_members r
  ON CONFLICT (pool_id, partner_id)
  DO UPDATE SET position = EXCLUDED.position;

  SELECT count(*)::integer INTO v_count
    FROM public.rodizio_pool_members m
   WHERE m.pool_id = v_pool_id;

  pool_id := v_pool_id;
  members := v_count;
  enabled := true;
  RETURN NEXT;
END;
$function$;
