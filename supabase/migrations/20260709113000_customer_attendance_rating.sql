-- Avaliação de atendimento profissional (1–5) ao finalizar.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS attendance_ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS attendance_rating_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS attendance_rating smallint,
  ADD COLUMN IF NOT EXISTS attendance_rating_at timestamptz;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_attendance_rating_check;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_attendance_rating_check
  CHECK (attendance_rating IS NULL OR (attendance_rating >= 1 AND attendance_rating <= 5));
