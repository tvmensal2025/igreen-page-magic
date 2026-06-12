ALTER TABLE public.consultants ALTER COLUMN cerebro_ativo SET DEFAULT 'on';
UPDATE public.consultants SET cerebro_ativo = 'on' WHERE cerebro_ativo IS DISTINCT FROM 'on';