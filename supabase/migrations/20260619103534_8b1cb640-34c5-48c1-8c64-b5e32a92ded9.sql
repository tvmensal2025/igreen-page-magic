-- 1. Drop triggers que forçavam capture_mode='manual'
DROP TRIGGER IF EXISTS set_default_capture_mode ON public.customers;
DROP TRIGGER IF EXISTS customers_default_capture_mode ON public.customers;
DROP FUNCTION IF EXISTS public.set_default_capture_mode() CASCADE;
DROP FUNCTION IF EXISTS public.customers_default_capture_mode() CASCADE;

-- 2. Alterar default da coluna capture_mode
ALTER TABLE public.customers ALTER COLUMN capture_mode SET DEFAULT 'auto';

-- 3. Backfill recente: leads dos últimos 30 dias em manual viram auto
UPDATE public.customers
SET capture_mode = 'auto'
WHERE capture_mode = 'manual'
  AND created_at > now() - interval '30 days';

-- 4. Default e backfill de portal_kind para 'autoconexao' (Portal 2)
ALTER TABLE public.consultants ALTER COLUMN portal_kind SET DEFAULT 'autoconexao';
UPDATE public.consultants SET portal_kind = 'autoconexao' WHERE portal_kind IS DISTINCT FROM 'autoconexao';