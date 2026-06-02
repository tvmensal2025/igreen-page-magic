
DELETE FROM public.customers
WHERE is_test_lead = true
   OR is_sandbox   = true
   OR name ILIKE '%test%'
   OR name ILIKE '%warmup%'
   OR name ILIKE '%simulad%'
   OR name ILIKE '%simulator%'
   OR name ILIKE '%simular%'
   OR phone_whatsapp LIKE '550000%'
   OR phone_whatsapp LIKE '5555%'
   OR phone_whatsapp LIKE '1111%'
   OR phone_whatsapp LIKE '0000%';
