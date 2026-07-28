-- Locais de banner do CONSULTOR (QR vivo).
-- URL pública: igreen.cloud/{iniciais}/{igreen_id}/{codigo}
-- Ex.: igreen.cloud/rfd/130392/posto-shell
-- A frase/keyword ficam no banco — dá para editar sem reimprimir.

CREATE TABLE IF NOT EXISTS public.consultant_banner_spots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  code text NOT NULL,
  keyword text NOT NULL,
  phrase text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consultant_banner_spots_code_format
    CHECK (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND char_length(code) BETWEEN 1 AND 48),
  CONSTRAINT consultant_banner_spots_keyword_len
    CHECK (char_length(trim(keyword)) BETWEEN 1 AND 80),
  CONSTRAINT consultant_banner_spots_unique_code
    UNIQUE (consultant_id, code)
);

CREATE INDEX IF NOT EXISTS consultant_banner_spots_consultant_idx
  ON public.consultant_banner_spots (consultant_id)
  WHERE is_active = true;

COMMENT ON TABLE public.consultant_banner_spots IS
  'Pontos de banner do consultor. QR vivo: /{iniciais}/{igreen_id}/{code} resolve frase/keyword aqui.';

COMMENT ON COLUMN public.consultant_banner_spots.code IS
  'Slug estável na URL (ex.: posto-shell). Não renomear depois de imprimir — edite keyword/phrase.';

COMMENT ON COLUMN public.consultant_banner_spots.keyword IS
  'Palavra-chave de rastreio (match no webhook via banner_keywords espelho).';

COMMENT ON COLUMN public.consultant_banner_spots.phrase IS
  'Frase WA opcional. NULL = usa buildDefaultQrPhrase(keyword).';

ALTER TABLE public.consultant_banner_spots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consultants_own_banner_spots ON public.consultant_banner_spots;
CREATE POLICY consultants_own_banner_spots
  ON public.consultant_banner_spots
  FOR ALL
  TO authenticated
  USING (consultant_id = auth.uid())
  WITH CHECK (consultant_id = auth.uid());

DROP POLICY IF EXISTS service_role_banner_spots ON public.consultant_banner_spots;
CREATE POLICY service_role_banner_spots
  ON public.consultant_banner_spots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Frase padrão do banner “raiz” /{iniciais}/{igreen_id} (sem código de local)
ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS banner_default_phrase text;

COMMENT ON COLUMN public.consultants.banner_default_phrase IS
  'Frase WA do QR vivo raiz /{iniciais}/{igreen_id}. Editável sem reimprimir.';
