-- F01: possible_loop mais preciso — não pausar conversa legítima no welcome/dúvidas.
-- Conta só INBOUND no mesmo step; isenta steps conversacionais e pós-cadastro.
-- Não apaga a função anterior: REPLACE mantém assinatura.

CREATE OR REPLACE FUNCTION public.lint_bot_flow_consistency(_consultant_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(category text, severity text, detail text, consultant_id uuid, customer_id uuid, step text, occurrences bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 'unprefixed_flow_id'::text, 'high'::text,
         'UUID ou passo_<ts> sem prefixo flow: — risco de colisão',
         c.consultant_id, c.id, c.conversation_step, 1::bigint
    FROM public.customers c
   WHERE c.conversation_step IS NOT NULL
     AND c.conversation_step NOT LIKE 'flow:%'
     AND (
       c.conversation_step ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR c.conversation_step LIKE 'passo_%'
     )
     AND (_consultant_id IS NULL OR c.consultant_id = _consultant_id)

  UNION ALL

  SELECT 'orphan_flow_step'::text, 'high'::text,
         'flow:<id> não existe em bot_flow_steps',
         c.consultant_id, c.id, c.conversation_step, 1::bigint
    FROM public.customers c
   WHERE c.conversation_step LIKE 'flow:%'
     AND NOT EXISTS (
       SELECT 1 FROM public.bot_flow_steps s
        WHERE s.id::text = substring(c.conversation_step from 6)
     )
     AND (_consultant_id IS NULL OR c.consultant_id = _consultant_id)

  UNION ALL

  SELECT 'possible_loop'::text, 'medium'::text,
         'mais de 5 inbound no mesmo step em 24h (sem progresso)',
         c.consultant_id, c.id, c.conversation_step,
         (
           SELECT count(*) FROM public.conversations cv
            WHERE cv.customer_id = c.id
              AND cv.conversation_step = c.conversation_step
              AND cv.message_direction = 'inbound'
              AND cv.created_at > now() - interval '24 hours'
         )
    FROM public.customers c
   WHERE c.conversation_step IS NOT NULL
     AND c.bot_paused IS NOT TRUE
     AND (_consultant_id IS NULL OR c.consultant_id = _consultant_id)
     -- Isenta steps onde o lead pode conversar sem mudar de passo
     AND lower(regexp_replace(c.conversation_step, '^flow:', '')) NOT IN (
       'welcome', 'd_welcome', 'd_como_funciona', 'd_duvidas',
       'menu_inicial', 'qualificacao',
       'cadastro_em_analise', 'aguardando_otp', 'aguardando_facial',
       'aguardando_assinatura', 'aguardando_avaliacao_atendimento',
       'atendimento_finalizado'
     )
     -- Isenta UUIDs de d_welcome / d_como_funciona / d_duvidas ativos
     AND NOT EXISTS (
       SELECT 1 FROM public.bot_flow_steps s
        WHERE s.id::text = regexp_replace(c.conversation_step, '^flow:', '')
          AND s.step_key IN ('d_welcome', 'd_como_funciona', 'd_duvidas', 'welcome')
     )
     AND (
       SELECT count(*) FROM public.conversations cv
        WHERE cv.customer_id = c.id
          AND cv.conversation_step = c.conversation_step
          AND cv.message_direction = 'inbound'
          AND cv.created_at > now() - interval '24 hours'
     ) > 5;
$function$;

GRANT EXECUTE ON FUNCTION public.lint_bot_flow_consistency(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lint_bot_flow_consistency(uuid) TO service_role;
