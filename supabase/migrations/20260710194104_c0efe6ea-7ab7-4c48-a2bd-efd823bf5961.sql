CREATE OR REPLACE FUNCTION public.get_referral_partner_metrics()
RETURNS TABLE(partner_id uuid, partner_nome text, lead_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    rp.id AS partner_id,
    rp.nome AS partner_nome,
    COALESCE(metrics.lead_count, 0)::bigint AS lead_count
  FROM public.referral_partners rp
  LEFT JOIN LATERAL (
    SELECT COUNT(DISTINCT c.id)::bigint AS lead_count
    FROM public.customers c
    WHERE (
      c.referral_partner_id = rp.id
      AND c.consultant_id = rp.consultant_id
    )
    OR (
      COALESCE(c.customer_origin, '') IN ('igreen_sync', 'igreen_extension')
      AND NULLIF(regexp_replace(COALESCE(c.registered_by_igreen_id, ''), '\D', '', 'g'), '') = ANY (
        ARRAY_REMOVE(ARRAY[
          NULLIF(regexp_replace(COALESCE(rp.cli, ''), '\D', '', 'g'), ''),
          NULLIF(regexp_replace(COALESCE(rp.partner_igreen_id, ''), '\D', '', 'g'), '')
        ], NULL)
      )
    )
  ) metrics ON true
  WHERE rp.consultant_id = auth.uid()
    AND rp.is_active = true
  ORDER BY COALESCE(metrics.lead_count, 0) DESC, rp.nome ASC;
$function$;
REVOKE ALL ON FUNCTION public.get_referral_partner_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_referral_partner_metrics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_referral_partner_metrics() TO service_role;