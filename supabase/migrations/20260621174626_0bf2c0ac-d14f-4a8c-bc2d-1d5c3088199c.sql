-- 1. Tabela de auditoria de resets silenciosos do conversation_step.
CREATE TABLE IF NOT EXISTS public.silent_step_reset_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  from_step text NOT NULL,
  to_step text NOT NULL,
  txid bigint,
  app_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.silent_step_reset_log TO authenticated;
GRANT ALL ON public.silent_step_reset_log TO service_role;

ALTER TABLE public.silent_step_reset_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read silent_step_reset_log"
  ON public.silent_step_reset_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_silent_step_reset_customer ON public.silent_step_reset_log(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_silent_step_reset_recent ON public.silent_step_reset_log(created_at DESC);

-- 2. Função de log do reset silencioso.
CREATE OR REPLACE FUNCTION public.log_silent_step_reset()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_trans int;
BEGIN
  -- Só nos importamos quando passo de captura/ask/confirmando vira UUID de fluxo.
  IF OLD.conversation_step IS NULL OR NEW.conversation_step IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.conversation_step !~ '^(aguardando_|ask_|confirmando_|capture_|editing_)' THEN
    RETURN NEW;
  END IF;
  IF NEW.conversation_step !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NEW;
  END IF;

  -- Se há transição registrada nos últimos 10s envolvendo esses steps, é uma
  -- mudança legítima (não silenciosa). Não loga.
  SELECT count(*) INTO recent_trans
  FROM public.bot_step_transitions
  WHERE customer_id = NEW.id
    AND created_at > now() - interval '10 seconds'
    AND (from_step = OLD.conversation_step OR to_step = NEW.conversation_step);

  IF recent_trans > 0 THEN
    RETURN NEW;
  END IF;

  -- Reset silencioso confirmado — registra.
  INSERT INTO public.silent_step_reset_log (customer_id, from_step, to_step, txid, app_name)
  VALUES (
    NEW.id,
    OLD.conversation_step,
    NEW.conversation_step,
    txid_current(),
    current_setting('application_name', true)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Trigger NUNCA bloqueia o update do cliente.
  RETURN NEW;
END;
$$;

-- 3. Trigger BEFORE UPDATE só dispara quando conversation_step muda.
DROP TRIGGER IF EXISTS audit_silent_step_reset ON public.customers;
CREATE TRIGGER audit_silent_step_reset
BEFORE UPDATE OF conversation_step ON public.customers
FOR EACH ROW
WHEN (OLD.conversation_step IS DISTINCT FROM NEW.conversation_step)
EXECUTE FUNCTION public.log_silent_step_reset();