-- Locais de banner do PARCEIRO (QR vivo, paridade com consultant_banner_spots).
-- URL: igreen.cloud/r/{licenca|igreen_id}/{short_code}?s={code}
-- Frase/keyword no banco — edita sem reimprimir.

CREATE TABLE IF NOT EXISTS public.referral_partner_banner_spots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.referral_partners(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  code text NOT NULL,
  keyword text NOT NULL,
  phrase text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_banner_spots_code_format
    CHECK (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND char_length(code) BETWEEN 1 AND 48),
  CONSTRAINT partner_banner_spots_keyword_len
    CHECK (char_length(trim(keyword)) BETWEEN 1 AND 80),
  CONSTRAINT partner_banner_spots_unique_code
    UNIQUE (partner_id, code)
);

CREATE INDEX IF NOT EXISTS partner_banner_spots_partner_idx
  ON public.referral_partner_banner_spots (partner_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS partner_banner_spots_consultant_idx
  ON public.referral_partner_banner_spots (consultant_id);

COMMENT ON TABLE public.referral_partner_banner_spots IS
  'Pontos de banner do parceiro. QR vivo: /r/{ref}/{short_code}?s={code}.';

ALTER TABLE public.referral_partner_banner_spots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consultants_own_partner_banner_spots ON public.referral_partner_banner_spots;
CREATE POLICY consultants_own_partner_banner_spots
  ON public.referral_partner_banner_spots
  FOR ALL
  TO authenticated
  USING (consultant_id = auth.uid())
  WITH CHECK (consultant_id = auth.uid());

DROP POLICY IF EXISTS service_role_partner_banner_spots ON public.referral_partner_banner_spots;
CREATE POLICY service_role_partner_banner_spots
  ON public.referral_partner_banner_spots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Token público da página do parceiro (Central de Banners só dele).
ALTER TABLE public.referral_partners
  ADD COLUMN IF NOT EXISTS portal_token text;

CREATE UNIQUE INDEX IF NOT EXISTS referral_partners_portal_token_uidx
  ON public.referral_partners (portal_token)
  WHERE portal_token IS NOT NULL;

COMMENT ON COLUMN public.referral_partners.portal_token IS
  'Token opaco da página pública do parceiro (igreen.cloud/p/{token}). Rotacionável pelo consultor.';

-- Limiar de alerta de leads/24h (Fase 3 leve — 0 = desligado).
ALTER TABLE public.referral_partners
  ADD COLUMN IF NOT EXISTS banner_alert_threshold int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.referral_partners.banner_alert_threshold IS
  'Se > 0, dispara alerta quando leituras/leads do banner do parceiro passam do limiar em 24h.';
