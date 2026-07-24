-- Retentativa pós-reprovado (~60 dias): coluna CRM + marcos + texto padrão (todos consultores).

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS pos_venda_rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS pos_venda_recadastro_at timestamptz;

COMMENT ON COLUMN public.customers.pos_venda_rejected_at IS
  'Quando o consultor validou reprovado — relógio da retentativa (~60d).';
COMMENT ON COLUMN public.customers.pos_venda_recadastro_at IS
  'Cliente optou pela retentativa (botão). Sync não deve re-flipar origem enquanto ativo.';

-- Backfill: quem já está reprovado usa updated_at; se houver log de envio, usa created_at do log.
UPDATE public.customers c
   SET pos_venda_rejected_at = COALESCE(
     (
       SELECT l.created_at
         FROM public.customer_auto_message_log l
        WHERE l.customer_id = c.id
          AND l.stage_key = 'pv_reprovado'
          AND l.status IN ('sent', 'partial', 'partial_text', 'partial_audio', 'partial_image')
        ORDER BY l.created_at ASC
        LIMIT 1
     ),
     c.updated_at,
     c.created_at
   )
 WHERE c.customer_origin = 'igreen_sync'
   AND c.pos_venda_stage = 'reprovado'
   AND c.pos_venda_manual = true
   AND c.pos_venda_rejected_at IS NULL;

ALTER TABLE public.consultant_pos_venda_media
  DROP CONSTRAINT IF EXISTS consultant_pos_venda_media_stage_check;
ALTER TABLE public.consultant_pos_venda_media
  ADD CONSTRAINT consultant_pos_venda_media_stage_check
  CHECK (stage IN (
    'aprovado','reprovado','retentativa',
    'd30','d60','d90','d120','d150','d180','d210'
  ));

INSERT INTO public.kanban_stages (
  consultant_id, stage_key, label, color, position, stage_scope,
  auto_message_enabled, auto_message_type
)
SELECT c.id::text, 'pv_retentativa', 'Retentativa', '#ea580c', 25, 'pos_venda', true, 'text'
FROM public.consultants c
ON CONFLICT (consultant_id, stage_key) DO UPDATE SET
  label = EXCLUDED.label,
  color = EXCLUDED.color,
  auto_message_enabled = true;

INSERT INTO public.pos_venda_default_media AS p (
  stage, message_type, message_text, media_url, image_url, is_active, updated_at
)
VALUES (
  'retentativa',
  'text',
  $txt$Olá, {{nome}}.

Tudo bem?

Há cerca de 60 dias o seu cadastro na iGreen não pôde ser aprovado.

Como combinamos, estamos de volta para oferecer uma nova chance de análise.

Se você quiser tentar novamente, é só tocar no botão abaixo. Nossa equipe te guia no cadastro passo a passo.

Pode contar com a gente.$txt$,
  NULL,
  NULL,
  true,
  now()
)
ON CONFLICT (stage) DO UPDATE SET
  message_text = EXCLUDED.message_text,
  message_type = EXCLUDED.message_type,
  is_active = true,
  updated_at = now();

-- Propaga texto padrão para TODOS os consultores (não só um UUID).
INSERT INTO public.stage_auto_messages (
  stage_id, consultant_id, position, message_type, message_text, media_url, image_url, delay_seconds
)
SELECT
  ks.id,
  c.id::text,
  0,
  def.message_type,
  def.message_text,
  def.media_url,
  def.image_url,
  0
FROM public.consultants c
JOIN public.kanban_stages ks
  ON ks.consultant_id = c.id::text
 AND ks.stage_scope = 'pos_venda'
 AND ks.stage_key = 'pv_retentativa'
CROSS JOIN public.pos_venda_default_media def
WHERE def.stage = 'retentativa'
  AND NOT EXISTS (
    SELECT 1 FROM public.stage_auto_messages sam WHERE sam.stage_id = ks.id
  );

UPDATE public.stage_auto_messages sam
   SET message_text = def.message_text,
       message_type = def.message_type
  FROM public.kanban_stages ks
  JOIN public.pos_venda_default_media def ON def.stage = 'retentativa'
 WHERE sam.stage_id = ks.id
   AND ks.stage_key = 'pv_retentativa'
   AND ks.stage_scope = 'pos_venda';

-- Carimba rejected_at ao confirmar reprovado no popup de validação.
CREATE OR REPLACE FUNCTION public.confirm_pending_classification(_customer_id uuid, _action text)
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

  IF _action = 'defer_devolutiva' THEN
    UPDATE public.customers
       SET pos_venda_pending_stage = 'devolutiva_aberta',
           pos_venda_stage = 'espera',
           pos_venda_manual = true,
           pending_snoozed_until = NULL,
           pos_venda_approved_at = NULL,
           pos_venda_reason = 'Devolutiva em aberto',
           updated_at = now()
     WHERE id = _customer_id;
    RETURN jsonb_build_object('ok', true, 'action', 'devolutiva_aberta');
  END IF;

  IF _action = 'reject_pending' THEN
    UPDATE public.customers
       SET pos_venda_stage = 'reprovado',
           pos_venda_manual = true,
           pos_venda_pending_stage = NULL,
           pending_snoozed_until = NULL,
           pos_venda_approved_at = NULL,
           pos_venda_rejected_at = COALESCE(pos_venda_rejected_at, now()),
           pos_venda_reason = 'Reclassificado como reprovado',
           updated_at = now()
     WHERE id = _customer_id;
    RETURN jsonb_build_object('ok', true, 'action', 'rejected', 'stage', 'reprovado');
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

  IF _action = 'missing_signature' THEN
    UPDATE public.customers
       SET status = 'awaiting_signature',
           pos_venda_stage = 'espera',
           pos_venda_manual = true,
           pos_venda_pending_stage = NULL,
           pending_snoozed_until = NULL,
           pos_venda_approved_at = NULL,
           pos_venda_reason = 'Falta assinatura',
           updated_at = now()
     WHERE id = _customer_id;
    RETURN jsonb_build_object('ok', true, 'action', 'missing_signature');
  END IF;

  IF _action = 'approve' THEN
    v_target := COALESCE(v_customer.pos_venda_pending_stage, 'aprovado');
    IF v_target IN ('falta_assinatura', 'devolutiva', 'devolutiva_aberta') THEN
      v_target := 'aprovado';
    END IF;
    UPDATE public.customers
       SET pos_venda_stage = v_target,
           pos_venda_manual = true,
           pos_venda_pending_stage = NULL,
           pending_snoozed_until = NULL,
           pos_venda_rejected_at = NULL,
           pos_venda_approved_at = CASE
             WHEN v_target = 'aprovado' AND pos_venda_approved_at IS NULL THEN now()
             ELSE pos_venda_approved_at
           END,
           updated_at = now()
     WHERE id = _customer_id;
    RETURN jsonb_build_object('ok', true, 'action', 'approved', 'stage', v_target);
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'unknown_action');
END;
$function$;
