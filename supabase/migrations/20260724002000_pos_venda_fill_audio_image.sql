-- Garante áudio + imagem em todos os estágios pós-venda (padrão + todos consultores).
-- Retentativa herda mídia do reprovado; gaps herdam do default (pode repetir).

UPDATE public.pos_venda_default_media AS t
SET
  message_type = 'audio',
  media_url = src.media_url,
  image_url = src.image_url,
  is_active = true,
  updated_at = now()
FROM public.pos_venda_default_media AS src
WHERE t.stage = 'retentativa'
  AND src.stage = 'reprovado';

-- Qualquer default sem mídia herda do d30 (áudio+imagem já existentes).
UPDATE public.pos_venda_default_media AS t
SET
  message_type = 'audio',
  media_url = COALESCE(NULLIF(t.media_url, ''), src.media_url),
  image_url = COALESCE(NULLIF(t.image_url, ''), src.image_url),
  updated_at = now()
FROM public.pos_venda_default_media AS src
WHERE src.stage = 'd30'
  AND t.stage IN ('aprovado','reprovado','retentativa','d30','d60','d90','d120','d150','d180','d210')
  AND (
    t.media_url IS NULL OR t.media_url = '' OR
    t.image_url IS NULL OR t.image_url = '' OR
    t.message_type IS DISTINCT FROM 'audio'
  );

-- Garante kanban stages para todos consultores (por segurança).
INSERT INTO public.kanban_stages (
  consultant_id, stage_key, label, color, position, stage_scope,
  auto_message_enabled, auto_message_type
)
SELECT c.id::text, v.stage_key, v.label, v.color, v.position, 'pos_venda', true, 'audio'
FROM public.consultants c
CROSS JOIN (VALUES
  ('pv_aprovado', 'Aprovado', '#16a34a', 10),
  ('pv_reprovado', 'Reprovado', '#dc2626', 20),
  ('pv_retentativa', 'Retentativa', '#ea580c', 25),
  ('pv_d30', '30 dias', '#2563eb', 30),
  ('pv_d60', '60 dias', '#2563eb', 40),
  ('pv_d90', '90 dias', '#7c3aed', 50),
  ('pv_d120', '120 dias', '#7c3aed', 60),
  ('pv_d150', '150 dias', '#7c3aed', 70),
  ('pv_d180', '180 dias', '#7c3aed', 80),
  ('pv_d210', '210 dias', '#c026d3', 90)
) AS v(stage_key, label, color, position)
ON CONFLICT (consultant_id, stage_key) DO NOTHING;

-- Insere stage_auto_messages faltantes a partir do default (áudio+imagem+texto).
INSERT INTO public.stage_auto_messages (
  stage_id, consultant_id, position, message_type, message_text, media_url, image_url, delay_seconds
)
SELECT
  ks.id,
  ks.consultant_id,
  0,
  'audio',
  def.message_text,
  def.media_url,
  def.image_url,
  0
FROM public.kanban_stages ks
JOIN public.pos_venda_default_media def
  ON def.stage = CASE ks.stage_key
    WHEN 'pv_aprovado' THEN 'aprovado'
    WHEN 'pv_reprovado' THEN 'reprovado'
    WHEN 'pv_retentativa' THEN 'retentativa'
    WHEN 'pv_d30' THEN 'd30'
    WHEN 'pv_d60' THEN 'd60'
    WHEN 'pv_d90' THEN 'd90'
    WHEN 'pv_d120' THEN 'd120'
    WHEN 'pv_d150' THEN 'd150'
    WHEN 'pv_d180' THEN 'd180'
    WHEN 'pv_d210' THEN 'd210'
    ELSE NULL
  END
WHERE ks.stage_scope = 'pos_venda'
  AND def.stage IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.stage_auto_messages sam WHERE sam.stage_id = ks.id
  );

-- Completa gaps (sem apagar mídia custom já preenchida).
UPDATE public.stage_auto_messages sam
SET
  message_type = 'audio',
  media_url = COALESCE(NULLIF(sam.media_url, ''), def.media_url),
  image_url = COALESCE(NULLIF(sam.image_url, ''), def.image_url),
  message_text = COALESCE(NULLIF(sam.message_text, ''), def.message_text)
FROM public.kanban_stages ks
JOIN public.pos_venda_default_media def
  ON def.stage = CASE ks.stage_key
    WHEN 'pv_aprovado' THEN 'aprovado'
    WHEN 'pv_reprovado' THEN 'reprovado'
    WHEN 'pv_retentativa' THEN 'retentativa'
    WHEN 'pv_d30' THEN 'd30'
    WHEN 'pv_d60' THEN 'd60'
    WHEN 'pv_d90' THEN 'd90'
    WHEN 'pv_d120' THEN 'd120'
    WHEN 'pv_d150' THEN 'd150'
    WHEN 'pv_d180' THEN 'd180'
    WHEN 'pv_d210' THEN 'd210'
    ELSE NULL
  END
WHERE sam.stage_id = ks.id
  AND ks.stage_scope = 'pos_venda'
  AND def.stage IS NOT NULL
  AND (
    sam.media_url IS NULL OR sam.media_url = '' OR
    sam.image_url IS NULL OR sam.image_url = '' OR
    sam.message_type IS DISTINCT FROM 'audio'
  );
