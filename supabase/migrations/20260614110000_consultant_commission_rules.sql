-- ============================================================
-- Bloco D — Regras de Comissão Green configuráveis pelo consultor
-- 2026-06-14
-- ============================================================
--
-- O ganho de ENTRADA (bônus extra Conexão Green) muda todo mês e depende
-- de DUAS coisas ao mesmo tempo:
--   1) a DISTRIBUIDORA do cliente (cada uma tem sua escada de %)
--   2) a QUANTIDADE de clientes validados no mês (faixas: 10 -> 20%, 40 -> 40%…)
--
-- O recorrente (4%/2% CP, 1%/0,5% CI) + bônus de carreira por graduação é
-- calculado no motor TS (greenCommission.ts) a partir do manual oficial.
--
-- Estas tabelas guardam APENAS o que o consultor configura e que muda mês a
-- mês. Como o plano é recorrente, ele NÃO é recriado todo mês: as mesmas
-- regras valem até o consultor editar. A confirmação por cliente continua
-- sendo a validação que já existe no Pós-Venda (confirm_pending_classification).
--
-- Tudo aditivo: nenhuma tabela/coluna existente é alterada ou removida.

-- ─── 1) Perfil de comissão do consultor (1 linha por consultor) ──────────
CREATE TABLE IF NOT EXISTS public.consultant_commission_settings (
  consultant_id  UUID PRIMARY KEY REFERENCES public.consultants(id) ON DELETE CASCADE,

  -- Graduação atual informada MANUALMENTE pelo consultor (resp. usuário).
  -- Alimenta o bônus de carreira do recorrente. Ex.: 'gestor', 'executivo'.
  -- Mantido como texto livre/slug para casar com o motor TS sem enum rígido.
  graduacao      TEXT NOT NULL DEFAULT 'licenciado',

  -- Como contar os validados do mês para destravar a faixa de entrada:
  --   'somado'     -> soma TODAS as distribuidoras (5 Cemig + 5 CPFL = 10)
  --   'individual' -> conta por distribuidora isolada (precisa atingir numa só)
  count_mode     TEXT NOT NULL DEFAULT 'somado'
                   CHECK (count_mode IN ('somado', 'individual')),

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.consultant_commission_settings IS 'Perfil de comissão Green do consultor: graduação manual e modo de contagem (somado/individual) das faixas de entrada.';
COMMENT ON COLUMN public.consultant_commission_settings.graduacao IS 'Graduação atual informada manualmente; alimenta o bônus de carreira do recorrente.';
COMMENT ON COLUMN public.consultant_commission_settings.count_mode IS 'somado = soma todas as distribuidoras; individual = conta por distribuidora isolada.';

-- ─── 2) Regras de entrada por distribuidora (N linhas por consultor) ─────
-- Cada linha é uma faixa: "a partir de N pessoas validadas, a distribuidora X
-- paga Y% de entrada, sendo A% imediato e B% diferido (90 dias por padrão)".
CREATE TABLE IF NOT EXISTS public.consultant_entrada_rules (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id      UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,

  -- Nome canônico da distribuidora (casa com customers.distribuidora /
  -- DISTRIBUIDORAS_POR_UF). Ex.: 'CPFL PAULISTA', 'CEMIG'.
  distribuidora      TEXT NOT NULL,

  -- Faixa: total de validados no mês a partir do qual esta linha vale.
  min_pessoas        INT NOT NULL CHECK (min_pessoas >= 0),

  -- % de entrada (sem teto — pode mudar todo mês, resp. usuário).
  entrada_total_pct  NUMERIC NOT NULL DEFAULT 0 CHECK (entrada_total_pct >= 0),

  -- Split definido pelo consultor (ex.: 40% imediato + 20% diferido).
  -- imediato + diferido devem somar entrada_total_pct (validado na UI/motor).
  pct_imediato       NUMERIC NOT NULL DEFAULT 0 CHECK (pct_imediato >= 0),
  pct_diferido       NUMERIC NOT NULL DEFAULT 0 CHECK (pct_diferido >= 0),

  -- Dias até a parcela diferida cair (resp. usuário: 90 dias).
  dias_diferido      INT NOT NULL DEFAULT 90 CHECK (dias_diferido >= 0),

  ativo              BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Uma faixa por (consultor, distribuidora, min_pessoas).
  UNIQUE (consultant_id, distribuidora, min_pessoas)
);

CREATE INDEX IF NOT EXISTS idx_entrada_rules_consultant
  ON public.consultant_entrada_rules (consultant_id) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_entrada_rules_lookup
  ON public.consultant_entrada_rules (consultant_id, distribuidora, min_pessoas) WHERE ativo = true;

COMMENT ON TABLE public.consultant_entrada_rules IS 'Faixas de entrada (bônus extra Green) por distribuidora e quantidade de validados, configuradas pelo consultor.';
COMMENT ON COLUMN public.consultant_entrada_rules.min_pessoas IS 'Total de validados no mês a partir do qual a faixa vale (escolhe-se a maior faixa atingida).';
COMMENT ON COLUMN public.consultant_entrada_rules.dias_diferido IS 'Dias até a parcela diferida da entrada (padrão 90).';

-- ─── 3) RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.consultant_commission_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultant_entrada_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Consultant manages own commission settings" ON public.consultant_commission_settings;
CREATE POLICY "Consultant manages own commission settings"
  ON public.consultant_commission_settings FOR ALL
  TO authenticated
  USING (consultant_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (consultant_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service role manages commission settings" ON public.consultant_commission_settings;
CREATE POLICY "Service role manages commission settings"
  ON public.consultant_commission_settings FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Consultant manages own entrada rules" ON public.consultant_entrada_rules;
CREATE POLICY "Consultant manages own entrada rules"
  ON public.consultant_entrada_rules FOR ALL
  TO authenticated
  USING (consultant_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (consultant_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service role manages entrada rules" ON public.consultant_entrada_rules;
CREATE POLICY "Service role manages entrada rules"
  ON public.consultant_entrada_rules FOR ALL
  TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_commission_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_entrada_rules TO authenticated;
GRANT ALL ON public.consultant_commission_settings TO service_role;
GRANT ALL ON public.consultant_entrada_rules TO service_role;

-- ─── 4) Triggers updated_at ───────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_commission_settings_updated_at ON public.consultant_commission_settings;
CREATE TRIGGER set_commission_settings_updated_at
  BEFORE UPDATE ON public.consultant_commission_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_entrada_rules_updated_at ON public.consultant_entrada_rules;
CREATE TRIGGER set_entrada_rules_updated_at
  BEFORE UPDATE ON public.consultant_entrada_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
