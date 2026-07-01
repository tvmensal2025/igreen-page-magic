
CREATE OR REPLACE VIEW public.v_boletos_carteira
WITH (security_invoker=on) AS
SELECT
  b.id,
  b.consultant_id,
  b.customer_id,
  b.idcliente,
  b.nome,
  b.cidade,
  b.uf,
  b.mes_referencia,
  b.total,
  b.valor_fornecedora,
  b.valor_distribuidora,
  b.vencimento,
  b.pagamento,
  b.status,
  b.dias_atraso,
  b.injecao,
  b.kwh_compensado,
  b.conta_unica,
  b.fornecedora,
  b.tipo_pagamento,
  b.url_invoice,
  b.url_boleto,
  b.synced_at,
  b.updated_at,
  c.phone_whatsapp,
  c.name AS customer_name
FROM public.igreen_customer_boletos b
LEFT JOIN public.customers c ON c.id = b.customer_id;

GRANT SELECT ON public.v_boletos_carteira TO authenticated;
GRANT SELECT ON public.v_boletos_carteira TO service_role;
