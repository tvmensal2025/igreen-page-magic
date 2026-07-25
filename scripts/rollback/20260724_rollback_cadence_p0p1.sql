-- ROLLBACK MANUAL do pacote P0/P1 de cadência (24/07/2026).
--
-- ATENÇÃO: este arquivo NÃO fica em supabase/migrations/ de propósito.
-- Se estivesse lá, o fluxo normal de migration o aplicaria sozinho e desfaria
-- a correção. Rode manualmente, e só se precisar reverter.
--
-- Cada seção é independente. Aplique apenas a que corresponde ao problema.
-- As partes de código (Edge Functions) revertem-se por redeploy da versão
-- anterior, não por SQL.

-- ═══════════════════════════════════════════════════════════════════════════
-- SEÇÃO 1 — Reverter o trigger inbound (desfaz 20260724160000)
-- Efeito: volta a apagar o estágio B/C no inbound, como antes do pacote.
-- O trigger trg_cadence_on_inbound NÃO é tocado; só o corpo da função.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cadence_on_inbound_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.message_direction = 'inbound' AND NEW.customer_id IS NOT NULL THEN
    UPDATE public.lead_cadence_state
      SET stage = 'AI_QUALIFYING',
          last_response_at = now(),
          next_action_at = now() + interval '24 hours',
          paused_reason = NULL,
          paused_until = NULL
      WHERE customer_id = NEW.customer_id;

    -- Cancela auto-fechamento: cliente respondeu, não pode encerrar sozinho.
    UPDATE public.customers
       SET attendance_auto_close_at = NULL,
           attendance_auto_close_source = NULL
     WHERE id = NEW.customer_id
       AND attendance_auto_close_at IS NOT NULL;
  END IF;
  RETURN NEW;
END; $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- SEÇÃO 2 — Reverter os headers do cron CRM (desfaz 20260724161000)
-- Efeito: volta ao comando original, sem x-internal-secret / x-service-secret.
-- Só é necessário se o job passar a falhar; o schedule e o active são mantidos.
-- ═══════════════════════════════════════════════════════════════════════════

DO $rollback$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT jobid, schedule, active
    FROM cron.job
    WHERE jobname = 'crm-auto-progress-daily'
  LOOP
    PERFORM cron.alter_job(
      job_id := v_job.jobid,
      schedule := v_job.schedule,
      command := $command$
  SELECT net.http_post(
    url := 'https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/crm-auto-progress',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo"}'::jsonb,
    body := '{"source": "cron"}'::jsonb
  ) AS request_id;
      $command$,
      active := v_job.active
    );
  END LOOP;
END
$rollback$;

-- ═══════════════════════════════════════════════════════════════════════════
-- SEÇÃO 3 — Freio de emergência (não faz parte deste pacote)
-- Escada canônica, do menos ao mais abrangente. Preferir sempre a primeira que
-- resolva, em vez de derrubar o bot inteiro.
--
--   1) live_dispatch_enabled = false
--   2) daily_reheat_settings.enabled = false
--   3) automation_toggles: cadence_engine = false
--   4) app_settings.bot_global_enabled = false
--
-- Consulte #regras-duras antes de usar o item 4.
-- ═══════════════════════════════════════════════════════════════════════════
