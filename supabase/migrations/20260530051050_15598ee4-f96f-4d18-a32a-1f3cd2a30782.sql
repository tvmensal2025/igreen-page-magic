UPDATE public.customers
SET
  media_consumo = GREATEST(100, LEAST(2000, ROUND(electricity_bill_value / 1.10)::int)),
  portal2_status = CASE WHEN portal2_status = 'failed' THEN 'retry_ready' ELSE portal2_status END,
  error_message = NULL,
  updated_at = now()
WHERE id = 'bd64e790-fc71-4c0a-81d7-e285004b105d'
  AND media_consumo IS NULL
  AND electricity_bill_value IS NOT NULL
  AND electricity_bill_value >= 30;