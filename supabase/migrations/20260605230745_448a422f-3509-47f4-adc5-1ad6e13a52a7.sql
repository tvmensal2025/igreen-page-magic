ALTER TABLE public.stage_auto_messages
ADD COLUMN IF NOT EXISTS voice_template_id uuid NULL
REFERENCES public.voice_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stage_auto_messages_voice_template_id
ON public.stage_auto_messages(voice_template_id)
WHERE voice_template_id IS NOT NULL;