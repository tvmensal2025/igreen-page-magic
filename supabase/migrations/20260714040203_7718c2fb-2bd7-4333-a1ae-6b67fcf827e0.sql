
-- 1) Extras em cadence_stage_config: limites por canal e janela por estágio
ALTER TABLE public.cadence_stage_config
  ADD COLUMN IF NOT EXISTS max_per_lead integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS window_start_hour integer,
  ADD COLUMN IF NOT EXISTS window_end_hour integer,
  ADD COLUMN IF NOT EXISTS window_days integer[];

COMMENT ON COLUMN public.cadence_stage_config.max_per_lead IS
  'Limite acumulado do canal por lead (0 = ilimitado, cadence-tick encerra ao atingir).';
COMMENT ON COLUMN public.cadence_stage_config.window_start_hour IS
  'Hora início janela permitida (0-23) — sobrepõe janela global. NULL = usa global.';
COMMENT ON COLUMN public.cadence_stage_config.window_end_hour IS
  'Hora fim janela permitida (0-23) — sobrepõe janela global. NULL = usa global.';
COMMENT ON COLUMN public.cadence_stage_config.window_days IS
  'Dias da semana permitidos (0=Dom..6=Sáb). NULL = usa global.';

-- 2) customers: origem de recuperação (para métricas de ROI da cadência)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS origin_recovery text,
  ADD COLUMN IF NOT EXISTS meta_retargeting_synced_at timestamptz;

-- 3) Trigger: quando o consultor manda mensagem manual, cancela cadência
CREATE OR REPLACE FUNCTION public.pause_cadence_on_manual_send()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só reage a saídas manuais (consultor no chat). Envios do bot têm origin='bot'.
  IF NEW.message_direction = 'outbound'
     AND (NEW.origin IN ('human','consultant','manual','operator') OR NEW.sent_by IS NOT NULL)
     AND COALESCE(NEW.origin, '') <> 'bot'
     AND COALESCE(NEW.origin, '') <> 'cadence' THEN
    UPDATE public.lead_cadence_state
       SET stage = 'PAUSED'::cadence_stage,
           paused_reason = 'handoff_humano',
           paused_until = (now() + interval '72 hours'),
           next_action_at = (now() + interval '72 hours'),
           updated_at = now()
     WHERE customer_id = NEW.customer_id
       AND stage NOT IN ('WON'::cadence_stage,'CLOSE_LOST'::cadence_stage,'RETARGET_META'::cadence_stage);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pause_cadence_on_manual_send ON public.conversations;
CREATE TRIGGER trg_pause_cadence_on_manual_send
AFTER INSERT ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.pause_cadence_on_manual_send();

-- 4) View de métricas diárias da cadência
CREATE OR REPLACE VIEW public.cadence_metrics_daily AS
SELECT
  date_trunc('day', l.created_at)::date AS day,
  l.stage,
  l.channel,
  count(*) FILTER (WHERE l.status = 'sent')     AS sent,
  count(*) FILTER (WHERE l.status = 'failed')   AS failed,
  count(*) FILTER (WHERE l.status = 'queued')   AS queued,
  count(DISTINCT l.customer_id)                 AS unique_leads,
  count(DISTINCT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.customer_id = l.customer_id
        AND c.message_direction = 'inbound'
        AND c.created_at BETWEEN l.created_at AND l.created_at + interval '48 hours'
    ) THEN l.customer_id END)                   AS responded_leads
FROM public.cadence_action_log l
WHERE l.created_at > now() - interval '90 days'
GROUP BY 1, 2, 3;

GRANT SELECT ON public.cadence_metrics_daily TO authenticated;
GRANT SELECT ON public.cadence_metrics_daily TO service_role;
