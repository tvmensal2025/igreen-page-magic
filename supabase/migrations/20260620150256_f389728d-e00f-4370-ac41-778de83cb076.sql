ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS link_facial_sent_at timestamptz;