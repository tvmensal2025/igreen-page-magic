-- Rodízio 100%: atribuição atômica + só parceiros ativos + ordem densa
-- (ignora gaps de position).
--
-- Problemas fechados:
--  1) Corrida no 1º contato: duas msgs chamavam rodizio_next antes do CAS e
--     consumiam 2 turnos. Agora rodizio_assign_lead trava o customer (FOR UPDATE)
--     ANTES de avançar o counter.
--  2) CAS com erro de DB: counter já tinha avançado sem parceiro/sem fila.
--     A atribuição e o counter ficam na mesma transação SQL.
--  3) Parceiro inativo na pool ainda recebia lead.
--  4) Gap em position (membro removido) → partner_id null.
--
-- rodizio_next permanece para caminhos que só precisam do "próximo" (métricas /
-- diagnóstico). Webhooks e chat devem preferir rodizio_assign_lead.

CREATE OR REPLACE FUNCTION public.rodizio_next(p_campaign_id uuid)
RETURNS TABLE(partner_id uuid, "position" integer, pool_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pool_id uuid;
  v_counter bigint;
  v_len int;
  v_idx int;
  v_partner_id uuid;
  v_member_position int;
BEGIN
  -- Avança counter só se houver ≥1 membro ATIVO na pool da campanha viva.
  UPDATE public.rodizio_pools rp
     SET counter = rp.counter + 1,
         updated_at = now()
   WHERE rp.campaign_id = p_campaign_id
     AND rp.is_active = true
     AND EXISTS (
       SELECT 1
       FROM public.facebook_campaigns fc
       WHERE fc.id = rp.campaign_id
         AND fc.status IN ('active', 'pending_review')
     )
     AND EXISTS (
       SELECT 1
       FROM public.rodizio_pool_members m
       JOIN public.referral_partners rp2 ON rp2.id = m.partner_id
       WHERE m.pool_id = rp.id
         AND COALESCE(rp2.is_active, true) = true
     )
  RETURNING rp.id, rp.counter INTO v_pool_id, v_counter;

  IF v_pool_id IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*)::int INTO v_len
    FROM public.rodizio_pool_members m
    JOIN public.referral_partners rp2 ON rp2.id = m.partner_id
   WHERE m.pool_id = v_pool_id
     AND COALESCE(rp2.is_active, true) = true;

  IF v_len = 0 THEN
    RETURN;
  END IF;

  v_idx := ((v_counter - 1) % v_len)::int;

  -- Ordem densa entre ativos: gaps de position não quebram o round-robin.
  SELECT m.partner_id, m.position
    INTO v_partner_id, v_member_position
    FROM public.rodizio_pool_members m
    JOIN public.referral_partners rp2 ON rp2.id = m.partner_id
   WHERE m.pool_id = v_pool_id
     AND COALESCE(rp2.is_active, true) = true
   ORDER BY m.position ASC, m.created_at ASC NULLS LAST, m.id ASC
   OFFSET v_idx
   LIMIT 1;

  IF v_partner_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.rodizio_pool_members m
     SET lead_count = m.lead_count + 1
   WHERE m.pool_id = v_pool_id
     AND m.partner_id = v_partner_id;

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
RETURNS TABLE(
  outcome text,
  partner_id uuid,
  "position" integer,
  pool_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing uuid;
  v_partner_id uuid;
  v_position int;
  v_pool_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  -- Chamada autenticada (portal): só dono do lead ou super admin.
  -- service_role tipicamente tem auth.uid() nulo → passa direto.
  IF v_uid IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = p_customer_id
        AND c.consultant_id = v_uid
    ) AND NOT COALESCE(public.is_super_admin(v_uid), false) THEN
      RAISE EXCEPTION 'forbidden: rodizio_assign_lead'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_customer_id IS NULL OR p_campaign_id IS NULL THEN
    outcome := 'customer_missing';
    partner_id := NULL;
    "position" := NULL;
    pool_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Trava o customer ANTES de consumir turno (fecha corrida do 1º contato).
  SELECT c.referral_partner_id
    INTO v_existing
    FROM public.customers c
   WHERE c.id = p_customer_id
   FOR UPDATE;

  IF NOT FOUND THEN
    outcome := 'customer_missing';
    partner_id := NULL;
    "position" := NULL;
    pool_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_existing IS NOT NULL THEN
    outcome := 'already_assigned';
    partner_id := v_existing;
    "position" := NULL;
    pool_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT n.partner_id, n."position", n.pool_id
    INTO v_partner_id, v_position, v_pool_id
    FROM public.rodizio_next(p_campaign_id) AS n
   LIMIT 1;

  IF v_partner_id IS NULL THEN
    outcome := 'pool_empty';
    partner_id := NULL;
    "position" := NULL;
    pool_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.customers c
     SET referral_partner_id = v_partner_id,
         referral_detected_at = now(),
         needs_manual_review = false,
         manual_review_reason = NULL
   WHERE c.id = p_customer_id
     AND c.referral_partner_id IS NULL;

  IF NOT FOUND THEN
    -- Não deveria ocorrer sob FOR UPDATE; fail-safe.
    outcome := 'already_assigned';
    partner_id := v_partner_id;
    "position" := v_position;
    pool_id := v_pool_id;
    RETURN NEXT;
    RETURN;
  END IF;

  outcome := 'assigned';
  partner_id := v_partner_id;
  "position" := v_position;
  pool_id := v_pool_id;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.rodizio_next(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rodizio_next(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.rodizio_assign_lead(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rodizio_assign_lead(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rodizio_assign_lead(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.rodizio_assign_lead(uuid, uuid) IS
  'Atribui o próximo parceiro ativo da pool da campanha ao customer de forma atômica (FOR UPDATE + rodizio_next). Outcomes: assigned | already_assigned | pool_empty | customer_missing.';
