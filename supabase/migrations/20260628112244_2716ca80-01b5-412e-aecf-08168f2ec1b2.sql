UPDATE public.whatsapp_instances
SET status = 'disabled',
    connected_phone = NULL,
    manual_review_required = true,
    fatal_disconnect_reason = 409,
    fatal_disconnect_at = COALESCE(fatal_disconnect_at, now()),
    fatal_lock_until = now() + interval '100 years',
    updated_at = now()
WHERE id = 'dfa94168-321a-4d4c-81c1-bfffeeaa61e2';

UPDATE public.whatsapp_instances
SET fatal_lock_until = NULL,
    fatal_disconnect_reason = NULL,
    manual_review_required = false,
    updated_at = now()
WHERE id = '8d4d140d-d157-4974-b149-15304d294762';