ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS ocr_consumo_rejeitado boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ocr_consumo_original integer;

UPDATE public.customers
SET ocr_consumo_original = media_consumo,
    media_consumo = 1433,
    ocr_consumo_rejeitado = true
WHERE phone_whatsapp LIKE '%11971254913%'
  AND media_consumo = 555;