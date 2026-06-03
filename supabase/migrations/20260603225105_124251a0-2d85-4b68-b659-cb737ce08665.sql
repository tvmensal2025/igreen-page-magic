
-- 1. Fix: permitir step_type='handoff' que o seed_default_camila_flow já usa.
ALTER TABLE public.bot_flow_steps
  DROP CONSTRAINT IF EXISTS bot_flow_steps_step_type_check;

ALTER TABLE public.bot_flow_steps
  ADD CONSTRAINT bot_flow_steps_step_type_check
  CHECK (step_type = ANY (ARRAY[
    'audio_slot','message','question','media_request','cadastro',
    'capture_conta','capture_documento','capture_email','confirm_phone',
    'finalizar_cadastro','handoff'
  ]));

-- 2. Função: cria consultor pendente automaticamente no signup
CREATE OR REPLACE FUNCTION public.handle_new_consultant_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email   text := COALESCE(NEW.email, '');
  v_base    text;
  v_license text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.consultants WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_base := regexp_replace(lower(split_part(v_email, '@', 1)), '[^a-z0-9]+', '-', 'g');
  v_base := regexp_replace(v_base, '^-+|-+$', '', 'g');
  IF v_base = '' OR v_base IS NULL THEN v_base := 'consultor'; END IF;
  v_license := substr(v_base, 1, 30) || '-' || substr(NEW.id::text, 1, 6);

  BEGIN
    INSERT INTO public.consultants (id, name, license, phone, cadastro_url, approved)
    VALUES (
      NEW.id,
      COALESCE(NULLIF(split_part(v_email, '@', 1), ''), 'Novo consultor'),
      v_license, '', v_license, false
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'handle_new_consultant_signup falhou para %: % %', NEW.id, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$$;

-- 3. Trigger no auth.users
DROP TRIGGER IF EXISTS on_auth_user_created_consultant ON auth.users;
CREATE TRIGGER on_auth_user_created_consultant
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_consultant_signup();

-- 4. Backfill dos órfãos
INSERT INTO public.consultants (id, name, license, phone, cadastro_url, approved)
SELECT
  u.id,
  COALESCE(NULLIF(split_part(u.email, '@', 1), ''), 'Novo consultor'),
  substr(regexp_replace(regexp_replace(lower(split_part(COALESCE(u.email,''), '@', 1)), '[^a-z0-9]+', '-', 'g'), '^-+|-+$', '', 'g'), 1, 30) || '-' || substr(u.id::text, 1, 6),
  '',
  substr(regexp_replace(regexp_replace(lower(split_part(COALESCE(u.email,''), '@', 1)), '[^a-z0-9]+', '-', 'g'), '^-+|-+$', '', 'g'), 1, 30) || '-' || substr(u.id::text, 1, 6),
  false
FROM auth.users u
LEFT JOIN public.consultants c ON c.id = u.id
WHERE c.id IS NULL;
