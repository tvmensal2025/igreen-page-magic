-- Fechamento do parceiro = conversão de verdade, não só `pos_venda_stage='Aprovado'`.
--
-- PROBLEMA REAL (parceiro José, 2026-08-05)
-- ----------------------------------------
-- O lead indicado pelo parceiro CONVERTEU e o parceiro não via nada:
--   • `get_partner_banner_portal.stats.fechamentos` contava só
--     `pos_venda_stage = 'Aprovado'` (string exata, case-sensitive);
--   • `get_referral_partner_analytics.aprovados` usava o MESMO critério.
-- Cliente aprovado com `is_converted=true`, `status='approved'`,
-- `status='registered_igreen'`, `andamento_igreen='ativo'` ou já na carteira
-- (`customer_origin='igreen_sync'`) NÃO entrava na conta em NENHUMA das duas
-- páginas. E o lead ainda desaparecia de `cycle_leads` (que exclui convertido),
-- então o parceiro ficava sem lead na pizza E sem fechamento no KPI.
--
-- Também corrige DUPLA CONTAGEM: quando o cadastro entra na carteira, o sync
-- deixa duas linhas (lead sombra + linha de carteira). A absorção marca a sombra
-- com `bot_paused_reason='absorbed_wallet_duplicate'`, e agora a atribuição do
-- parceiro é copiada para a linha de carteira (`carryPartnerAttributionToWalletRow`).
-- As contagens passam a ignorar a sombra absorvida — 1 indicação = 1 lead.
--
-- `em_analise` é NOVO: cadastro enviado e ainda sem aprovação. Antes esse lead
-- ficava invisível (fora da pizza e fora do fechamento).

