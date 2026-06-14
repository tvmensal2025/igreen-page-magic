-- ============================================================
-- Token público curto e legível para propostas
-- 2026-06-14
-- ============================================================
--
-- Problema: o token padrão era encode(gen_random_bytes(18), 'hex') = 36
-- caracteres hexadecimais (ex: e590463775ce03e977641ae9db913bd0b476). A URL
-- /proposta/:token ficava longa e visualmente poluída.
--
-- Solução: uma função que gera um token CURTO (12 caracteres), URL-safe, com
-- alfabeto sem caracteres ambíguos (sem 0/O/1/l/I). 12 caracteres em um
-- alfabeto de 31 símbolos ≈ 59 bits de entropia — continua inviável de
-- adivinhar, e o índice UNIQUE em public_token cobre eventual colisão.
--
-- NÃO-DESTRUTIVO: só altera o DEFAULT da coluna. Tokens já existentes (links
-- já enviados) continuam válidos — a leitura é por match exato, sem validar
-- formato nem tamanho. Apenas propostas novas nascem com o token curto.

-- ─── 1) Função geradora de token curto ──────────────────────────────
CREATE OR REPLACE FUNCTION public.gen_proposal_token(p_len integer DEFAULT 12)
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  -- Alfabeto Crockford-like, sem caracteres ambíguos (0/O/1/l/I) e sem
  -- símbolos que precisem de escape em URL. 31 símbolos.
  v_alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_alpha_len constant integer := length(v_alphabet);
  v_bytes bytea;
  v_token text := '';
  i integer;
BEGIN
  IF p_len < 1 THEN
    p_len := 12;
  END IF;

  v_bytes := gen_random_bytes(p_len);
  FOR i IN 0 .. p_len - 1 LOOP
    -- get_byte devolve 0..255; mapeia no alfabeto via módulo.
    v_token := v_token || substr(
      v_alphabet,
      (get_byte(v_bytes, i) % v_alpha_len) + 1,
      1
    );
  END LOOP;

  RETURN v_token;
END;
$$;

COMMENT ON FUNCTION public.gen_proposal_token(integer) IS
  'Gera um token curto, URL-safe e sem caracteres ambíguos para a URL pública /proposta/:token.';

-- ─── 2) Novo DEFAULT da coluna public_token ─────────────────────────
ALTER TABLE public.proposals
  ALTER COLUMN public_token SET DEFAULT public.gen_proposal_token(12);
