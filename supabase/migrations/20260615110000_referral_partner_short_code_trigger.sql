-- ============================================================
-- Trigger: gera short_code automático no INSERT de parceiro
-- 2026-06-15
-- ============================================================
--
-- Complemento da migration 20260615100000_referral_partner_short_code.sql:
-- aquela criou a coluna, o índice único e fez o backfill dos parceiros já
-- existentes. Esta garante que TODO parceiro NOVO nasça com um short_code
-- único por consultor — sem depender do client enviar nada.
--
-- POR QUE NO BANCO (e não no front):
--   • atomicidade — o código é gerado e checado na mesma transação do INSERT;
--   • independência — qualquer caminho de insert (client RLS, RPC, seed) ganha
--     o código de graça;
--   • o client continua igual (insert RLS-aware), sem nova lógica de geração.
--
-- NÃO-DESTRUTIVO (ADD-only): cria função de trigger + trigger. Não altera dados
-- nem colunas existentes. Se o short_code já vier preenchido, é respeitado.

-- ─── 1) Função de trigger ───────────────────────────────────────────
-- Gera um candidato numérico (gen_partner_short_code) e repete enquanto colidir
-- com outro parceiro DO MESMO consultor. Volume por consultor é baixo, então o
-- número de tentativas é desprezível na prática.
CREATE OR REPLACE FUNCTION public.referral_partner_set_short_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_candidate text;
  v_tries integer := 0;
BEGIN
  -- Respeita um código já informado explicitamente (idempotente em re-inserts).
  IF NEW.short_code IS NOT NULL AND NEW.short_code <> '' THEN
    RETURN NEW;
  END IF;

  LOOP
    v_candidate := public.gen_partner_short_code(6);
    v_tries := v_tries + 1;

    -- Único dentro do mesmo consultor?
    IF NOT EXISTS (
      SELECT 1 FROM public.referral_partners
      WHERE consultant_id = NEW.consultant_id
        AND short_code = v_candidate
    ) THEN
      NEW.short_code := v_candidate;
      RETURN NEW;
    END IF;

    -- Trava de segurança: em caso patológico, não trava o INSERT pra sempre.
    -- Deixa NULL (o índice único permite NULL) e o link cai no fallback wa.me.
    IF v_tries >= 50 THEN
      RAISE NOTICE 'referral_partner_set_short_code: sem código único para consultor % após % tentativas', NEW.consultant_id, v_tries;
      RETURN NEW;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.referral_partner_set_short_code() IS
  'Preenche short_code (único por consultor) no INSERT de referral_partners quando não informado.';

-- ─── 2) Trigger BEFORE INSERT ───────────────────────────────────────
DROP TRIGGER IF EXISTS trg_referral_partner_short_code ON public.referral_partners;
CREATE TRIGGER trg_referral_partner_short_code
  BEFORE INSERT ON public.referral_partners
  FOR EACH ROW
  EXECUTE FUNCTION public.referral_partner_set_short_code();
