-- Escada Grupo A no enum cadence_stage.
-- Sem esses valores, queries .in('stage', [..., 'A_NUDGE', ...]) falham
-- e a pizza A/B/C fica vazia.
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'A_NUDGE';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'A_SMS';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'A_CALL';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'A_CALL_RETRY';
