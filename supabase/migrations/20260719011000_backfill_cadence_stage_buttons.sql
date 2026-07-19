-- ContentContract: seed botões nos stages WA (B/C) onde buttons IS NULL.
-- Valores = exatamente o fallback hardcoded de cadence-stage-buttons.ts.
-- Aditivo: não sobrescreve linhas já editadas pelo painel Multicanal.

UPDATE public.cadence_stage_config
SET
  buttons = CASE stage
    WHEN 'COLD_1' THEN '[{"id":"bill_low","title":"Até R$300"},{"id":"bill_mid","title":"R$300 a R$700"},{"id":"bill_high","title":"Acima de R$700"}]'::jsonb
    WHEN 'COLD_2' THEN '[{"id":"bill_low","title":"Até R$300"},{"id":"bill_mid","title":"R$300 a R$700"},{"id":"bill_high","title":"Acima de R$700"}]'::jsonb
    WHEN 'COLD_3' THEN '[{"id":"bill_low","title":"Até R$300"},{"id":"bill_mid","title":"R$300 a R$700"},{"id":"bill_high","title":"Acima de R$700"}]'::jsonb
    WHEN 'COLD_4' THEN '[{"id":"analyze","title":"Quero analisar"},{"id":"call_me","title":"Pode me ligar"},{"id":"stop","title":"Encerrar"}]'::jsonb
    WHEN 'RECALL_60D' THEN '[{"id":"bill_low","title":"Até R$300"},{"id":"bill_mid","title":"R$300 a R$700"},{"id":"bill_high","title":"Acima de R$700"}]'::jsonb
    WHEN 'RECALL_90D' THEN '[{"id":"bill_low","title":"Até R$300"},{"id":"bill_mid","title":"R$300 a R$700"},{"id":"bill_high","title":"Acima de R$700"}]'::jsonb
    WHEN 'RECALL_5M' THEN '[{"id":"bill_low","title":"Até R$300"},{"id":"bill_mid","title":"R$300 a R$700"},{"id":"bill_high","title":"Acima de R$700"}]'::jsonb
    WHEN 'RECALL_8M' THEN '[{"id":"bill_low","title":"Até R$300"},{"id":"bill_mid","title":"R$300 a R$700"},{"id":"bill_high","title":"Acima de R$700"}]'::jsonb
    WHEN 'RECALL_12M' THEN '[{"id":"bill_low","title":"Até R$300"},{"id":"bill_mid","title":"R$300 a R$700"},{"id":"bill_high","title":"Acima de R$700"}]'::jsonb
    WHEN 'RECALL_YEARLY' THEN '[{"id":"bill_low","title":"Até R$300"},{"id":"bill_mid","title":"R$300 a R$700"},{"id":"bill_high","title":"Acima de R$700"}]'::jsonb
    ELSE buttons
  END,
  updated_at = now()
WHERE consultant_id IS NULL
  AND buttons IS NULL
  AND stage IN (
    'COLD_1', 'COLD_2', 'COLD_3', 'COLD_4',
    'RECALL_60D', 'RECALL_90D', 'RECALL_5M', 'RECALL_8M', 'RECALL_12M', 'RECALL_YEARLY'
  );
