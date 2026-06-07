UPDATE public.ai_media_library
SET active = false, updated_at = now()
WHERE slot_key = 'boas_vindas'
  AND id <> 'e822e37a-761e-4017-ad7c-bec61c0a4ebe'
  AND active = true;