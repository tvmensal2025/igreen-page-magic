
-- Forçar TODOS os consultores no Fluxo D
UPDATE public.consultants SET active_variants = ARRAY['D']::text[] WHERE active_variants IS DISTINCT FROM ARRAY['D']::text[];

-- Garantir que o modo global A/B continua only_D
INSERT INTO public.settings (key, value)
VALUES ('flow_ab_mode', 'only_D')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Para todos os consultores sem Fluxo D ativo, criar referência ao público (sync_mode=public)
INSERT INTO public.bot_flows (consultant_id, variant, is_active, is_public, sync_mode, name)
SELECT c.id, 'D', true, false, 'public', 'Fluxo Padrão (D)'
FROM public.consultants c
WHERE NOT EXISTS (
  SELECT 1 FROM public.bot_flows bf
  WHERE bf.consultant_id = c.id AND bf.variant = 'D' AND bf.is_active = true
);
