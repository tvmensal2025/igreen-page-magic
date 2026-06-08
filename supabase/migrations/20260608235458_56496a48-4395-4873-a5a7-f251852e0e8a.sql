
-- 1. Coluna de invalidação
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS pos_venda_invalid boolean NOT NULL DEFAULT false;

-- 2. Estender RPC para aceitar 'invalidate'
CREATE OR REPLACE FUNCTION public.confirm_pending_classification(
  _customer_id uuid,
  _action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_target text;
BEGIN
  SELECT * INTO v_customer FROM public.customers WHERE id = _customer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF auth.uid() IS NOT NULL
     AND v_customer.consultant_id <> auth.uid()
     AND COALESCE(v_customer.assigned_consultant_id, '00000000-0000-0000-0000-000000000000'::uuid) <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF _action = 'snooze' THEN
    UPDATE public.customers
       SET pending_snoozed_until = now() + interval '24 hours',
           updated_at = now()
     WHERE id = _customer_id;
    RETURN jsonb_build_object('ok', true, 'action', 'snoozed');
  END IF;

  IF _action = 'review' THEN
    UPDATE public.customers
       SET pos_venda_pending_stage = NULL,
           pending_snoozed_until = NULL,
           updated_at = now()
     WHERE id = _customer_id;
    RETURN jsonb_build_object('ok', true, 'action', 'review');
  END IF;

  IF _action = 'invalidate' THEN
    UPDATE public.customers
       SET pos_venda_invalid = true,
           pos_venda_pending_stage = NULL,
           pending_snoozed_until = NULL,
           updated_at = now()
     WHERE id = _customer_id;
    RETURN jsonb_build_object('ok', true, 'action', 'invalidated');
  END IF;

  IF _action = 'approve' THEN
    v_target := COALESCE(v_customer.pos_venda_pending_stage, 'aprovado');
    UPDATE public.customers
       SET pos_venda_stage = v_target,
           pos_venda_manual = true,
           pos_venda_pending_stage = NULL,
           pending_snoozed_until = NULL,
           updated_at = now()
     WHERE id = _customer_id;
    RETURN jsonb_build_object('ok', true, 'action', 'approved', 'stage', v_target);
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'unknown_action');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.confirm_pending_classification(uuid, text) TO authenticated;

-- 3. Tabela de configuração de mídias pós-venda por consultor
CREATE TABLE IF NOT EXISTS public.consultant_pos_venda_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL,
  stage text NOT NULL CHECK (stage IN ('aprovado','reprovado','d30','d60','d90','d120')),
  text_content text,
  audio_media_id uuid,
  image_media_id uuid,
  video_media_id uuid,
  use_default boolean NOT NULL DEFAULT true,
  configured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consultant_id, stage)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_pos_venda_media TO authenticated;
GRANT ALL ON public.consultant_pos_venda_media TO service_role;

ALTER TABLE public.consultant_pos_venda_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Consultant manages own pos venda media"
  ON public.consultant_pos_venda_media
  FOR ALL
  TO authenticated
  USING (consultant_id = auth.uid())
  WITH CHECK (consultant_id = auth.uid());

CREATE OR REPLACE FUNCTION public.update_consultant_pos_venda_media_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consultant_pos_venda_media_updated_at ON public.consultant_pos_venda_media;
CREATE TRIGGER trg_consultant_pos_venda_media_updated_at
  BEFORE UPDATE ON public.consultant_pos_venda_media
  FOR EACH ROW EXECUTE FUNCTION public.update_consultant_pos_venda_media_updated_at();
