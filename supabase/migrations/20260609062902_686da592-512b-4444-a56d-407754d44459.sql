
ALTER TABLE public.consultant_pos_venda_media
  ADD COLUMN IF NOT EXISTS send_order text[] NOT NULL DEFAULT ARRAY['text','audio','image','video'];
