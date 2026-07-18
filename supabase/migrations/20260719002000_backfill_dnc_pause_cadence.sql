-- ============================================================================
-- Backfill: leads com do_not_contact=true ANTES do trigger
-- trg_customer_journey_sync existirem ainda tinham cadência ativa (10 casos).
-- DNC prevalece sobre qualquer automação (PLANO §8): pausar jornada, limpar
-- claim e suprimir efeitos reservados. Aditiva — nenhuma linha removida.
-- Aplicada em produção em 2026-07-18 (apply_migration backfill_dnc_pause_cadence).
-- ============================================================================

UPDATE public.lead_cadence_state lcs
   SET paused_reason = 'dnc',
       paused_until = NULL,
       next_action_at = NULL,
       claim_token = NULL,
       claimed_at = NULL,
       lease_expires_at = NULL
 FROM public.customers c
 WHERE c.id = lcs.customer_id
   AND c.do_not_contact = true
   AND lcs.stage NOT IN ('WON','PAUSED');

UPDATE public.lead_cadence_state lcs
   SET stage = 'PAUSED'
 FROM public.customers c
 WHERE c.id = lcs.customer_id
   AND c.do_not_contact = true
   AND lcs.stage NOT IN ('WON','PAUSED');

UPDATE public.outbound_effects oe
   SET status = 'suppressed', error_code = 'dnc_backfill'
 FROM public.customers c
 WHERE c.id = oe.customer_id
   AND c.do_not_contact = true
   AND oe.status IN ('reserved');
