-- 1) Consultor não pode mais DELETAR venda (cascata destrói histórico/auditoria).
DROP POLICY IF EXISTS "Consultor manages own sales" ON public.sales;

CREATE POLICY "Consultor select own sales" ON public.sales
FOR SELECT TO authenticated
USING (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Consultor insert own sales" ON public.sales
FOR INSERT TO authenticated
WITH CHECK (consultant_id = auth.uid());

CREATE POLICY "Consultor update own sales" ON public.sales
FOR UPDATE TO authenticated
USING (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (consultant_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Admin deletes sales" ON public.sales
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- 2) Identidade da etapa é imutável (evita corromper histórico do funil).
CREATE OR REPLACE FUNCTION public.guard_sale_stage_progress_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.sale_id IS DISTINCT FROM OLD.sale_id
     OR NEW.template_position IS DISTINCT FROM OLD.template_position
     OR NEW.name_snapshot IS DISTINCT FROM OLD.name_snapshot THEN
    RAISE EXCEPTION 'Identidade da etapa (venda/posição/nome) não pode ser alterada';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_sale_stage_progress_identity ON public.sale_stage_progress;
CREATE TRIGGER guard_sale_stage_progress_identity
BEFORE UPDATE ON public.sale_stage_progress
FOR EACH ROW EXECUTE FUNCTION public.guard_sale_stage_progress_identity();