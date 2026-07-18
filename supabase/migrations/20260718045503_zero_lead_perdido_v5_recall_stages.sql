-- Zero Lead Perdido v5 — parte 1: só enums (precisa commit antes de usar nos INSERTs).
-- Seeds ficam em 20260718045504_zero_lead_perdido_v5_recall_seeds.sql

ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'RETARGET_ADS_15D';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'RECALL_60D';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'RECALL_90D';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'RECALL_5M';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'RECALL_8M';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'RECALL_12M';
ALTER TYPE public.cadence_stage ADD VALUE IF NOT EXISTS 'RECALL_YEARLY';
