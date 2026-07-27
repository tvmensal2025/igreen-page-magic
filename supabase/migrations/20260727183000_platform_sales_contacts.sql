-- Contatos exclusivos da venda da plataforma (consultor iGreen).
-- NUNCA misturar com customers/leads/clientes.

CREATE TABLE IF NOT EXISTS public.platform_sales_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  name text,
  name_source text NOT NULL DEFAULT 'unknown',
  kind text NOT NULL DEFAULT 'consultor_igreen'
    CHECK (kind = 'consultor_igreen'),
  source text NOT NULL DEFAULT 'wa_group',
  wa_group_id text,
  wa_group_name text,
  wa_rank text,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_sales_contacts_phone_unique UNIQUE (phone)
);

CREATE INDEX IF NOT EXISTS idx_platform_sales_contacts_active
  ON public.platform_sales_contacts(active, kind);
CREATE INDEX IF NOT EXISTS idx_platform_sales_contacts_group
  ON public.platform_sales_contacts(wa_group_id);

DROP TRIGGER IF EXISTS trg_platform_sales_contacts_updated ON public.platform_sales_contacts;
CREATE TRIGGER trg_platform_sales_contacts_updated
  BEFORE UPDATE ON public.platform_sales_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.platform_sales_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "superadmin_platform_sales_contacts" ON public.platform_sales_contacts;
CREATE POLICY "superadmin_platform_sales_contacts"
  ON public.platform_sales_contacts FOR ALL
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_sales_contacts TO authenticated;
GRANT ALL ON public.platform_sales_contacts TO service_role;

COMMENT ON TABLE public.platform_sales_contacts IS
  'Alvos da venda da plataforma (consultor iGreen). Isolado de customers/leads/clientes.';
