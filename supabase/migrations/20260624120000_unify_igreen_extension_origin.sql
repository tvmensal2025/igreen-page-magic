-- Unifica origem dos clientes sincronizados pela extensão com a carteira iGreen (igreen_sync).
-- Clientes já persistidos no Supabase não dependem de cache do navegador.
UPDATE public.customers
SET customer_origin = 'igreen_sync'
WHERE customer_origin = 'igreen_extension';
