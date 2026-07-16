-- Contagem rápida de captured_leads por canal (evita baixar 95k linhas no client).
CREATE OR REPLACE FUNCTION public.count_captured_leads_by_channel(p_consultant_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_object_agg(channel, cnt), '{}'::jsonb)
  FROM (
    SELECT channel::text AS channel, count(*)::int AS cnt
    FROM public.captured_leads
    WHERE consultant_id = p_consultant_id
    GROUP BY channel
  ) t;
$$;

REVOKE ALL ON FUNCTION public.count_captured_leads_by_channel(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_captured_leads_by_channel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_captured_leads_by_channel(uuid) TO service_role;

-- Anti-repetição só para os telefones da página atual (não varre todas as campanhas).
CREATE OR REPLACE FUNCTION public.filter_dispatched_phones(
  p_consultant_id uuid,
  p_phones text[]
)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT d.norm), ARRAY[]::text[])
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
  );
$$;

REVOKE ALL ON FUNCTION public.filter_dispatched_phones(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_dispatched_phones(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.filter_dispatched_phones(uuid, text[]) TO service_role;

COMMENT ON FUNCTION public.count_captured_leads_by_channel(uuid) IS
  'Contagem GROUP BY channel de captured_leads do consultor (UI Captação).';
COMMENT ON FUNCTION public.filter_dispatched_phones(uuid, text[]) IS
  'Interseção de telefones já sent/sending com a lista da página atual.';
