-- Bump atômico da varredura lead_research_sweeps (self-chain seguro).
CREATE OR REPLACE FUNCTION public.lead_research_sweep_bump(
  p_sweep_id uuid,
  p_found int DEFAULT 0,
  p_ingested int DEFAULT 0,
  p_deduped int DEFAULT 0,
  p_errors int DEFAULT 0,
  p_inc_done boolean DEFAULT true
) RETURNS public.lead_research_sweeps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.lead_research_sweeps;
BEGIN
  UPDATE public.lead_research_sweeps
  SET
    done_cities = done_cities + CASE WHEN p_inc_done THEN 1 ELSE 0 END,
    found_phones = found_phones + COALESCE(p_found, 0),
    ingested = ingested + COALESCE(p_ingested, 0),
    deduped = deduped + COALESCE(p_deduped, 0),
    errors = errors + COALESCE(p_errors, 0),
    updated_at = now(),
    status = CASE
      WHEN (done_cities + CASE WHEN p_inc_done THEN 1 ELSE 0 END) >= total_cities THEN 'done'
      ELSE status
    END
  WHERE id = p_sweep_id
  RETURNING * INTO r;
  RETURN r;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lead_research_sweep_bump(uuid, int, int, int, int, boolean) TO service_role;
