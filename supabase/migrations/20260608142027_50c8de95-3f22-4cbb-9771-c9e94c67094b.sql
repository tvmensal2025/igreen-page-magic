
-- 1. Move any deals stuck in post-finalizando lead stages back to 'finalizando'.
UPDATE public.crm_deals
SET stage = 'finalizando'
WHERE stage IN ('aprovado','reprovado','30_dias','60_dias','90_dias','120_dias','espera');

-- 2. Remove auto-messages tied to the lead-scope stages we're deleting.
DELETE FROM public.stage_auto_messages
WHERE stage_id IN (
  SELECT id FROM public.kanban_stages
  WHERE COALESCE(stage_scope, 'lead') = 'lead'
    AND stage_key IN ('aprovado','reprovado','30_dias','60_dias','90_dias','120_dias','espera')
);

-- 3. Delete the lead-scope stages themselves.
DELETE FROM public.kanban_stages
WHERE COALESCE(stage_scope, 'lead') = 'lead'
  AND stage_key IN ('aprovado','reprovado','30_dias','60_dias','90_dias','120_dias','espera');
