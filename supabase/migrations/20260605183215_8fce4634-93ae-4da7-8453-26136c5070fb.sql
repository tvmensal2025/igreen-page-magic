UPDATE public.customers
SET bot_paused = false,
    bot_paused_reason = NULL,
    bot_paused_at = NULL
WHERE bot_paused = true
  AND bot_paused_reason = 'silent_handoff_empty_reply';