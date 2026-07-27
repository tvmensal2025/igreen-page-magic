-- 1) Limpar quem herdou "Sofia" (e outros nomes reservados) sem ser o dono
UPDATE public.consultants
   SET assistant_name = NULL
 WHERE assistant_name IS NOT NULL
   AND (
     (lower(assistant_name) = 'sofia'   AND id <> '0c2711ad-4836-41e6-afba-edd94f698ae3') OR
     (lower(assistant_name) = 'yasmin'  AND id <> 'f9594900-e75b-4aef-b3df-51d2ea0fb41e') OR
     (lower(assistant_name) = 'sol'     AND id <> 'f08b9176-b4a9-4848-afef-282949bd9e1d') OR
     (lower(assistant_name) = 'luciana' AND id <> '0f5b498b-c1d1-4915-9a18-ef120a8d675f')
   );

-- 2) Guard: bloquear reuso futuro de nomes reservados por outros consultores
CREATE OR REPLACE FUNCTION public.enforce_reserved_assistant_names()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reserved_owner uuid;
  norm text;
BEGIN
  IF NEW.assistant_name IS NULL OR btrim(NEW.assistant_name) = '' THEN
    RETURN NEW;
  END IF;
  norm := lower(btrim(NEW.assistant_name));
  reserved_owner := CASE norm
    WHEN 'sofia'   THEN '0c2711ad-4836-41e6-afba-edd94f698ae3'::uuid
    WHEN 'yasmin'  THEN 'f9594900-e75b-4aef-b3df-51d2ea0fb41e'::uuid
    WHEN 'sol'     THEN 'f08b9176-b4a9-4848-afef-282949bd9e1d'::uuid
    WHEN 'luciana' THEN '0f5b498b-c1d1-4915-9a18-ef120a8d675f'::uuid
    ELSE NULL
  END;
  IF reserved_owner IS NOT NULL AND NEW.id <> reserved_owner THEN
    RAISE EXCEPTION 'assistant_name % é reservado ao consultor dono. Escolha um nome único para a IA.', NEW.assistant_name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_reserved_assistant_names ON public.consultants;
CREATE TRIGGER trg_enforce_reserved_assistant_names
BEFORE INSERT OR UPDATE OF assistant_name ON public.consultants
FOR EACH ROW EXECUTE FUNCTION public.enforce_reserved_assistant_names();