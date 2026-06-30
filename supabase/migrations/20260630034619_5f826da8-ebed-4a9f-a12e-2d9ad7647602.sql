-- PR 1 — Migração aditiva em customers (segura, reversível, sem mudar comportamento atual)

-- 1) Garantir pgcrypto disponível para cifra opcional da senha da distribuidora
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2) Adicionar colunas (todas NULLABLE; defaults compatíveis com hardcode atual do worker)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS orgao_expedidor TEXT,
  ADD COLUMN IF NOT EXISTS fornecedora TEXT,
  ADD COLUMN IF NOT EXISTS contaunica BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS possui_placas BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS transferir_titularidade BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS logindistribuidora TEXT,
  ADD COLUMN IF NOT EXISTS senhadistribuidora TEXT,            -- valor cifrado (pgp_sym_encrypt) gravado pelo worker
  ADD COLUMN IF NOT EXISTS pj_jsonb JSONB,
  ADD COLUMN IF NOT EXISTS procurador_jsonb JSONB,
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS data_nascimento_iso DATE;            -- espelho seguro; coluna TEXT original permanece intacta

COMMENT ON COLUMN public.customers.orgao_expedidor IS 'Órgão emissor do documento (ex: SSP/SP). Opcional.';
COMMENT ON COLUMN public.customers.fornecedora IS 'Fornecedora resolvida via /bonus/rules. Persistida pelo worker após cadastro.';
COMMENT ON COLUMN public.customers.contaunica IS 'Cliente possui conta única / múltiplas instalações.';
COMMENT ON COLUMN public.customers.possui_placas IS 'Já possui placas solares instaladas.';
COMMENT ON COLUMN public.customers.transferir_titularidade IS 'Cadastro exige transferência de titularidade da conta.';
COMMENT ON COLUMN public.customers.logindistribuidora IS 'Login do site da distribuidora (opcional, leitura automática).';
COMMENT ON COLUMN public.customers.senhadistribuidora IS 'Senha cifrada via pgp_sym_encrypt. NUNCA gravar em texto puro.';
COMMENT ON COLUMN public.customers.pj_jsonb IS 'Dados de Pessoa Jurídica (cnpj, razão social, etc) quando aplicável.';
COMMENT ON COLUMN public.customers.procurador_jsonb IS 'Dados do procurador / testemunhas quando aplicável.';
COMMENT ON COLUMN public.customers.terms_accepted_at IS 'Timestamp do acceptTerms confirmado no Portal iGreen.';
COMMENT ON COLUMN public.customers.data_nascimento_iso IS 'Espelho DATE de data_nascimento (TEXT). Para relatórios/queries tipadas.';

-- 3) Backfill best-effort de data_nascimento_iso a partir do TEXT existente
-- Aceita YYYY-MM-DD e DD/MM/YYYY. Qualquer formato fora disso permanece NULL (sem erro).
UPDATE public.customers
SET data_nascimento_iso = (data_nascimento)::date
WHERE data_nascimento_iso IS NULL
  AND data_nascimento ~ '^\d{4}-\d{2}-\d{2}$';

UPDATE public.customers
SET data_nascimento_iso = to_date(data_nascimento, 'DD/MM/YYYY')
WHERE data_nascimento_iso IS NULL
  AND data_nascimento ~ '^\d{2}/\d{2}/\d{4}$';

-- 4) Backfill best-effort de fornecedora a partir do último trace de auditoria por customer
-- Usa apenas leitura; se a tabela estiver vazia ou sem o campo, nada é alterado.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='portal2_audit_traces' AND column_name='result'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='portal2_audit_traces' AND column_name='customer_id'
  ) THEN
    WITH last_trace AS (
      SELECT DISTINCT ON (customer_id)
        customer_id,
        NULLIF(result->>'fornecedora','') AS fornecedora
      FROM public.portal2_audit_traces
      WHERE customer_id IS NOT NULL
        AND result ? 'fornecedora'
      ORDER BY customer_id, created_at DESC NULLS LAST
    )
    UPDATE public.customers c
    SET fornecedora = lt.fornecedora
    FROM last_trace lt
    WHERE c.id = lt.customer_id
      AND c.fornecedora IS NULL
      AND lt.fornecedora IS NOT NULL;
  END IF;
END$$;

-- 5) Backfill best-effort de pj_jsonb / procurador_jsonb a partir de input_summary
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='portal2_audit_traces' AND column_name='input_summary'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='portal2_audit_traces' AND column_name='customer_id'
  ) THEN
    -- PJ
    WITH last_pj AS (
      SELECT DISTINCT ON (customer_id)
        customer_id,
        input_summary AS payload
      FROM public.portal2_audit_traces
      WHERE customer_id IS NOT NULL
        AND input_summary ? 'cnpj'
      ORDER BY customer_id, created_at DESC NULLS LAST
    )
    UPDATE public.customers c
    SET pj_jsonb = lp.payload
    FROM last_pj lp
    WHERE c.id = lp.customer_id
      AND c.pj_jsonb IS NULL;

    -- Procurador / testemunhas
    WITH last_proc AS (
      SELECT DISTINCT ON (customer_id)
        customer_id,
        input_summary AS payload
      FROM public.portal2_audit_traces
      WHERE customer_id IS NOT NULL
        AND (input_summary ? 'testemunha_nome' OR input_summary ? 'procurador_nome')
      ORDER BY customer_id, created_at DESC NULLS LAST
    )
    UPDATE public.customers c
    SET procurador_jsonb = lpr.payload
    FROM last_proc lpr
    WHERE c.id = lpr.customer_id
      AND c.procurador_jsonb IS NULL;
  END IF;
END$$;

-- 6) Trigger leve para manter data_nascimento_iso em sincronia quando data_nascimento muda
CREATE OR REPLACE FUNCTION public.sync_data_nascimento_iso()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.data_nascimento IS DISTINCT FROM OLD.data_nascimento OR TG_OP = 'INSERT' THEN
    IF NEW.data_nascimento ~ '^\d{4}-\d{2}-\d{2}$' THEN
      BEGIN
        NEW.data_nascimento_iso := (NEW.data_nascimento)::date;
      EXCEPTION WHEN OTHERS THEN
        -- mantém valor anterior em caso de erro de cast
        NULL;
      END;
    ELSIF NEW.data_nascimento ~ '^\d{2}/\d{2}/\d{4}$' THEN
      BEGIN
        NEW.data_nascimento_iso := to_date(NEW.data_nascimento, 'DD/MM/YYYY');
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_data_nascimento_iso ON public.customers;
CREATE TRIGGER trg_sync_data_nascimento_iso
BEFORE INSERT OR UPDATE OF data_nascimento ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.sync_data_nascimento_iso();