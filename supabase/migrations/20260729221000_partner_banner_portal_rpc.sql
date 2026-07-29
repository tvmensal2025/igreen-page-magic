-- RPC pública da página do parceiro (/p/{token}) — sem PII de telefone.
CREATE OR REPLACE FUNCTION public.get_partner_banner_portal(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner referral_partners%ROWTYPE;
  v_cons record;
  v_spots jsonb;
  v_scans jsonb;
  v_leads jsonb;
BEGIN
  IF _token IS NULL OR length(btrim(_token)) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  SELECT * INTO v_partner
  FROM referral_partners
  WHERE portal_token = btrim(_token) AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT license, igreen_id INTO v_cons
  FROM consultants WHERE id = v_partner.consultant_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'code', s.code,
    'keyword', s.keyword,
    'is_active', s.is_active
  ) ORDER BY s.created_at), '[]'::jsonb)
  INTO v_spots
  FROM referral_partner_banner_spots s
  WHERE s.partner_id = v_partner.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object('event_target', pe.event_target)), '[]'::jsonb)
  INTO v_scans
  FROM page_events pe
  WHERE pe.consultant_id = v_partner.consultant_id
    AND pe.event_type = 'qr_scan'
    AND (
      pe.event_target = ('partner:' || coalesce(v_partner.short_code, ''))
      OR pe.event_target LIKE ('partner:' || coalesce(v_partner.short_code, '') || ':%')
    );

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'referral_keyword_matched', c.referral_keyword_matched
  )), '[]'::jsonb)
  INTO v_leads
  FROM customers c
  WHERE c.referral_partner_id = v_partner.id
    AND c.referral_keyword_matched IS NOT NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'partner', jsonb_build_object(
      'id', v_partner.id,
      'nome', v_partner.nome,
      'short_code', v_partner.short_code
    ),
    'ref', coalesce(nullif(v_cons.license, ''), v_cons.igreen_id::text),
    'spots', v_spots,
    'scans', v_scans,
    'leads', v_leads
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_partner_banner_portal(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_banner_portal(text) TO anon, authenticated;
