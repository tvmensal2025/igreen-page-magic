-- Ativa Sofia Multicanal (variant C) em produção — consultor Rafael.
-- Idempotente: não altera outros consultores nem força bot_global_enabled.

-- 1) Rafael recebe 100% dos leads novos na variant C (Sofia).
UPDATE public.consultants
SET active_variants = ARRAY['C']::text[],
    updated_at = now()
WHERE id = '0c2711ad-4836-41e6-afba-edd94f698ae3'
  AND active_variants IS DISTINCT FROM ARRAY['C']::text[];

-- 2) Garante fluxo Sofia C ativo (10 passos Grupo A).
UPDATE public.bot_flows
SET is_active = true,
    name = 'Sofia — Ativação Multicanal',
    sync_mode = 'custom',
    updated_at = now()
WHERE id = '59f53614-196c-4b6f-a029-59fadca78bd7';

-- 3) Desativa clones legados C (se existirem) que não são Sofia.
UPDATE public.bot_flows
SET is_active = false,
    updated_at = now()
WHERE consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3'
  AND variant = 'C'
  AND id <> '59f53614-196c-4b6f-a029-59fadca78bd7'
  AND is_active = true;
