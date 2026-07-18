-- ============================================================================
-- Hardening de segurança pós-advisors (PLANO §12).
-- Aditiva: apenas REVOKE/GRANT e SET search_path — nenhum objeto removido.
--   - RPCs de reconciliação/mídia chamadas SÓ por Edge Functions (service_role)
--     estavam executáveis por anon/authenticated (SECURITY DEFINER).
--   - tg_customer_journey_sync é função de trigger; ninguém chama direto.
--   - cadence_stage_group tinha search_path mutável.
--   - voice_webhook_events: policy admin-read (alinha com automation_runs).
-- ============================================================================

-- ── RPCs internas: somente service_role ─────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.reconcile_stuck_bulk_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stuck_bulk_targets() TO service_role;

REVOKE EXECUTE ON FUNCTION public.reconcile_stuck_scheduled_messages() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stuck_scheduled_messages() TO service_role;

REVOKE EXECUTE ON FUNCTION public.reserve_media_send(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_media_send(uuid, uuid, uuid, text, text) TO service_role;

-- ── Função de trigger: nunca executável diretamente ─────────────────────────
-- (o trigger roda como owner da tabela; revogar não afeta o disparo)
REVOKE EXECUTE ON FUNCTION public.tg_customer_journey_sync() FROM PUBLIC, anon, authenticated;

-- ── search_path fixo (advisor function_search_path_mutable) ─────────────────
ALTER FUNCTION public.cadence_stage_group(text) SET search_path = public;

-- ── voice_webhook_events: leitura admin (padrão das tabelas da jornada) ─────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.voice_webhook_events'::regclass
       AND polname = 'voice_webhook_events_admin_read'
  ) THEN
    CREATE POLICY voice_webhook_events_admin_read
      ON public.voice_webhook_events FOR SELECT
      USING (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;
