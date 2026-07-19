-- ContentContract Fase 2 (aditiva, sem remoção):
-- coluna opcional de botões por estágio no motor de cadência (Grupos B/C).
--
-- Comportamento:
--   * NULL (default de todas as linhas existentes) → cadence-tick usa o
--     fallback hardcoded em cadence-stage-buttons.ts (comportamento atual).
--   * Preenchida pelo painel Multicanal (publicar) → dual-read passa a usar
--     estes botões, validados no runtime (máx 3, título ≤ 25); se inválido,
--     volta ao fallback hardcoded (fail-safe).
--
-- Nada é apagado, nenhum default força envio: coluna nova e opcional.

ALTER TABLE public.cadence_stage_config
  ADD COLUMN IF NOT EXISTS buttons jsonb;

COMMENT ON COLUMN public.cadence_stage_config.buttons IS
  'ContentContract: botões Whapi [{id,title}] editados no painel Multicanal. NULL = fallback hardcoded do motor (cadence-stage-buttons.ts). Validação runtime: máx 3 botões, título <= 25 chars; inválido cai no fallback.';

-- Guarda-corpo no banco (barato e aditivo): se algo gravar aqui, tem que ser
-- array JSON ou NULL. Conteúdo fino (ids/títulos) é validado no runtime.
ALTER TABLE public.cadence_stage_config
  DROP CONSTRAINT IF EXISTS cadence_stage_config_buttons_is_array;
ALTER TABLE public.cadence_stage_config
  ADD CONSTRAINT cadence_stage_config_buttons_is_array
  CHECK (buttons IS NULL OR jsonb_typeof(buttons) = 'array');
