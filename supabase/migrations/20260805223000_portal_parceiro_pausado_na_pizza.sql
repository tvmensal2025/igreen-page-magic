-- Portal do parceiro: lead pausado (handoff humano) CONTINUA na pizza.
-- Pedido 2026-08-05: "mesmo os pausados tem que aparecer na pizza".
-- Antes o RPC excluía `handoff_humano` de cycle_leads e o parceiro via
-- "0 pessoas no ciclo" com lead vivo falando com o consultor.

CREATE OR REPLACE FUNCTION public.get_partner_banner_portal(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_partner referral_partners%ROWTYPE;
  v_cons record;
  v_spots jsonb;
  v_scans jsonb;
  v_leads jsonb;
  v_cycle jsonb;
  v_fora jsonb;
  v_fechamentos bigint := 0;
  v_em_analise bigint := 0;
  v_leads_total bigint := 0;
  v_leituras bigint := 0;
  v_wa_phone text := '';
  v_sa_id text;
  v_cycle_date date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
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

  SELECT c.license, c.igreen_id, c.name, c.phone, c.notification_phone
  INTO v_cons
  FROM consultants c
  WHERE c.id = v_partner.consultant_id;

  SELECT nullif(btrim(s.value), '') INTO v_sa_id
  FROM settings s WHERE s.key = 'superadmin_consultant_id' LIMIT 1;

  IF v_sa_id IS NOT NULL AND v_sa_id = v_partner.consultant_id::text THEN
    SELECT nullif(regexp_replace(coalesce(s.value, ''), '\D', '', 'g'), '')
    INTO v_wa_phone FROM settings s WHERE s.key = 'whapi_connected_phone' LIMIT 1;
  END IF;

  IF v_wa_phone IS NULL OR length(v_wa_phone) < 10 THEN
    SELECT nullif(regexp_replace(coalesce(wi.connected_phone, ''), '\D', '', 'g'), '')
    INTO v_wa_phone
    FROM whatsapp_instances wi
    WHERE wi.consultant_id = v_partner.consultant_id
      AND nullif(btrim(wi.connected_phone), '') IS NOT NULL
      AND lower(coalesce(wi.status, '')) IN ('connected', 'online', 'open')
    ORDER BY wi.updated_at DESC NULLS LAST LIMIT 1;
  END IF;

  IF v_wa_phone IS NULL OR length(v_wa_phone) < 10 THEN
    v_wa_phone := coalesce(nullif(regexp_replace(coalesce(v_cons.phone, ''), '\D', '', 'g'), ''), '');
  END IF;

  v_wa_phone := coalesce(public.normalize_br_wa_phone(v_wa_phone), '');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'code', s.code, 'keyword', s.keyword, 'is_active', s.is_active
  ) ORDER BY s.created_at), '[]'::jsonb)
  INTO v_spots FROM referral_partner_banner_spots s WHERE s.partner_id = v_partner.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object('event_target', pe.event_target)), '[]'::jsonb)
  INTO v_scans FROM page_events pe
  WHERE pe.consultant_id = v_partner.consultant_id AND pe.event_type = 'qr_scan'
    AND (pe.event_target = ('partner:' || coalesce(v_partner.short_code, ''))
      OR pe.event_target LIKE ('partner:' || coalesce(v_partner.short_code, '') || ':%'));

  SELECT count(*)::bigint INTO v_leituras
  FROM (
    SELECT pe.created_at,
           lag(pe.created_at) OVER (PARTITION BY pe.event_target ORDER BY pe.created_at) AS anterior
    FROM page_events pe
    WHERE pe.consultant_id = v_partner.consultant_id
      AND pe.event_type = 'qr_scan'
      AND (pe.event_target = ('partner:' || coalesce(v_partner.short_code, ''))
        OR pe.event_target LIKE ('partner:' || coalesce(v_partner.short_code, '') || ':%'))
  ) t
  WHERE t.anterior IS NULL OR t.created_at - t.anterior > interval '15 seconds';

  SELECT coalesce(jsonb_agg(jsonb_build_object('referral_keyword_matched', c.referral_keyword_matched)), '[]'::jsonb)
  INTO v_leads FROM customers c
  WHERE c.referral_partner_id = v_partner.id AND c.referral_keyword_matched IS NOT NULL
    AND coalesce(c.bot_paused_reason, '') <> 'absorbed_wallet_duplicate';

  SELECT count(*)::bigint INTO v_leads_total FROM customers c
  WHERE c.referral_partner_id = v_partner.id
    AND coalesce(c.bot_paused_reason, '') <> 'absorbed_wallet_duplicate';

  SELECT count(*)::bigint INTO v_fechamentos FROM customers c
  WHERE c.referral_partner_id = v_partner.id
    AND coalesce(c.bot_paused_reason, '') <> 'absorbed_wallet_duplicate'
    AND public.partner_lead_is_closed(
      c.id, c.consultant_id, c.is_converted, c.status, c.pos_venda_stage,
      c.andamento_igreen, c.customer_origin, c.igreen_code, c.cpf, c.portal_submitted_at
    );

  SELECT count(*)::bigint INTO v_em_analise FROM customers c
  WHERE c.referral_partner_id = v_partner.id
    AND coalesce(c.bot_paused_reason, '') <> 'absorbed_wallet_duplicate'
    AND c.portal_submitted_at IS NOT NULL
    AND NOT public.partner_lead_is_closed(
      c.id, c.consultant_id, c.is_converted, c.status, c.pos_venda_stage,
      c.andamento_igreen, c.customer_origin, c.igreen_code, c.cpf, c.portal_submitted_at
    );

  -- cycle_leads: inclui handoff_humano (pausado com o consultor = ainda no ciclo).
  -- Continua fora: DNC, opt-out, admin backlog, telefone inválido, fechado, CRM.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', public.mask_first_name(c.name), 'name_source', c.name_source,
    'phone_whatsapp', public.mask_phone_br(c.phone_whatsapp), 'status', c.status,
    'conversation_step', c.conversation_step, 'portal_submitted_at', c.portal_submitted_at,
    'do_not_contact', coalesce(c.do_not_contact, false), 'customer_origin', c.customer_origin,
    'is_converted', coalesce(c.is_converted, false), 'pos_venda_stage', c.pos_venda_stage,
    'andamento_igreen', c.andamento_igreen, 'pos_venda_recadastro_at', c.pos_venda_recadastro_at,
    'stage', lcs.stage, 'paused_reason', lcs.paused_reason, 'next_action_at', lcs.next_action_at,
    'active_cadence', (lcs.next_action_at IS NOT NULL), 'queue_queue', q.queue, 'queue_step', q.step
  ) ORDER BY coalesce(lcs.updated_at, c.updated_at) DESC NULLS LAST), '[]'::jsonb)
  INTO v_cycle
  FROM customers c
  LEFT JOIN lead_cadence_state lcs ON lcs.customer_id = c.id
  LEFT JOIN LATERAL (
    SELECT drq.queue, drq.step FROM daily_reheat_queue drq
    WHERE drq.customer_id = c.id AND drq.cycle_date = v_cycle_date AND drq.status IN ('planned', 'claimed')
    ORDER BY drq.updated_at DESC NULLS LAST LIMIT 1
  ) q ON true
  WHERE c.referral_partner_id = v_partner.id
    AND coalesce(c.do_not_contact, false) = false
    AND coalesce(c.is_converted, false) = false
    AND coalesce(c.customer_origin, '') NOT IN ('igreen_sync', 'igreen_extension')
    AND c.portal_submitted_at IS NULL
    AND nullif(btrim(coalesce(c.pos_venda_stage, '')), '') IS NULL
    AND lower(coalesce(c.andamento_igreen, '')) NOT IN ('ativo', 'aprovado', 'validado', 'licenciada', 'licenciado')
    AND coalesce(c.status, '') NOT IN ('approved', 'registered_igreen', 'cadastro_concluido', 'rejected', 'contato_incompleto', 'active', 'complete')
    AND lower(coalesce(c.conversation_step, '')) NOT IN ('cadastro_em_analise', 'portal_submitting', 'finalizando', 'finalizando_cadastro', 'aguardando_otp', 'validando_otp', 'aguardando_facial', 'aguardando_assinatura', 'complete', 'atendimento_finalizado', 'aguardando_avaliacao_atendimento')
    AND (lcs.paused_reason IS NULL OR (
      lower(lcs.paused_reason) NOT IN ('manual_admin_clear_sla_backlog', 'dnc', 'opt_out', 'invalid_phone')
      AND lower(lcs.paused_reason) NOT LIKE 'dnc:%'
      AND lower(lcs.paused_reason) NOT LIKE 'not_lead_outside_ddd%'
    ))
    AND (
      lcs.stage IS NOT NULL
      OR q.queue IS NOT NULL
      OR lower(coalesce(lcs.paused_reason, '')) = 'handoff_humano'
      OR coalesce(c.bot_paused_reason, '') LIKE 'humano_assumiu%'
    );

  SELECT coalesce(jsonb_object_agg(t.motivo, t.qtd), '{}'::jsonb)
  INTO v_fora
  FROM (
    SELECT
      CASE
        WHEN public.partner_lead_is_closed(
          c.id, c.consultant_id, c.is_converted, c.status, c.pos_venda_stage,
          c.andamento_igreen, c.customer_origin, c.igreen_code, c.cpf, c.portal_submitted_at
        ) THEN 'fechado'
        WHEN coalesce(c.do_not_contact, false)
          OR lower(coalesce(lcs.paused_reason, '')) LIKE 'dnc%'
          OR lower(coalesce(lcs.paused_reason, '')) = 'opt_out' THEN 'bloqueado'
        WHEN c.portal_submitted_at IS NOT NULL THEN 'cadastro_em_analise'
        WHEN coalesce(c.customer_origin, '') IN ('igreen_sync', 'igreen_extension') THEN 'cliente_carteira'
        ELSE 'sem_cadencia'
      END AS motivo,
      count(*)::bigint AS qtd
    FROM customers c
    LEFT JOIN lead_cadence_state lcs ON lcs.customer_id = c.id
    WHERE c.referral_partner_id = v_partner.id
      AND coalesce(c.bot_paused_reason, '') <> 'absorbed_wallet_duplicate'
      AND NOT (c.id::text IN (SELECT jsonb_array_elements(v_cycle) ->> 'id'))
    GROUP BY 1
  ) t;

  RETURN jsonb_build_object(
    'ok', true,
    'partner', jsonb_build_object('id', v_partner.id, 'nome', v_partner.nome, 'short_code', v_partner.short_code),
    'ref', coalesce(nullif(v_cons.license, ''), v_cons.igreen_id::text),
    'consultant', jsonb_build_object('name', coalesce(nullif(btrim(v_cons.name), ''), 'Consultor iGreen'), 'igreen_id', coalesce(v_cons.igreen_id::text, ''), 'phone', coalesce(v_wa_phone, '')),
    'stats', jsonb_build_object('fechamentos', coalesce(v_fechamentos, 0), 'em_analise', coalesce(v_em_analise, 0), 'leads', coalesce(v_leads_total, 0), 'leituras', coalesce(v_leituras, 0)),
    'spots', v_spots, 'scans', v_scans, 'leads', v_leads, 'cycle_leads', v_cycle,
    'outside_cycle', v_fora
  );
END;
$function$;
