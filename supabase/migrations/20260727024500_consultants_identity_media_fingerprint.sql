-- Bootstrap de mídia por identidade (nome IA + consultor).
ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS identity_media_bootstrapped_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS identity_media_fingerprint text NULL;

COMMENT ON COLUMN public.consultants.identity_media_bootstrapped_at IS
  'Quando corpos A2 + call clips foram gerados com a identidade atual.';
COMMENT ON COLUMN public.consultants.identity_media_fingerprint IS
  'Hash estável assistant|gender|prenome — evita regen se identidade não mudou.';
