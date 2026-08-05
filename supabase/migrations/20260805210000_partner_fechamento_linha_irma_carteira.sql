-- Fechamento do parceiro sobrevive à linha IRMÃ da carteira.
--
-- PROBLEMA REAL (parceiro Jose luiz / short_code 915275, 2026-08-05)
-- -----------------------------------------------------------------
-- O mesmo CPF ficou em duas linhas de `customers`:
--   • `whatsapp_lead`  — veio do QR do parceiro, tem `referral_partner_id`,
--     parou em `status='cadastro_concluido'` (sem `pos_venda_stage`);
--   • `igreen_sync`    — linha da carteira, MESMO `igreen_code` (1699240),
--     `Validado` + `pos_venda_stage='aprovado'`, mas SEM parceiro.
-- `customer_is_closed_deal` olha uma linha por vez, então o parceiro via
-- "0 fechamentos / 1 em análise" para uma venda validada.
--
-- A absorção de sombra (`carryPartnerAttributionToWalletRow`) deveria ter
-- copiado o parceiro para a linha de carteira, mas ela casa SÓ por telefone e
-- aqui os números são diferentes de verdade: o cliente começou a conversa num
-- celular (…99195340) e fez o cadastro em outro (…99356886) para ficar no mesmo
-- app, com o mesmo CPF e o mesmo e-mail. Corrigir a absorção é trabalho à
-- parte; esta migration conserta a CONTAGEM, que é o que o parceiro enxerga.
--
-- Regra: um lead do parceiro também fecha quando existe linha IRMÃ fechada do
-- MESMO consultor, ligada por
--   1. `igreen_code` idêntico  → é o mesmo cadastro na iGreen, mesma venda;
--   2. `cpf` idêntico, e só quando o lead do parceiro realmente enviou cadastro
--      (`portal_submitted_at IS NOT NULL`) — sem isso, uma conversa solta
--      herdaria fechamento de outro canal.
-- Nunca cruza consultor. Continua ignorando `absorbed_wallet_duplicate`, então
-- o par sombra+carteira nunca conta dois fechamentos.

