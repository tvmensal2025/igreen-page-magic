-- Destravar clientes carteira (só pós-venda, nunca A/B/C)
UPDATE public.customers
   SET bot_paused = false,
       bot_paused_reason = NULL,
       bot_paused_until = NULL,
       assigned_human_id = NULL
 WHERE customer_origin IN ('igreen_sync','igreen_extension')
   AND (bot_paused = true OR assigned_human_id IS NOT NULL OR bot_paused_until IS NOT NULL)
   AND (do_not_contact IS DISTINCT FROM true);