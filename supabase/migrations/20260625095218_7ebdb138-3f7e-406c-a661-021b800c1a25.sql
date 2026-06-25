ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS otp_pending_replay boolean NOT NULL DEFAULT false;