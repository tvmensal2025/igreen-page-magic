
-- Limpa fatal_lock com data absurda (2126) da instância órfã
UPDATE public.whatsapp_instances
SET fatal_lock_until = NULL,
    status = 'disabled',
    updated_at = now()
WHERE instance_name = 'igreen-f9594900e75b'
  AND fatal_lock_until > now() + interval '1 year';

-- Marca instância unknown há >72h como disabled (fora do pool)
UPDATE public.whatsapp_instances
SET status = 'disabled', updated_at = now()
WHERE instance_name = 'igreen-4aa4c026d754'
  AND status = 'unknown'
  AND updated_at < now() - interval '48 hours';

-- Destrava os 2 leads parados >1h em passos intermediários (força re-avaliação
-- pelo bot-stuck-recovery no próximo tick).
UPDATE public.customers
SET updated_at = now() - interval '10 minutes'
WHERE id IN (
  'bacacfdd-81e1-4372-921e-58c71b055d17',
  'f9ed6b43-cbaa-44d6-a692-301657d7e604'
)
AND bot_paused = false;
