UPDATE public.customers
SET media_consumo = GREATEST(100, LEAST(2000, ROUND(electricity_bill_value / 1.10)::int))
WHERE id = '146137eb-8c3b-4bd8-b014-7e2d4f3e30a8'
  AND media_consumo IS NULL
  AND electricity_bill_value IS NOT NULL
  AND electricity_bill_value >= 30;