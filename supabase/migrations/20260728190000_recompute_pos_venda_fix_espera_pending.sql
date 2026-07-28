-- Corrige recompute: clientes já em 'espera' com pending null (ex.: sync de
-- subcontas) nunca entravam no popup/auto_confirm — ficavam fora do trilho.
-- Com automático ligado, TODAS as contas do consultor precisam virar pending
-- → auto_confirm → envio (fone ok).

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
       AND c.pos_venda_pending_stage IS NULL
       AND (
         -- caso novo: stage ainda não é o palpite
         c.pos_venda_stage IS DISTINCT FROM public.compute_pos_venda_stage(c.pos_venda_approved_at, c.status, c.andamento_igreen)
         -- caso órfão: já em espera sem pending (subconta / sync antigo)
         OR (
           COALESCE(c.pos_venda_stage, '') = 'espera'
           AND public.compute_pos_venda_stage(c.pos_venda_approved_at, c.status, c.andamento_igreen) IN ('aprovado','reprovado')
         )
       )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$function$;
