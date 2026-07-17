-- Sofia Multicanal passa a ser variante A (Grupo A como base).
-- Desativa variante C para novos leads — idempotente, não apaga fluxos nem migrations antigas.

-- Rafael: único consultor com active_variants = ['C'] (Sofia).
UPDATE public.consultants
SET active_variants = ARRAY['A']::text[]
WHERE id = '0c2711ad-4836-41e6-afba-edd94f698ae3'
  AND active_variants IS NOT DISTINCT FROM ARRAY['C']::text[];

-- Move o fluxo Sofia de C → A (mesmo registro, mesmos passos).
UPDATE public.bot_flows
SET variant = 'A',
    name = 'Sofia — Ativação Multicanal',
    sync_mode = 'custom',
    updated_at = now()
WHERE id = '59f53614-196c-4b6f-a029-59fadca78bd7'
  AND variant = 'C';

-- Leads já atribuídos à variante C seguem no mesmo fluxo (agora A).
UPDATE public.customers
SET flow_variant = 'A',
    updated_at = now()
WHERE consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3'
  AND flow_variant = 'C';

COMMENT ON COLUMN public.bot_flows.variant IS
  'Letra interna do slot de fluxo. Sofia Multicanal (Grupo A) usa variante A desde 2026-07-17.';
