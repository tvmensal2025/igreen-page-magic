CREATE OR REPLACE FUNCTION public.assign_flow_variant_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Regra de produto (2026-07-20, espelha _shared/bot/canonical-flow-variant.ts):
  -- lead novo SEMPRE nasce no Grupo A (Sofia). Fluxos D (teste), M/MG e F só
  -- recebem lead quando a variante é informada EXPLICITAMENTE por ferramenta
  -- interna (bot-e2e-runner, dev-fire-all-steps, manual-step-send, simulador).
  --
  -- Antes existia um fallback "qualquer fluxo ativo do consultor" que, para os
  -- 11 consultores que só têm o fluxo D ativo, criava lead manual em D.
  IF NEW.flow_variant IS NULL OR btrim(NEW.flow_variant) = '' THEN
    NEW.flow_variant := 'A';
  END IF;
  RETURN NEW;
END;
$function$;