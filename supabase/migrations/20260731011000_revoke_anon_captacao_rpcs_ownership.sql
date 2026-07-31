-- P1 residual: fecha IDOR de leitura em Captação.
-- 1) REVOKE EXECUTE de anon/PUBLIC (UI usa sessão authenticated).
-- 2) Ownership no corpo: só o próprio consultor ou super_admin;
--    service_role (auth.uid() null) continua liberado para workers.
-- NÃO apaga as funções — só endurece grants + gate.

CREATE OR REPLACE FUNCTION public.count_captured_leads_by_channel(p_consultant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() IS DISTINCT FROM p_consultant_id
     AND NOT COALESCE(public.is_super_admin(auth.uid()), false)
  THEN
    RAISE EXCEPTION 'not_authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_object_agg(channel, cnt)
      FROM (
        SELECT channel::text AS channel, count(*)::int AS cnt
        FROM public.captured_leads
        WHERE consultant_id = p_consultant_id
        GROUP BY channel
      ) t
    ),
    '{}'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.filter_dispatched_phones(
  p_consultant_id uuid,
  p_phones text[]
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() IS DISTINCT FROM p_consultant_id
     AND NOT COALESCE(public.is_super_admin(auth.uid()), false)
  THEN
    RAISE EXCEPTION 'not_authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(
    (
      SELECT array_agg(DISTINCT d.norm)
      FROM (
        SELECT right(regexp_replace(COALESCE(t.phone, ''), '\D', '', 'g'), 11) AS norm
        FROM public.bulk_campaign_targets t
        JOIN public.bulk_campaigns c ON c.id = t.campaign_id
        WHERE c.consultant_id = p_consultant_id
          AND t.status IN ('sent', 'sending')
          AND length(regexp_replace(COALESCE(t.phone, ''), '\D', '', 'g')) >= 8
      ) d
      WHERE d.norm = ANY (
        SELECT right(regexp_replace(COALESCE(x, ''), '\D', '', 'g'), 11)
        FROM unnest(COALESCE(p_phones, ARRAY[]::text[])) AS x
        WHERE length(regexp_replace(COALESCE(x, ''), '\D', '', 'g')) >= 8
      )
    ),
    ARRAY[]::text[]
  );
END;
$$;

REVOKE ALL ON FUNCTION public.count_captured_leads_by_channel(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.count_captured_leads_by_channel(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.count_captured_leads_by_channel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_captured_leads_by_channel(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.filter_dispatched_phones(uuid, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.filter_dispatched_phones(uuid, text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.filter_dispatched_phones(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.filter_dispatched_phones(uuid, text[]) TO service_role;

COMMENT ON FUNCTION public.count_captured_leads_by_channel(uuid) IS
  'Contagem GROUP BY channel de captured_leads do consultor (UI Captação). authenticated=own/super; service_role ok; anon revogado.';
COMMENT ON FUNCTION public.filter_dispatched_phones(uuid, text[]) IS
  'Interseção de telefones já sent/sending com a lista da página. authenticated=own/super; service_role ok; anon revogado.';
