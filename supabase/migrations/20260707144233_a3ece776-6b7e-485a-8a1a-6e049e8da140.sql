CREATE INDEX IF NOT EXISTS idx_customers_consultant_flow_variant
  ON public.customers (consultant_id, flow_variant)
  WHERE flow_variant IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_customers_flow_variant_on_consultant_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.active_variants IS NULL OR array_length(NEW.active_variants, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.active_variants IS NOT DISTINCT FROM NEW.active_variants THEN
    RETURN NEW;
  END IF;

  -- Importante: pausar um fluxo deve parar apenas NOVOS leads.
  -- Não reescrevemos clientes antigos aqui, porque isso pode disparar muitos
  -- updates/automações em public.customers e causar timeout no toggle.
  -- Clientes existentes continuam no fluxo em que já estavam; novos leads usam
  -- public.assign_flow_variant(), que respeita consultants.active_variants.
  RETURN NEW;
END;
$$;