-- ─────────────────────────────────────────────────────────────────────────────
-- Predicado canônico de "fechou" — espelha os sinais de cliente usados em
-- `_shared/cliente-cadence-guard.ts` / `src/lib/clienteCadenceGuard.ts`.
-- Existe para o portal e o analytics do admin nunca mais divergirem.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.customer_is_closed_deal(
  _is_converted boolean,
  _status text,
  _pos_venda_stage text,
  _andamento_igreen text,
  _customer_origin text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    coalesce(_is_converted, false)
    OR lower(btrim(coalesce(_pos_venda_stage, ''))) = 'aprovado'
    OR lower(btrim(coalesce(_andamento_igreen, ''))) IN (
      'ativo', 'aprovado', 'validado', 'licenciada', 'licenciado'
    )
    OR lower(btrim(coalesce(_status, ''))) IN ('approved', 'registered_igreen')
    OR lower(btrim(coalesce(_customer_origin, ''))) IN ('igreen_sync', 'igreen_extension');
$$;

COMMENT ON FUNCTION public.customer_is_closed_deal(boolean, text, text, text, text) IS
  'Conversão confirmada do cliente (espelho de cliente-cadence-guard). Usado por get_partner_banner_portal e get_referral_partner_analytics para nunca divergirem.';

REVOKE ALL ON FUNCTION public.customer_is_closed_deal(boolean, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_is_closed_deal(boolean, text, text, text, text) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Portal do parceiro /p/{token}
-- ─────────────────────────────────────────────────────────────────────────────
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

  SELECT
    c.license,
    c.igreen_id,
    c.name,
    c.phone,
    c.notification_phone
  INTO v_cons
  FROM consultants c
  WHERE c.id = v_partner.consultant_id;

  -- Chip vivo Whapi ou Evolution
  SELECT nullif(btrim(s.value), '') INTO v_sa_id
  FROM settings s
  WHERE s.key = 'superadmin_consultant_id'
  LIMIT 1;

  IF v_sa_id IS NOT NULL AND v_sa_id = v_partner.consultant_id::text THEN
    SELECT nullif(regexp_replace(coalesce(s.value, ''), '\D', '', 'g'), '')
    INTO v_wa_phone
    FROM settings s
    WHERE s.key = 'whapi_connected_phone'
    LIMIT 1;
  END IF;

  IF v_wa_phone IS NULL OR length(v_wa_phone) < 10 THEN
    SELECT nullif(regexp_replace(coalesce(wi.connected_phone, ''), '\D', '', 'g'), '')
    INTO v_wa_phone
    FROM whatsapp_instances wi
    WHERE wi.consultant_id = v_partner.consultant_id
      AND nullif(btrim(wi.connected_phone), '') IS NOT NULL
      AND lower(coalesce(wi.status, '')) IN ('connected', 'online', 'open')
    ORDER BY wi.updated_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_wa_phone IS NULL OR length(v_wa_phone) < 10 THEN
    v_wa_phone := coalesce(
      nullif(regexp_replace(coalesce(v_cons.phone, ''), '\D', '', 'g'), ''),
      ''
    );
  END IF;

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

  SELECT count(*)::bigint
  INTO v_leituras
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
    AND c.referral_keyword_matched IS NOT NULL
    AND coalesce(c.bot_paused_reason, '') <> 'absorbed_wallet_duplicate';

  SELECT count(*)::bigint
  INTO v_leads_total
  FROM customers c
  WHERE c.referral_partner_id = v_partner.id
    AND coalesce(c.bot_paused_reason, '') <> 'absorbed_wallet_duplicate';

  -- Fechou = conversão confirmada (predicado canônico).
  SELECT count(*)::bigint
  INTO v_fechamentos
  FROM customers c
  WHERE c.referral_partner_id = v_partner.id
    AND coalesce(c.bot_paused_reason, '') <> 'absorbed_wallet_duplicate'
    AND public.customer_is_closed_deal(
      c.is_converted, c.status, c.pos_venda_stage, c.andamento_igreen, c.customer_origin
    );

  -- Cadastro enviado e ainda sem aprovação — antes ficava invisível.
  SELECT count(*)::bigint
  INTO v_em_analise
  FROM customers c
  WHERE c.referral_partner_id = v_partner.id
    AND coalesce(c.bot_paused_reason, '') <> 'absorbed_wallet_duplicate'
    AND c.portal_submitted_at IS NOT NULL
    AND NOT public.customer_is_closed_deal(
      c.is_converted, c.status, c.pos_venda_stage, c.andamento_igreen, c.customer_origin
    );

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'name', public.mask_first_name(c.name),
    'name_source', c.name_source,
    'phone_whatsapp', public.mask_phone_br(c.phone_whatsapp),
    'status', c.status,
    'conversation_step', c.conversation_step,
    'portal_submitted_at', c.portal_submitted_at,
    'do_not_contact', coalesce(c.do_not_contact, false),
    'customer_origin', c.customer_origin,
    'is_converted', coalesce(c.is_converted, false),
    'pos_venda_stage', c.pos_venda_stage,
    'andamento_igreen', c.andamento_igreen,
    'pos_venda_recadastro_at', c.pos_venda_recadastro_at,
    'stage', lcs.stage,
    'paused_reason', lcs.paused_reason,
    'next_action_at', lcs.next_action_at,
    'active_cadence', (lcs.next_action_at IS NOT NULL),
    'queue_queue', q.queue,
    'queue_step', q.step
  ) ORDER BY coalesce(lcs.updated_at, c.updated_at) DESC NULLS LAST), '[]'::jsonb)
  INTO v_cycle
  FROM customers c
  LEFT JOIN lead_cadence_state lcs ON lcs.customer_id = c.id
  LEFT JOIN LATERAL (
    SELECT drq.queue, drq.step
    FROM daily_reheat_queue drq
    WHERE drq.customer_id = c.id
      AND drq.cycle_date = v_cycle_date
      AND drq.status IN ('planned', 'claimed')
    ORDER BY drq.updated_at DESC NULLS LAST
    LIMIT 1
  ) q ON true
  WHERE c.referral_partner_id = v_partner.id
    AND coalesce(c.do_not_contact, false) = false
    AND coalesce(c.is_converted, false) = false
    AND coalesce(c.customer_origin, '') NOT IN ('igreen_sync', 'igreen_extension')
    AND c.portal_submitted_at IS NULL
    AND nullif(btrim(coalesce(c.pos_venda_stage, '')), '') IS NULL
    AND lower(coalesce(c.andamento_igreen, '')) NOT IN (
      'ativo', 'aprovado', 'validado', 'licenciada', 'licenciado'
    )
    AND coalesce(c.status, '') NOT IN (
      'approved', 'registered_igreen', 'cadastro_concluido', 'rejected',
      'contato_incompleto', 'active', 'complete'
    )
    AND lower(coalesce(c.conversation_step, '')) NOT IN (
      'cadastro_em_analise', 'portal_submitting', 'finalizando',
      'finalizando_cadastro', 'aguardando_otp', 'validando_otp',
      'aguardando_facial', 'aguardando_assinatura', 'complete',
      'atendimento_finalizado', 'aguardando_avaliacao_atendimento'
    )
    AND (
      lcs.paused_reason IS NULL
      OR (
        lower(lcs.paused_reason) NOT IN (
          'manual_admin_clear_sla_backlog', 'dnc', 'opt_out',
          'handoff_humano', 'invalid_phone'
        )
        AND lower(lcs.paused_reason) NOT LIKE 'dnc:%'
        AND lower(lcs.paused_reason) NOT LIKE 'not_lead_outside_ddd%'
      )
    )
    AND (lcs.stage IS NOT NULL OR q.queue IS NOT NULL);

  RETURN jsonb_build_object(
    'ok', true,
    'partner', jsonb_build_object(
      'id', v_partner.id,
      'nome', v_partner.nome,
      'short_code', v_partner.short_code
    ),
    'ref', coalesce(nullif(v_cons.license, ''), v_cons.igreen_id::text),
    'consultant', jsonb_build_object(
      'name', coalesce(nullif(btrim(v_cons.name), ''), 'Consultor iGreen'),
      'igreen_id', coalesce(v_cons.igreen_id::text, ''),
      'phone', coalesce(v_wa_phone, '')
    ),
    'stats', jsonb_build_object(
      'fechamentos', coalesce(v_fechamentos, 0),
      'em_analise', coalesce(v_em_analise, 0),
      'leads', coalesce(v_leads_total, 0),
      'leituras', coalesce(v_leituras, 0)
    ),
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
  'Portal /p/{token}: stats.leads=todos (sem sombra absorvida); fechamentos=customer_is_closed_deal; em_analise=cadastro enviado sem aprovação; leituras=QR partner:; phone=chip vivo Whapi|Evolution.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Analytics do admin (aba Parceiros) — mesmo critério de fechamento
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_referral_partner_analytics()
RETURNS TABLE(
  partner_id UUID,
  partner_nome TEXT,
  keywords TEXT[],
  leads_total BIGINT,
  leads_30d BIGINT,
  leads_prev_30d BIGINT,
  aprovados BIGINT,
  reprovados BIGINT,
  conta_recebida BIGINT,
  qr_count BIGINT,
  keyword_count BIGINT,
  daily_series JSONB,
  funnel JSONB,
  last_lead_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
      public.customer_is_closed_deal(
        c.is_converted, c.status, c.pos_venda_stage, c.andamento_igreen, c.customer_origin
      ) AS closed,
      COALESCE(c.lead_source_detail->>'source', '') AS src
    FROM public.customers c
    WHERE c.referral_partner_id IN (SELECT id FROM my_partners)
      -- sombra absorvida é duplicata da linha de carteira: não conta 2x
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
$$;

COMMENT ON FUNCTION public.get_referral_partner_analytics() IS
  'Analytics de parceiros do consultor logado. aprovados/funnel.aprovado = customer_is_closed_deal (mesmo critério do portal /p/{token}).';
