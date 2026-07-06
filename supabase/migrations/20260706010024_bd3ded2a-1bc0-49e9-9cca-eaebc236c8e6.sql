
-- ============================================================
-- iGreen full-history sync: new tables + additive columns
-- ============================================================

-- 1) Telecom: linhas ativas por cliente
CREATE TABLE IF NOT EXISTS public.igreen_telecom_linhas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  consultant_id UUID NOT NULL,
  idcnxtelecom TEXT,
  msisdn TEXT,
  iccid TEXT,
  plano TEXT,
  status TEXT,
  cliente_nome TEXT,
  cliente_cpf TEXT,
  ativada_em DATE,
  cancelada_em DATE,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (consultant_id, msisdn)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.igreen_telecom_linhas TO authenticated;
GRANT ALL ON public.igreen_telecom_linhas TO service_role;
ALTER TABLE public.igreen_telecom_linhas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage telecom linhas" ON public.igreen_telecom_linhas
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Consultant sees own telecom linhas" ON public.igreen_telecom_linhas
  FOR SELECT TO authenticated
  USING (consultant_id = auth.uid());

-- 2) Telecom: faturas históricas
CREATE TABLE IF NOT EXISTS public.igreen_telecom_faturas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  consultant_id UUID NOT NULL,
  idcnxtelecom TEXT,
  msisdn TEXT,
  mes_referencia TEXT NOT NULL,
  valor_cents BIGINT,
  status TEXT,
  vencimento DATE,
  pago_em DATE,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (consultant_id, idcnxtelecom, mes_referencia)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.igreen_telecom_faturas TO authenticated;
GRANT ALL ON public.igreen_telecom_faturas TO service_role;
ALTER TABLE public.igreen_telecom_faturas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage telecom faturas" ON public.igreen_telecom_faturas
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Consultant sees own telecom faturas" ON public.igreen_telecom_faturas
  FOR SELECT TO authenticated
  USING (consultant_id = auth.uid());

-- 3) Telecom: comissões
CREATE TABLE IF NOT EXISTS public.igreen_telecom_comissoes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  consultant_id UUID NOT NULL,
  mes_referencia TEXT NOT NULL,
  origem TEXT,
  valor_cents BIGINT,
  status TEXT,
  descricao TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (consultant_id, external_id, mes_referencia)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.igreen_telecom_comissoes TO authenticated;
GRANT ALL ON public.igreen_telecom_comissoes TO service_role;
ALTER TABLE public.igreen_telecom_comissoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage telecom comissoes" ON public.igreen_telecom_comissoes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Consultant sees own telecom comissoes" ON public.igreen_telecom_comissoes
  FOR SELECT TO authenticated
  USING (consultant_id = auth.uid());

-- 4) Seguros: comissões
CREATE TABLE IF NOT EXISTS public.igreen_seguros_comissoes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  consultant_id UUID NOT NULL,
  mes_referencia TEXT NOT NULL,
  origem TEXT,
  valor_cents BIGINT,
  status TEXT,
  descricao TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (consultant_id, external_id, mes_referencia)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.igreen_seguros_comissoes TO authenticated;
GRANT ALL ON public.igreen_seguros_comissoes TO service_role;
ALTER TABLE public.igreen_seguros_comissoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage seguros comissoes" ON public.igreen_seguros_comissoes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Consultant sees own seguros comissoes" ON public.igreen_seguros_comissoes
  FOR SELECT TO authenticated
  USING (consultant_id = auth.uid());

-- 5) Snapshots de rede (timeline)
CREATE TABLE IF NOT EXISTS public.igreen_network_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  consultant_id UUID NOT NULL,
  mes_referencia TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (consultant_id, mes_referencia)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.igreen_network_snapshots TO authenticated;
GRANT ALL ON public.igreen_network_snapshots TO service_role;
ALTER TABLE public.igreen_network_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage network snapshots" ON public.igreen_network_snapshots
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Consultant sees own network snapshots" ON public.igreen_network_snapshots
  FOR SELECT TO authenticated
  USING (consultant_id = auth.uid());

-- 6) Estado do bulk sync
CREATE TABLE IF NOT EXISTS public.igreen_bulk_sync_state (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  started_by UUID,
  status TEXT NOT NULL DEFAULT 'queued',
  total INT NOT NULL DEFAULT 0,
  completed INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  current_consultant_id UUID,
  consultant_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  results JSONB NOT NULL DEFAULT '{}'::jsonb,
  full_history BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.igreen_bulk_sync_state TO authenticated;
GRANT ALL ON public.igreen_bulk_sync_state TO service_role;
ALTER TABLE public.igreen_bulk_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage bulk sync state" ON public.igreen_bulk_sync_state
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 7) Colunas adicionais em tabelas existentes (ADD only, sem drops)
ALTER TABLE public.igreen_seguros_customers
  ADD COLUMN IF NOT EXISTS apolice_id TEXT,
  ADD COLUMN IF NOT EXISTS sinistros JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS renovacao_prevista_at DATE,
  ADD COLUMN IF NOT EXISTS cashback_previsto_cents BIGINT;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS historico_completo_at TIMESTAMPTZ;

ALTER TABLE public.igreen_consultant_metrics
  ADD COLUMN IF NOT EXISTS telecom_ativos_total INT,
  ADD COLUMN IF NOT EXISTS seguros_apolices_total INT,
  ADD COLUMN IF NOT EXISTS rede_ranking_pos INT;

ALTER TABLE public.network_members
  ADD COLUMN IF NOT EXISTS produtos JSONB DEFAULT '{}'::jsonb;

-- 8) Trigger genérico updated_at (idempotente)
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'igreen_telecom_linhas','igreen_telecom_faturas',
    'igreen_telecom_comissoes','igreen_seguros_comissoes',
    'igreen_bulk_sync_state'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS touch_updated_at ON public.%I', t);
    EXECUTE format('CREATE TRIGGER touch_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at()', t);
  END LOOP;
END $$;
