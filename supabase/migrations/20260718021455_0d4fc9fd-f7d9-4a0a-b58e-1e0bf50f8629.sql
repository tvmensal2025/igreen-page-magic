-- Backfill: aplica timeout de 24h em leads presos por takeover automático (humano_assumiu_whatsapp)
-- sem expiração. Sem isso, ~centenas de leads ficam presos para sempre.
UPDATE public.customers
SET bot_paused_until = now() + interval '24 hours',
    updated_at = now()
WHERE bot_paused = true
  AND bot_paused_reason = 'humano_assumiu_whatsapp'
  AND bot_paused_until IS NULL;