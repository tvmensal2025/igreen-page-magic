
-- 1) Retroativo: 107 clientes reprovado/aprovado sem validação voltam pra espera.
UPDATE public.customers
   SET pos_venda_stage = 'espera',
       pos_venda_pending_stage = COALESCE(pos_venda_pending_stage, pos_venda_stage),
       updated_at = now()
 WHERE customer_origin = 'igreen_sync'
   AND pos_venda_manual = false
   AND pos_venda_stage IN ('reprovado', 'aprovado');

-- 2) Substitui compute_pos_venda_stage mantendo assinatura existente
--    (_approved_at, _status, _andamento). Não devolve mais aprovado/reprovado
--    automáticos — retorna o palpite para o dispatcher gravar em
--    pos_venda_pending_stage.
DROP FUNCTION IF EXISTS public.compute_pos_venda_stage(timestamptz, text, text);
CREATE FUNCTION public.compute_pos_venda_stage(_approved_at timestamptz, _status text, _andamento text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _status IN ('rejected','cancelled','canceled') THEN 'reprovado'
    WHEN _andamento IS NOT NULL AND _andamento ~* 'reprov|cancel' THEN 'reprovado'
    WHEN _approved_at IS NULL THEN 'espera'
    WHEN now() - _approved_at >= interval '120 days' THEN 'd120'
    WHEN now() - _approved_at >= interval '90 days'  THEN 'd90'
    WHEN now() - _approved_at >= interval '60 days'  THEN 'd60'
    WHEN now() - _approved_at >= interval '30 days'  THEN 'd30'
    ELSE 'aprovado'
  END;
$$;

-- 3) recompute: se o palpite é aprovado/reprovado, mantém em espera e
--    grava em pos_venda_pending_stage; caso contrário aplica normal.
CREATE OR REPLACE FUNCTION public.recompute_pos_venda_stages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH upd AS (
    UPDATE public.customers c
       SET pos_venda_stage = CASE
             WHEN public.compute_pos_venda_stage(c.pos_venda_approved_at, c.status, c.andamento_igreen) IN ('aprovado','reprovado')
               THEN 'espera'
             ELSE public.compute_pos_venda_stage(c.pos_venda_approved_at, c.status, c.andamento_igreen)
           END,
           pos_venda_pending_stage = CASE
             WHEN public.compute_pos_venda_stage(c.pos_venda_approved_at, c.status, c.andamento_igreen) IN ('aprovado','reprovado')
               THEN public.compute_pos_venda_stage(c.pos_venda_approved_at, c.status, c.andamento_igreen)
             ELSE c.pos_venda_pending_stage
           END,
           updated_at = now()
     WHERE c.customer_origin = 'igreen_sync'
       AND c.pos_venda_manual = false
       AND COALESCE(c.pos_venda_stage, '') <> 'espera'
       AND c.pos_venda_pending_stage IS NULL
       AND c.pos_venda_stage IS DISTINCT FROM public.compute_pos_venda_stage(c.pos_venda_approved_at, c.status, c.andamento_igreen)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$function$;

-- Revoke on function that got DROP+CREATE — reissue grants to match previous state.
REVOKE EXECUTE ON FUNCTION public.compute_pos_venda_stage(timestamptz, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_pos_venda_stage(timestamptz, text, text) TO service_role;
