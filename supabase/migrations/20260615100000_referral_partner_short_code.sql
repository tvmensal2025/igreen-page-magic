-- ============================================================
-- Código curto numérico por parceiro indicador (short_code)
-- 2026-06-15
-- ============================================================
--
-- Problema: o link curto do parceiro precisava de um identificador na URL para
-- resolver o parceiro indicador no servidor. Usar a keyword expõe a palavra-chave
-- pessoal do consultor (ex.: nome próprio) na URL pública. Usar o UUID do parceiro
-- deixa a URL longa e feia (ex.: 77c1e2f6-e144-4638-8751-b2fb95bbf9c4).
--
-- Solução: um código CURTO, NUMÉRICO e NEUTRO por parceiro (6 dígitos), único
-- por consultor. A URL final fica `igreen.cloud/r/{licenca}/{short_code}` — curta,
-- legível e sem expor a keyword. O servidor resolve o parceiro por (consultant_id,
-- short_code) e monta a frase com a keyword (preservando a atribuição).
--
-- NÃO-DESTRUTIVO (ADD-only): adiciona coluna + índice + função geradora e faz o
-- backfill dos parceiros existentes. Nenhuma coluna é removida ou alterada de tipo.
-- A keyword e a qr_phrase continuam intactas e funcionando como antes.

-- ─── 1) Função geradora de código curto numérico ────────────────────
-- 6 dígitos = 900.000 combinações (100000–999999). A unicidade real é garantida
-- pelo índice único por consultor + retry no INSERT; aqui só geramos o candidato.
CREATE OR REPLACE FUNCTION public.gen_partner_short_code(p_len integer DEFAULT 6)
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_digits constant text := '0123456789';
  v_code text := '';
  v_first text;
  i integer;
BEGIN
  IF p_len < 4 THEN
    p_len := 6;
  END IF;

  -- Primeiro dígito de 1–9 (evita zero à esquerda, mantém o tamanho fixo).
  v_first := substr('123456789', (get_byte(gen_random_bytes(1), 0) % 9) + 1, 1);
  v_code := v_first;

  FOR i IN 2 .. p_len LOOP
    v_code := v_code || substr(
      v_digits,
      (get_byte(gen_random_bytes(1), 0) % 10) + 1,
      1
    );
  END LOOP;

  RETURN v_code;
END;
$$;

COMMENT ON FUNCTION public.gen_partner_short_code(integer) IS
  'Gera um código curto numérico (6 dígitos por padrão) para o link curto do parceiro: igreen.cloud/r/{licenca}/{short_code}.';

-- ─── 2) Coluna short_code (aditiva) ─────────────────────────────────
ALTER TABLE public.referral_partners
  ADD COLUMN IF NOT EXISTS short_code TEXT;

COMMENT ON COLUMN public.referral_partners.short_code IS
  'Código curto numérico, único por consultor, usado no link curto /r/{licenca}/{short_code}. Não expõe a keyword pessoal.';

-- ─── 3) Backfill: gera short_code único por consultor p/ quem não tem ─
-- Loop com retry por linha: tenta um candidato e, se colidir dentro do mesmo
-- consultor, tenta de novo. Volume é baixo (parceiros por consultor), então o
-- custo é desprezível.
DO $$
DECLARE
  r RECORD;
  v_candidate text;
  v_tries integer;
BEGIN
  FOR r IN
    SELECT id, consultant_id
    FROM public.referral_partners
    WHERE short_code IS NULL
  LOOP
    v_tries := 0;
    LOOP
      v_candidate := public.gen_partner_short_code(6);
      v_tries := v_tries + 1;
      -- Único dentro do mesmo consultor?
      IF NOT EXISTS (
        SELECT 1 FROM public.referral_partners
        WHERE consultant_id = r.consultant_id
          AND short_code = v_candidate
      ) THEN
        UPDATE public.referral_partners
          SET short_code = v_candidate
          WHERE id = r.id;
        EXIT;
      END IF;
      -- Trava de segurança: evita loop infinito em caso patológico.
      IF v_tries >= 50 THEN
        RAISE NOTICE 'short_code: não foi possível gerar código único para parceiro % após % tentativas', r.id, v_tries;
        EXIT;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ─── 4) Índice único por consultor ──────────────────────────────────
-- Permite NULL (parceiros que por algum motivo não receberam código não quebram),
-- mas garante que dois parceiros do MESMO consultor nunca compartilhem o código.
CREATE UNIQUE INDEX IF NOT EXISTS referral_partners_consultant_short_code_uniq
  ON public.referral_partners (consultant_id, short_code)
  WHERE short_code IS NOT NULL;
