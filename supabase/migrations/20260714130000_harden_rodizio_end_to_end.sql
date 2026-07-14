-- Endurece o rodízio sem recriar pools existentes.
-- IMPORTANTE: migration preparada localmente; aplicar em produção requer aprovação.

ALTER TABLE public.rodizio_pools
  ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true;

-- Uma campanha possui uma única pool, ativa ou pausada. Além de preservar o
-- contador, este índice é o arbiter do ON CONFLICT em configure_rodizio_pool.
CREATE UNIQUE INDEX IF NOT EXISTS rodizio_pools_campaign_id_uniq
  ON public.rodizio_pools (campaign_id)
  WHERE campaign_id IS NOT NULL;

UPDATE public.rodizio_pools rp
SET is_active = (
  rp.is_enabled IS TRUE
  AND EXISTS (
    SELECT 1 FROM public.facebook_campaigns fc
    WHERE fc.id = rp.campaign_id AND fc.status = 'active'
  )
), updated_at = now();

ALTER TABLE public.rodizio_pools
  DROP CONSTRAINT IF EXISTS rodizio_pools_counter_nonnegative,
  ADD CONSTRAINT rodizio_pools_counter_nonnegative CHECK (counter >= 0) NOT VALID;
ALTER TABLE public.rodizio_pools VALIDATE CONSTRAINT rodizio_pools_counter_nonnegative;

ALTER TABLE public.rodizio_pool_members
  DROP CONSTRAINT IF EXISTS rodizio_pool_members_position_nonnegative,
  ADD CONSTRAINT rodizio_pool_members_position_nonnegative CHECK (position >= 0) NOT VALID,
  DROP CONSTRAINT IF EXISTS rodizio_pool_members_lead_count_nonnegative,
  ADD CONSTRAINT rodizio_pool_members_lead_count_nonnegative CHECK (lead_count >= 0) NOT VALID;
ALTER TABLE public.rodizio_pool_members
  VALIDATE CONSTRAINT rodizio_pool_members_position_nonnegative;
ALTER TABLE public.rodizio_pool_members
  VALIDATE CONSTRAINT rodizio_pool_members_lead_count_nonnegative;

