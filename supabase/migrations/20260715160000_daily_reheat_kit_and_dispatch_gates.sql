-- ═══════════════════════════════════════════════════════════════════════════
-- Ciclo diário — Kit + piloto (ADITIVO). NADA liga sozinho.
-- enabled/toggle continuam false. Só prepara estrutura e UI.
-- ═══════════════════════════════════════════════════════════════════════════

-- Kit por consultor (áudios WA por dia da semana + ligação + SMS)
CREATE TABLE IF NOT EXISTS public.daily_reheat_kit (
  consultant_id uuid PRIMARY KEY REFERENCES public.consultants(id) ON DELETE CASCADE,
  wa_open_text text,
  -- Áudios WhatsApp (seg–sáb). Domingo usa sábado como fallback no código.
  wa_audio_mon_url text,
  wa_audio_tue_url text,
  wa_audio_wed_url text,
  wa_audio_thu_url text,
  wa_audio_fri_url text,
  wa_audio_sat_url text,
  -- Ligação (Velip): clip PSTN opcional + TTS fallback
  voice_audio_clip_id uuid REFERENCES public.voice_audio_clips(id) ON DELETE SET NULL,
  call_tts_fallback text,
  -- SMS pós-NA / reforço
  sms_na_text text,
  sms_retry_text text,
  -- BINAs / observações (números ou notas; dispatch usa se Velip exigir no futuro)
  bina_notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.daily_reheat_kit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "consultant read own daily_reheat_kit" ON public.daily_reheat_kit;
CREATE POLICY "consultant read own daily_reheat_kit"
  ON public.daily_reheat_kit FOR SELECT TO authenticated
  USING (
    consultant_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "consultant upsert own daily_reheat_kit" ON public.daily_reheat_kit;
CREATE POLICY "consultant upsert own daily_reheat_kit"
  ON public.daily_reheat_kit FOR ALL TO authenticated
  USING (
    consultant_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    consultant_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

GRANT SELECT, INSERT, UPDATE ON public.daily_reheat_kit TO authenticated;
GRANT ALL ON public.daily_reheat_kit TO service_role;

DROP TRIGGER IF EXISTS trg_daily_reheat_kit_updated ON public.daily_reheat_kit;
CREATE TRIGGER trg_daily_reheat_kit_updated
  BEFORE UPDATE ON public.daily_reheat_kit
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Coluna explícita de live (triplo cadeado com toggle + settings.enabled)
ALTER TABLE public.daily_reheat_settings
  ADD COLUMN IF NOT EXISTS live_dispatch_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.daily_reheat_settings.live_dispatch_enabled IS
  'Triplo cadeado: só envia se automation_toggles.daily_reheat=ON AND settings.enabled=true AND live_dispatch_enabled=true. Default false.';

-- Piloto Rafael pré-configurado (ainda OFF — só restringe quem o dry-run/live enxerga)
UPDATE public.daily_reheat_settings
SET
  pilot_consultant_ids = ARRAY['0c2711ad-4836-41e6-afba-edd94f698ae3'::uuid],
  enabled = false,
  live_dispatch_enabled = false,
  daily_whapi_cap = 10,
  updated_at = now()
WHERE id = 'global';

-- Seed kit vazio do piloto (só linha; textos/áudios o consultor preenche na UI)
INSERT INTO public.daily_reheat_kit (consultant_id, wa_open_text, call_tts_fallback, sms_na_text)
VALUES (
  '0c2711ad-4836-41e6-afba-edd94f698ae3',
  E'Oi {{nome}}, aqui é {{consultor}} da iGreen Energia.\n\nProtocolo {{protocolo}} — vou te ajudar com a simulação da conta de luz.',
  'Olá, aqui é da iGreen Energia. Tentei falar com você sobre a economia na conta de luz. Me retorne no WhatsApp, por favor.',
  'Oi! Tentei te ligar da iGreen. Me chama no WhatsApp quando puder — é rapidinho.'
)
ON CONFLICT (consultant_id) DO NOTHING;
