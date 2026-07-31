-- Reordena etapas da esteira de forma atômica (evita UNIQUE(position/family)
-- quebrado no meio de dois UPDATEs sequenciais do client).
CREATE OR REPLACE FUNCTION public.reorder_sale_stage_templates(p_items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  offset_base int := 100000;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items must be a non-empty array';
  END IF;

  -- Passagem 1: move para faixa alta (evita colisão UNIQUE durante o swap).
  FOR rec IN
    SELECT
      (elem->>'id')::uuid AS id,
      (elem->>'position')::int AS position
    FROM jsonb_array_elements(p_items) AS elem
  LOOP
    IF rec.id IS NULL OR rec.position IS NULL OR rec.position < 0 THEN
      RAISE EXCEPTION 'invalid item in p_items';
    END IF;
    UPDATE public.sale_stage_templates
       SET position = offset_base + rec.position,
           updated_at = now()
     WHERE id = rec.id;
  END LOOP;

  -- Passagem 2: posição final.
  FOR rec IN
    SELECT
      (elem->>'id')::uuid AS id,
      (elem->>'position')::int AS position
    FROM jsonb_array_elements(p_items) AS elem
  LOOP
    UPDATE public.sale_stage_templates
       SET position = rec.position,
           updated_at = now()
     WHERE id = rec.id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_sale_stage_templates(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_sale_stage_templates(jsonb) TO authenticated, service_role;

-- Templates SMS da voz: persistem por consultor (não só localStorage).
ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS voice_sms_templates jsonb;

COMMENT ON COLUMN public.consultants.voice_sms_templates IS
  'Templates SMS do painel Voz (array [{id,label,text}]). null = defaults do front.';
