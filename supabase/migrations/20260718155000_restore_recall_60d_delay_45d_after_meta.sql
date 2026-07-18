-- Mantém o encurtamento de 20260718154000 (1080h → 336h ≈ 14d após Meta/ads).
-- NÃO restaurar 45d: espera longa demais para o 1º recall.
-- Idempotente: garante delay_hours = 336 no seed global.

UPDATE public.cadence_stage_config
SET delay_hours = 336, updated_at = now()
WHERE consultant_id IS NULL AND stage::text = 'RECALL_60D';

UPDATE public.automation_toggles
SET description = 'Marco longo ~30d após Dia 10: WA análise → SMS se silêncio → ligação (delay 14d após Meta/ads).'
WHERE key = 'cadence_recall_60d';