-- ─────────────────────────────────────────────────────────────────────────────
-- Índices de apoio: sem eles o EXISTS abaixo faz seq scan em `customers` uma
-- vez por lead do parceiro.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS customers_consultant_igreen_code_idx
  ON public.customers (consultant_id, igreen_code)
  WHERE igreen_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS customers_consultant_cpf_idx
  ON public.customers (consultant_id, cpf)
  WHERE cpf IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Linha irmã fechada (mesma venda em outra linha do mesmo consultor).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.customer_closed_via_wallet_sibling(
  _customer_id uuid,
  _consultant_id uuid,
  _igreen_code text,
  _cpf text,
  _portal_submitted_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _consultant_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.customers s
      WHERE s.consultant_id = _consultant_id
        AND s.id IS DISTINCT FROM _customer_id
        AND coalesce(s.bot_paused_reason, '') <> 'absorbed_wallet_duplicate'
        AND public.customer_is_closed_deal(
          s.is_converted, s.status, s.pos_venda_stage, s.andamento_igreen, s.customer_origin
        )
        AND (
          (
            nullif(regexp_replace(coalesce(_igreen_code, ''), '\D', '', 'g'), '') IS NOT NULL
            AND regexp_replace(coalesce(s.igreen_code, ''), '\D', '', 'g')
                = regexp_replace(coalesce(_igreen_code, ''), '\D', '', 'g')
          )
          OR (
            _portal_submitted_at IS NOT NULL
            AND length(regexp_replace(coalesce(_cpf, ''), '\D', '', 'g')) = 11
            AND regexp_replace(coalesce(s.cpf, ''), '\D', '', 'g')
                = regexp_replace(coalesce(_cpf, ''), '\D', '', 'g')
          )
        )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.customer_closed_via_wallet_sibling(
  uuid, uuid, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Predicado canônico do PARCEIRO: fechou na própria linha OU na linha irmã.
-- Portal do parceiro e analytics do admin usam este — nunca reimplementar.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.partner_lead_is_closed(
  _customer_id uuid,
  _consultant_id uuid,
  _is_converted boolean,
  _status text,
  _pos_venda_stage text,
  _andamento_igreen text,
  _customer_origin text,
  _igreen_code text,
  _cpf text,
  _portal_submitted_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.customer_is_closed_deal(
      _is_converted, _status, _pos_venda_stage, _andamento_igreen, _customer_origin
    )
    OR public.customer_closed_via_wallet_sibling(
      _customer_id, _consultant_id, _igreen_code, _cpf, _portal_submitted_at
    );
$$;

REVOKE ALL ON FUNCTION public.partner_lead_is_closed(
  uuid, uuid, boolean, text, text, text, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Portal público do parceiro: `stats.fechamentos` / `stats.em_analise`.
-- Resto da função permanece igual ao que já estava em produção.
-- ─────────────────────────────────────────────────────────────────────────────
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

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'code', s.code, 'keyword', s.keyword, 'is_active', s.is_active
  ) ORDER BY s.created_at), '[]'::jsonb)
  INTO v_spots FROM referral_partner_banner_spots s WHERE s.partner_id = v_partner.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object('event_target', pe.event_target)), '[]'::jsonb)
  INTO v_scans FROM page_events pe
  WHERE pe.consultant_id = v_partner.consultant_id AND pe.event_type = 'qr_scan'
    AND (pe.event_target = ('partner:' || coalesce(v_partner.short_code, ''))
      OR pe.event_target LIKE ('partner:' || coalesce(v_partner.short_code, '') || ':%'));

  SELECT count(*)::bigint INTO v_leituras FROM page_events pe
  WHERE pe.consultant_id = v_partner.consultant_id AND pe.event_type = 'qr_scan'
    AND (pe.event_target = ('partner:' || coalesce(v_partner.short_code, ''))
      OR pe.event_target LIKE ('partner:' || coalesce(v_partner.short_code, '') || ':%'));

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
    AND (lcs.paused_reason IS NULL OR (lower(lcs.paused_reason) NOT IN ('manual_admin_clear_sla_backlog', 'dnc', 'opt_out', 'handoff_humano', 'invalid_phone') AND lower(lcs.paused_reason) NOT LIKE 'dnc:%' AND lower(lcs.paused_reason) NOT LIKE 'not_lead_outside_ddd%'))
    AND (lcs.stage IS NOT NULL OR q.queue IS NOT NULL);

  RETURN jsonb_build_object(
    'ok', true,
    'partner', jsonb_build_object('id', v_partner.id, 'nome', v_partner.nome, 'short_code', v_partner.short_code),
    'ref', coalesce(nullif(v_cons.license, ''), v_cons.igreen_id::text),
    'consultant', jsonb_build_object('name', coalesce(nullif(btrim(v_cons.name), ''), 'Consultor iGreen'), 'igreen_id', coalesce(v_cons.igreen_id::text, ''), 'phone', coalesce(v_wa_phone, '')),
    'stats', jsonb_build_object('fechamentos', coalesce(v_fechamentos, 0), 'em_analise', coalesce(v_em_analise, 0), 'leads', coalesce(v_leads_total, 0), 'leituras', coalesce(v_leituras, 0)),
    'spots', v_spots, 'scans', v_scans, 'leads', v_leads, 'cycle_leads', v_cycle
  );
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Analytics do admin (aba Parceiros): `aprovados` e `funnel.aprovado`.
-- Mesmo predicado, para portal e admin nunca divergirem.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_referral_partner_analytics()
RETURNS TABLE(
  partner_id uuid, partner_nome text, keywords text[], leads_total bigint,
  leads_30d bigint, leads_prev_30d bigint, aprovados bigint, reprovados bigint,
  conta_recebida bigint, qr_count bigint, keyword_count bigint,
  daily_series jsonb, funnel jsonb, last_lead_at timestamp with time zone
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  WITH my_partners AS (
    SELECT id, nome, keywords
    FROM public.referral_partners
    WHERE consultant_id = auth.uid()
      AND is_active = true
  ),
  cust AS (
    SELECT
      c.referral_partner_id AS pid,
      c.referral_detected_at,
      c.conversation_step,
      c.pos_venda_stage,
      c.portal_submitted_at,
      public.partner_lead_is_closed(
        c.id, c.consultant_id, c.is_converted, c.status, c.pos_venda_stage,
        c.andamento_igreen, c.customer_origin, c.igreen_code, c.cpf, c.portal_submitted_at
      ) AS closed,
      COALESCE(c.lead_source_detail->>'source', '') AS src
    FROM public.customers c
    WHERE c.referral_partner_id IN (SELECT id FROM my_partners)
      AND COALESCE(c.bot_paused_reason, '') <> 'absorbed_wallet_duplicate'
  ),
  days AS (
    SELECT generate_series(
      (now()::date - INTERVAL '29 days')::date,
      now()::date,
      INTERVAL '1 day'
    )::date AS d
  ),
  daily AS (
    SELECT
      mp.id AS pid,
      jsonb_agg(
        jsonb_build_object(
          'date', to_char(days.d, 'YYYY-MM-DD'),
          'count', COALESCE(cnt.c, 0)
        )
        ORDER BY days.d
      ) AS series
    FROM my_partners mp
    CROSS JOIN days
    LEFT JOIN (
      SELECT
        pid,
        date_trunc('day', referral_detected_at)::date AS d,
        COUNT(*) AS c
      FROM cust
      WHERE referral_detected_at >= now() - INTERVAL '30 days'
      GROUP BY pid, d
    ) cnt ON cnt.pid = mp.id AND cnt.d = days.d
    GROUP BY mp.id
  )
  SELECT
    mp.id AS partner_id,
    mp.nome AS partner_nome,
    mp.keywords,
    COALESCE(COUNT(cu.pid), 0) AS leads_total,
    COALESCE(COUNT(*) FILTER (WHERE cu.referral_detected_at >= now() - INTERVAL '30 days'), 0) AS leads_30d,
    COALESCE(COUNT(*) FILTER (WHERE cu.referral_detected_at >= now() - INTERVAL '60 days' AND cu.referral_detected_at < now() - INTERVAL '30 days'), 0) AS leads_prev_30d,
    COALESCE(COUNT(*) FILTER (WHERE cu.closed), 0) AS aprovados,
    COALESCE(COUNT(*) FILTER (WHERE cu.pos_venda_stage = 'Reprovado'), 0) AS reprovados,
    COALESCE(COUNT(*) FILTER (WHERE cu.portal_submitted_at IS NOT NULL OR cu.conversation_step IN ('conta_recebida','aguardando_aprovacao','aprovado','pos_venda')), 0) AS conta_recebida,
    COALESCE(COUNT(*) FILTER (WHERE cu.src = 'qr_code'), 0) AS qr_count,
    COALESCE(COUNT(*) FILTER (WHERE cu.src <> 'qr_code' AND cu.pid IS NOT NULL), 0) AS keyword_count,
    COALESCE((SELECT series FROM daily WHERE daily.pid = mp.id), '[]'::jsonb) AS daily_series,
    jsonb_build_object(
      'lead', COALESCE(COUNT(cu.pid), 0),
      'conta', COALESCE(COUNT(*) FILTER (WHERE cu.portal_submitted_at IS NOT NULL OR cu.conversation_step IN ('conta_recebida','aguardando_aprovacao','aprovado','pos_venda')), 0),
      'aprovado', COALESCE(COUNT(*) FILTER (WHERE cu.closed), 0)
    ) AS funnel,
    MAX(cu.referral_detected_at) AS last_lead_at
  FROM my_partners mp
  LEFT JOIN cust cu ON cu.pid = mp.id
  GROUP BY mp.id, mp.nome, mp.keywords
$function$;
