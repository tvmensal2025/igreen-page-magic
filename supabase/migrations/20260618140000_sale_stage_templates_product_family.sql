-- Esteira por família de produto: coluna product_family, índice único e RPC filtrada.
-- Idempotente — seguro em ambientes que já aplicaram manualmente.

ALTER TABLE public.sale_stage_templates
  ADD COLUMN IF NOT EXISTS product_family text;

ALTER TABLE public.sale_stage_templates
  DROP CONSTRAINT IF EXISTS sale_stage_templates_position_key;

DROP INDEX IF EXISTS public.sale_stage_templates_family_position_key;
CREATE UNIQUE INDEX sale_stage_templates_family_position_key
  ON public.sale_stage_templates (product_family, position);

CREATE OR REPLACE FUNCTION public.ensure_sale_stage_progress(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.sale_stage_progress WHERE sale_id = p_sale_id) THEN
    RETURN;
  END IF;

  SELECT p.family::text INTO v_family
  FROM public.sales s
  JOIN public.products p ON p.id = s.product_id
  WHERE s.id = p_sale_id;

  INSERT INTO public.sale_stage_progress (sale_id, template_position, name_snapshot, status)
  SELECT p_sale_id, t.position, t.name, 'pendente'::public.sale_stage_status
  FROM public.sale_stage_templates t
  WHERE t.is_active = true
    AND (
      t.product_family = v_family
      OR (
        t.product_family IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.sale_stage_templates t2
          WHERE t2.is_active = true AND t2.product_family = v_family
        )
      )
    )
  ORDER BY t.position;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_sale_stage_progress(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_sale_stage_progress(uuid) TO authenticated, service_role;

-- Seed padrão por família (somente se a tabela estiver vazia).
INSERT INTO public.sale_stage_templates (product_family, position, name, is_active)
SELECT v.family, v.pos, v.name, true
FROM (VALUES
  ('placas',  0, 'Foto e documentação'),
  ('placas',  1, 'Visita técnica'),
  ('placas',  2, 'Dimensionamento'),
  ('placas',  3, 'Contrato enviado'),
  ('energia', 0, 'Documento assinado'),
  ('energia', 1, 'Cadastro na distribuidora'),
  ('energia', 2, 'Primeira fatura com desconto'),
  ('telecom', 0, 'Portabilidade solicitada'),
  ('telecom', 1, 'Chip ativado'),
  ('telecom', 2, 'Primeira recarga confirmada'),
  ('seguros', 0, 'Vistoria realizada'),
  ('seguros', 1, 'Apólice emitida'),
  ('seguros', 2, 'Kit boas-vindas enviado')
) AS v(family, pos, name)
WHERE NOT EXISTS (SELECT 1 FROM public.sale_stage_templates LIMIT 1)
ON CONFLICT (product_family, position) DO NOTHING;