CREATE TABLE IF NOT EXISTS public.rodizio_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.facebook_campaigns(id) ON DELETE CASCADE,
  pool_id uuid NOT NULL REFERENCES public.rodizio_pools(id) ON DELETE RESTRICT,
  partner_id uuid NOT NULL REFERENCES public.referral_partners(id) ON DELETE RESTRICT,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rodizio_assignments_customer_campaign_uniq UNIQUE (customer_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS rodizio_assignments_campaign_partner_idx
  ON public.rodizio_assignments (campaign_id, partner_id, assigned_at DESC);

ALTER TABLE public.rodizio_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rodizio_assignments_owner_select ON public.rodizio_assignments;
CREATE POLICY rodizio_assignments_owner_select
  ON public.rodizio_assignments FOR SELECT TO authenticated
  USING (consultant_id = auth.uid() OR COALESCE(public.is_super_admin(auth.uid()), false));
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
    campaign_id, consultant_id, label, is_enabled, is_active
  ) VALUES (
    p_campaign_id,
    v_consultant_id,
    left(COALESCE(NULLIF(trim(p_label), ''), 'Rodízio'), 120),
    COALESCE(p_enabled, false),
    COALESCE(p_enabled, false) AND v_campaign_status = 'active'
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

  -- Evita colisão temporária no índice de posição durante a reordenação.
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

REVOKE ALL ON FUNCTION public.configure_rodizio_pool(uuid, boolean, uuid[], text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.configure_rodizio_pool(uuid, boolean, uuid[], text)
  TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.sync_pool_active_with_campaign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.rodizio_pools
       SET is_active = (is_enabled IS TRUE AND NEW.status = 'active'),
           updated_at = now()
     WHERE campaign_id = NEW.id
       AND is_active IS DISTINCT FROM (is_enabled IS TRUE AND NEW.status = 'active');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rodizio_next(p_campaign_id uuid)
RETURNS TABLE(partner_id uuid, "position" integer, pool_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pool_id uuid;
  v_counter bigint;
  v_len integer;
  v_idx integer;
  v_partner_id uuid;
  v_member_position integer;
BEGIN
  UPDATE public.rodizio_pools pool
     SET counter = pool.counter + 1,
         updated_at = now()
   WHERE pool.campaign_id = p_campaign_id
     AND pool.is_enabled IS TRUE
     AND pool.is_active IS TRUE
     AND EXISTS (
       SELECT 1 FROM public.facebook_campaigns fc
       WHERE fc.id = pool.campaign_id
         AND fc.consultant_id = pool.consultant_id
         AND fc.status = 'active'
     )
     AND EXISTS (
       SELECT 1
       FROM public.rodizio_pool_members m
       JOIN public.referral_partners partner ON partner.id = m.partner_id
       WHERE m.pool_id = pool.id
         AND partner.consultant_id = pool.consultant_id
         AND partner.is_active IS TRUE
     )
  RETURNING pool.id, pool.counter INTO v_pool_id, v_counter;

  IF v_pool_id IS NULL THEN RETURN; END IF;

  SELECT count(*)::integer INTO v_len
    FROM public.rodizio_pool_members m
    JOIN public.referral_partners partner ON partner.id = m.partner_id
    JOIN public.rodizio_pools pool ON pool.id = m.pool_id
   WHERE m.pool_id = v_pool_id
     AND partner.consultant_id = pool.consultant_id
     AND partner.is_active IS TRUE;

  IF v_len = 0 THEN RETURN; END IF;
  v_idx := ((v_counter - 1) % v_len)::integer;

  SELECT m.partner_id, m.position
    INTO v_partner_id, v_member_position
    FROM public.rodizio_pool_members m
    JOIN public.referral_partners partner ON partner.id = m.partner_id
    JOIN public.rodizio_pools pool ON pool.id = m.pool_id
   WHERE m.pool_id = v_pool_id
     AND partner.consultant_id = pool.consultant_id
     AND partner.is_active IS TRUE
   ORDER BY m.position, m.created_at NULLS LAST, m.id
   OFFSET v_idx LIMIT 1;

  IF v_partner_id IS NULL THEN RETURN; END IF;

  UPDATE public.rodizio_pool_members
     SET lead_count = lead_count + 1
   WHERE pool_id = v_pool_id AND partner_id = v_partner_id;

  partner_id := v_partner_id;
  "position" := v_member_position;
  pool_id := v_pool_id;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rodizio_assign_lead(
  p_customer_id uuid,
  p_campaign_id uuid
)
RETURNS TABLE(outcome text, partner_id uuid, "position" integer, pool_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_customer_consultant uuid;
  v_customer_campaign uuid;
  v_existing_partner uuid;
  v_campaign_consultant uuid;
  v_campaign_status text;
  v_partner_id uuid;
  v_position integer;
  v_pool_id uuid;
BEGIN
  IF p_customer_id IS NULL OR p_campaign_id IS NULL THEN
    RETURN QUERY SELECT 'customer_missing'::text, NULL::uuid, NULL::integer, NULL::uuid;
    RETURN;
  END IF;

  SELECT c.consultant_id, c.source_campaign_id, c.referral_partner_id
    INTO v_customer_consultant, v_customer_campaign, v_existing_partner
    FROM public.customers c
   WHERE c.id = p_customer_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'customer_missing'::text, NULL::uuid, NULL::integer, NULL::uuid;
    RETURN;
  END IF;

  IF v_uid IS NOT NULL
     AND v_uid <> v_customer_consultant
     AND NOT COALESCE(public.is_super_admin(v_uid), false) THEN
    RAISE EXCEPTION 'forbidden: rodizio_assign_lead' USING ERRCODE = '42501';
  END IF;

  SELECT fc.consultant_id, fc.status
    INTO v_campaign_consultant, v_campaign_status
    FROM public.facebook_campaigns fc
   WHERE fc.id = p_campaign_id;
  IF NOT FOUND OR v_campaign_consultant IS DISTINCT FROM v_customer_consultant THEN
    RETURN QUERY SELECT 'tenant_mismatch'::text, NULL::uuid, NULL::integer, NULL::uuid;
    RETURN;
  END IF;

  IF v_customer_campaign IS NOT NULL AND v_customer_campaign <> p_campaign_id THEN
    RETURN QUERY SELECT 'campaign_conflict'::text, NULL::uuid, NULL::integer, NULL::uuid;
    RETURN;
  END IF;

  IF v_campaign_status <> 'active' THEN
    RETURN QUERY SELECT 'campaign_inactive'::text, NULL::uuid, NULL::integer, NULL::uuid;
    RETURN;
  END IF;

  IF v_existing_partner IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.rodizio_pools pool
      JOIN public.rodizio_pool_members m ON m.pool_id = pool.id
      JOIN public.referral_partners partner ON partner.id = m.partner_id
      WHERE pool.campaign_id = p_campaign_id
        AND pool.consultant_id = v_customer_consultant
        AND pool.is_enabled IS TRUE
        AND m.partner_id = v_existing_partner
        AND partner.consultant_id = v_customer_consultant
    ) THEN
      RETURN QUERY SELECT 'assignment_conflict'::text, v_existing_partner, NULL::integer, NULL::uuid;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'already_assigned'::text, v_existing_partner, NULL::integer, NULL::uuid;
    RETURN;
  END IF;

  -- Fixa a campanha na mesma transação antes de consumir o turno.
  UPDATE public.customers
     SET source_campaign_id = p_campaign_id,
         lead_source = COALESCE(lead_source, '"meta_ads"'::jsonb)
   WHERE id = p_customer_id;

  SELECT n.partner_id, n."position", n.pool_id
    INTO v_partner_id, v_position, v_pool_id
    FROM public.rodizio_next(p_campaign_id) n
   LIMIT 1;
  IF v_partner_id IS NULL THEN
    RETURN QUERY SELECT 'pool_empty'::text, NULL::uuid, NULL::integer, NULL::uuid;
    RETURN;
  END IF;

  UPDATE public.customers
     SET referral_partner_id = v_partner_id,
         referral_detected_at = now(),
         needs_manual_review = false,
         manual_review_reason = NULL
   WHERE id = p_customer_id;

  INSERT INTO public.rodizio_assignments(
    customer_id, campaign_id, pool_id, partner_id, consultant_id
  ) VALUES (
    p_customer_id, p_campaign_id, v_pool_id, v_partner_id, v_customer_consultant
  );

  RETURN QUERY SELECT 'assigned'::text, v_partner_id, v_position, v_pool_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.rodizio_next(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rodizio_next(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.rodizio_assign_lead(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rodizio_assign_lead(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.rodizio_assign_lead(uuid, uuid) IS
  'Atribuição atômica com campanha ativa, isolamento por consultor, vínculo de campanha e ledger imutável.';

DROP TRIGGER IF EXISTS trg_sync_pool_active_with_campaign
  ON public.facebook_campaigns;
DROP TRIGGER IF EXISTS sync_pool_active_with_campaign_trigger
  ON public.facebook_campaigns;
CREATE TRIGGER sync_pool_active_with_campaign_trigger
AFTER UPDATE OF status ON public.facebook_campaigns
FOR EACH ROW
EXECUTE FUNCTION public.sync_pool_active_with_campaign();

-- O método é telemetria extensível; a lista fechada anterior rejeitava eventos
-- atuais como rodizio_assign_lead e campaign_ad_id_mismatch.
ALTER TABLE public.campaign_match_log
  DROP CONSTRAINT IF EXISTS campaign_match_log_method_check;
ALTER TABLE public.campaign_match_log
  ADD CONSTRAINT campaign_match_log_method_check
  CHECK (length(trim(method)) BETWEEN 1 AND 80);

-- Preserva as atribuições já existentes para que as métricas não recomecem do zero.
INSERT INTO public.rodizio_assignments(
  customer_id, campaign_id, pool_id, partner_id, consultant_id, assigned_at
)
SELECT c.id, c.source_campaign_id, pool.id, c.referral_partner_id,
       c.consultant_id, COALESCE(c.referral_detected_at, c.created_at)
FROM public.customers c
JOIN public.facebook_campaigns fc
  ON fc.id = c.source_campaign_id
 AND fc.consultant_id = c.consultant_id
JOIN public.rodizio_pools pool
  ON pool.campaign_id = c.source_campaign_id
 AND pool.consultant_id = c.consultant_id
JOIN public.rodizio_pool_members member
  ON member.pool_id = pool.id
 AND member.partner_id = c.referral_partner_id
JOIN public.referral_partners partner
  ON partner.id = c.referral_partner_id
 AND partner.consultant_id = c.consultant_id
WHERE c.source_campaign_id IS NOT NULL
  AND c.referral_partner_id IS NOT NULL
ON CONFLICT (customer_id, campaign_id) DO NOTHING;

-- Vínculo compare-and-set da origem: duas primeiras mensagens concorrentes
-- nunca conseguem trocar a campanha uma da outra.
CREATE OR REPLACE FUNCTION public.bind_customer_campaign(
  p_customer_id uuid,
  p_campaign_id uuid
)
RETURNS TABLE(outcome text, campaign_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_customer_consultant uuid;
  v_current_campaign uuid;
  v_campaign_consultant uuid;
BEGIN
  IF p_customer_id IS NULL OR p_campaign_id IS NULL THEN
    RETURN QUERY SELECT 'customer_missing'::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT c.consultant_id, c.source_campaign_id
    INTO v_customer_consultant, v_current_campaign
    FROM public.customers c
   WHERE c.id = p_customer_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'customer_missing'::text, NULL::uuid;
    RETURN;
  END IF;

  IF v_uid IS NOT NULL
     AND v_uid <> v_customer_consultant
     AND NOT COALESCE(public.is_super_admin(v_uid), false) THEN
    RAISE EXCEPTION 'forbidden: bind_customer_campaign' USING ERRCODE = '42501';
  END IF;

  SELECT fc.consultant_id
    INTO v_campaign_consultant
    FROM public.facebook_campaigns fc
   WHERE fc.id = p_campaign_id;
  IF NOT FOUND OR v_campaign_consultant IS DISTINCT FROM v_customer_consultant THEN
    RETURN QUERY SELECT 'tenant_mismatch'::text, v_current_campaign;
    RETURN;
  END IF;

  IF v_current_campaign IS NULL THEN
    UPDATE public.customers
       SET source_campaign_id = p_campaign_id,
           lead_source = COALESCE(lead_source, '"meta_ads"'::jsonb)
     WHERE id = p_customer_id;
    RETURN QUERY SELECT 'bound'::text, p_campaign_id;
    RETURN;
  END IF;

  IF v_current_campaign = p_campaign_id THEN
    RETURN QUERY SELECT 'already_bound'::text, v_current_campaign;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'campaign_conflict'::text, v_current_campaign;
END;
$function$;

REVOKE ALL ON FUNCTION public.bind_customer_campaign(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bind_customer_campaign(uuid, uuid)
  TO authenticated, service_role;