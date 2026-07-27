-- Novos consultores nascem com motor conversacional ON (funil A público).
-- Sem isso o default false + falha no seed deixava welcome no legado/IA.
ALTER TABLE public.consultants
  ALTER COLUMN conversational_flow_enabled SET DEFAULT true;

-- Backfill: quem ainda está false (e não desligou de propósito via UI recente)
-- liga para ficar igual ao Rafael no funil A.
UPDATE public.consultants
   SET conversational_flow_enabled = true
 WHERE conversational_flow_enabled IS DISTINCT FROM true;
