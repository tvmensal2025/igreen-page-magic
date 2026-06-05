ALTER TABLE public.ai_decisions ADD COLUMN IF NOT EXISTS channel text;
CREATE INDEX IF NOT EXISTS idx_ai_decisions_channel_created ON public.ai_decisions (channel, created_at DESC);
COMMENT ON COLUMN public.ai_decisions.channel IS 'Origem do webhook: evolution | whapi | null (legacy)';