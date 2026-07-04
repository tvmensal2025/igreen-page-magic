-- Remove permissão ampla antiga de criação para visitantes.
REVOKE INSERT ON public.consultants FROM anon;

-- Reabre somente as colunas mínimas necessárias para o formulário público de cadastro.
GRANT INSERT (id, name, license, phone, cadastro_url, igreen_id, approved)
ON public.consultants TO anon;