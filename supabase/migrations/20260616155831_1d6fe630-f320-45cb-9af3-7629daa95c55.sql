CREATE OR REPLACE FUNCTION public.ensure_sale_stage_progress(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sale_stage_progress WHERE sale_id = p_sale_id) THEN
    RETURN;
  END IF;

  INSERT INTO public.sale_stage_progress (sale_id, template_position, name_snapshot, status)
  SELECT p_sale_id, t.position, t.name, 'pendente'::public.sale_stage_status
  FROM public.sale_stage_templates t
  WHERE t.is_active = true
  ORDER BY t.position;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_sale_stage_progress(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_sale_stage_progress(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_ensure_sale_stage_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_sale_stage_progress(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_ensure_stage_progress ON public.sales;
CREATE TRIGGER trg_sales_ensure_stage_progress
  AFTER INSERT OR UPDATE OF status ON public.sales
  FOR EACH ROW
  WHEN (NEW.status = 'fechado')
  EXECUTE FUNCTION public.tg_ensure_sale_stage_progress();