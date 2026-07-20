-- Trava canônica: Grupo A (Sofia Multicanal) — nunca F (CEMIG 2) como padrão.
-- Não apaga o fluxo F; só desativa e corrige settings/leads ativos.

-- 1) Reheat: default A (antes era F)
UPDATE public.daily_reheat_settings
SET flow_variant = 'A',
    updated_at = now()
WHERE coalesce(flow_variant, '') <> 'A';

-- 2) Consultor Rafael: só variante A no sorteio
UPDATE public.consultants
SET active_variants = ARRAY['A']::text[]
WHERE id = '0c2711ad-4836-41e6-afba-edd94f698ae3'
  AND (
    active_variants IS NULL
    OR active_variants <> ARRAY['A']::text[]
  );

-- 3) Desativa Fluxo F (CEMIG 2) — não apaga
UPDATE public.bot_flows
SET is_active = false,
    updated_at = now()
WHERE consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3'
  AND variant = 'F'
  AND is_active = true;

-- 4) Leads ativos fora de A → volta para A (não mexe em pós-cadastro terminal)
UPDATE public.customers
SET flow_variant = 'A',
    updated_at = now()
WHERE consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3'
  AND coalesce(flow_variant, '') <> 'A'
  AND coalesce(do_not_contact, false) = false
  AND coalesce(status, '') NOT IN (
    'registered_igreen',
    'cadastro_concluido',
    'awaiting_signature',
    'awaiting_facial',
    'active',
    'approved',
    'complete',
    'rejected'
  );
