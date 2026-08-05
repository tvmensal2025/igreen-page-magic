-- Pós-venda: cliente novo validado no iGreen entra na régua sem clique.
--
-- Problema: `recompute_pos_venda_stages` usava só `pos_venda_approved_at` como
-- marco. Cliente que acabou de ser validado no portal tem essa coluna NULL
-- (ela só é preenchida DEPOIS, por `confirm_pending_classification`), então
-- `compute_pos_venda_stage` devolvia 'espera', `pos_venda_pending_stage`
-- continuava NULL e `auto_confirm_pending_pos_venda` nunca encontrava a linha.
-- Resultado em produção: aprovado no iGreen, parado em "espera" para sempre.
--
-- Correção: quando o iGreen já marcou validado/ativo, o marco é inferido das
-- datas do portal (ativo → validado). Nada é apagado; `pos_venda_approved_at`,
-- quando existe, continua mandando.

-- Marco de aprovação inferido — NULL quando não dá para afirmar com segurança.
-- Diferente de `resolve_pos_venda_reference_at` (usada no aceite explícito),
-- esta nunca cai em `now()` nem usa data de CADASTRO: cadastro não é aprovação.
CREATE OR REPLACE FUNCTION public.pos_venda_auto_reference_at(
  _andamento text,
  _approved_at timestamptz,
  _data_ativo_igreen date,
  _data_validado_igreen date,
  _data_ativo text,
  _data_validado text,
  _max_age_days integer DEFAULT 30
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (timezone('America/Sao_Paulo', now()))::date;
  v_txt text;
  v_d date;
  v_ref date;
BEGIN
  IF _approved_at IS NOT NULL THEN
    RETURN _approved_at;
  END IF;

  IF _andamento IS NULL
     OR _andamento ~* 'reprov|cancel'
     OR _andamento !~* 'valid|ativo' THEN
    RETURN NULL;
  END IF;

  IF _data_ativo_igreen IS NOT NULL THEN
    v_ref := _data_ativo_igreen;
  ELSIF _data_validado_igreen IS NOT NULL THEN
    v_ref := _data_validado_igreen;
  ELSE
    FOREACH v_txt IN ARRAY ARRAY[_data_ativo, _data_validado]
    LOOP
      IF v_txt IS NULL OR btrim(v_txt) = '' THEN CONTINUE; END IF;
      BEGIN
        IF v_txt ~ '^\d{4}-\d{2}-\d{2}' THEN
          v_d := substring(v_txt from 1 for 10)::date;
        ELSIF v_txt ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN
          v_d := to_date(v_txt, 'DD/MM/YYYY');
        ELSE
          v_d := NULL;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_d := NULL;
      END;
      IF v_d IS NOT NULL THEN
        v_ref := v_d;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_ref IS NULL OR v_ref > v_today THEN
    RETURN NULL;
  END IF;

  -- Janela de segurança: carteira antiga que nunca passou pela validação humana
  -- não vira régua retroativa (evita D90/D150 em massa num sync só). Fora da
  -- janela, o cliente segue na fila manual do consultor.
  IF v_ref < v_today - _max_age_days THEN
    RETURN NULL;
  END IF;

  RETURN (v_ref::timestamp AT TIME ZONE 'America/Sao_Paulo');
END;
$function$;

COMMENT ON FUNCTION public.pos_venda_auto_reference_at(text, timestamptz, date, date, text, text, integer)
  IS 'Marco de pós-venda inferido das datas iGreen (ativo/validado) para cliente recém-validado. NULL quando não há certeza.';

CREATE OR REPLACE FUNCTION public.recompute_pos_venda_stages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH cand AS (
    SELECT c.id,
           public.compute_pos_venda_stage(
             public.pos_venda_auto_reference_at(
               c.andamento_igreen,
               c.pos_venda_approved_at,
               c.data_ativo_igreen,
               c.data_validado_igreen,
               c.data_ativo,
               c.data_validado
             ),
             c.status,
             c.andamento_igreen
           ) AS computed
      FROM public.customers c
     WHERE c.customer_origin = 'igreen_sync'
       AND c.pos_venda_manual = false
       AND c.pos_venda_pending_stage IS NULL
  ),
  upd AS (
    UPDATE public.customers c
       SET pos_venda_stage = CASE
             WHEN cand.computed IN ('aprovado','reprovado') THEN 'espera'
             ELSE cand.computed
           END,
           -- aprovado/reprovado vira pendência: quem confirma é o consultor
           -- (ou `auto_confirm_pending_pos_venda`, com "validar sozinho" on).
           pos_venda_pending_stage = CASE
             WHEN cand.computed IN ('aprovado','reprovado') THEN cand.computed
             ELSE c.pos_venda_pending_stage
           END,
           updated_at = now()
      FROM cand
     WHERE c.id = cand.id
       AND (
         c.pos_venda_stage IS DISTINCT FROM cand.computed
         OR (
           COALESCE(c.pos_venda_stage, '') = 'espera'
           AND cand.computed IN ('aprovado','reprovado')
         )
       )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$function$;
