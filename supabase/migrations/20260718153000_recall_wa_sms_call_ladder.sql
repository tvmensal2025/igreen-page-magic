-- Grupo C: cada marco longo = WA análise → SMS se silêncio → ligação se silêncio.
-- Novos estágios OFF por padrão. Não liga automação.

ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'RECALL_60D_SMS';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'RECALL_60D_CALL';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'RECALL_90D_SMS';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'RECALL_90D_CALL';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'RECALL_5M_SMS';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'RECALL_5M_CALL';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'RECALL_8M_SMS';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'RECALL_8M_CALL';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'RECALL_12M_SMS';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'RECALL_12M_CALL';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'RECALL_YEARLY_SMS';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'RECALL_YEARLY_CALL';
