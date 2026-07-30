-- Portal parceiro: cycle_leads com nome + telefone + stage (token secreto).
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
  v_cycle jsonb;
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

  -- Leads do parceiro no ciclo A/B/C (PII liberada só via portal_token).
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'name_source', c.name_source,
    'phone_whatsapp', c.phone_whatsapp,
    'status', c.status,
    'conversation_step', c.conversation_step,
    'portal_submitted_at', c.portal_submitted_at,
    'do_not_contact', coalesce(c.do_not_contact, false),
    'customer_origin', c.customer_origin,
    'is_converted', coalesce(c.is_converted, false),
    'stage', lcs.stage,
    'paused_reason', lcs.paused_reason,
    'next_action_at', lcs.next_action_at,
    'active_cadence', (lcs.next_action_at IS NOT NULL)
  ) ORDER BY coalesce(lcs.updated_at, c.updated_at) DESC NULLS LAST), '[]'::jsonb)
  INTO v_cycle
  FROM customers c
  LEFT JOIN lead_cadence_state lcs ON lcs.customer_id = c.id
  WHERE c.referral_partner_id = v_partner.id
    AND coalesce(c.do_not_contact, false) = false
    AND coalesce(c.status, '') NOT IN (
      'approved', 'registered_igreen', 'cadastro_concluido', 'rejected', 'contato_incompleto'
    );

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
    'leads', v_leads,
    'cycle_leads', v_cycle
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_partner_banner_portal(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_banner_portal(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_partner_banner_portal(text) IS
  'Portal /p/{token}: banners + cycle_leads (nome/fone/stage). Token secreto do parceiro.';
