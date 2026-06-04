
-- 1) message_templates: novo flag is_public + política de leitura
ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_message_templates_is_public
  ON public.message_templates (is_public) WHERE is_public = true;

DROP POLICY IF EXISTS "Authenticated read public message templates" ON public.message_templates;
CREATE POLICY "Authenticated read public message templates"
  ON public.message_templates
  FOR SELECT
  TO authenticated
  USING (is_public = true);

-- 2) Marca os 22 atalhos do Rafael (superadmin) como públicos
UPDATE public.message_templates
   SET is_public = true
 WHERE consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3'
   AND origin_template_id IS NULL;

-- 3) voice_templates: marcar o(s) template(s) do Rafael como público(s)
UPDATE public.voice_templates
   SET is_public = true
 WHERE consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3';
