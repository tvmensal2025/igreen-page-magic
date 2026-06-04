-- Arquiva o template legado com typo (não some do banco, só sai da galeria)
UPDATE public.ad_templates
SET status = 'archived', updated_at = now()
WHERE title ILIKE 'Uberladia%' AND status <> 'archived';

-- Insere o template oficial Uberlândia + 100km (vídeo de 28%).
-- Idempotente: se já existir um template com este título exato, atualiza os campos chave.
INSERT INTO public.ad_templates (
  title,
  description,
  headline,
  primary_text,
  description_text,
  photos,
  age_min,
  age_max,
  genders,
  suggested_daily_budget_cents,
  status,
  target_distribuidora_ids,
  target_cidades,
  video_url,
  creative_mode,
  consultant_id
) VALUES (
  'Uberlândia + 100km — 28% Análise (Vídeo)',
  'Replicação da campanha que já gerou 24 leads em MG. Vídeo Rodrigo & Daine + cidades num raio de ~100 km de Uberlândia.',
  'Análise grátis: até 28% de economia na sua conta de luz',
  E'Você sabia que pode economizar até 28% na sua conta de luz Cemig em {cidade}?\n\nFazemos uma análise gratuita em 2 minutos pelo WhatsApp — sem instalação, sem obra, sem mudar a empresa que já te atende.\n\nClique em ENVIAR MENSAGEM e descubra quanto você economiza esse mês.',
  'Energia mais barata, sem complicação.',
  '[]'::jsonb,
  28,
  65,
  ARRAY['all'],
  7000,
  'published',
  ARRAY['cemig-mg'],
  ARRAY['Uberlândia','Araguari','Uberaba','Patrocínio','Ituiutaba','Araxá'],
  'https://zlzasfhcxcznaprrragl.supabase.co/storage/v1/object/public/consultant-photos/0c2711ad-4836-41e6-afba-edd94f698ae3/ads/video-1780505616446-Rodrigo_e_daine.mp4',
  'video',
  NULL
)
ON CONFLICT DO NOTHING;

-- Se um template com este título já existir (rodada anterior), atualiza video_url + cidades para garantir frescor
UPDATE public.ad_templates
SET
  video_url = 'https://zlzasfhcxcznaprrragl.supabase.co/storage/v1/object/public/consultant-photos/0c2711ad-4836-41e6-afba-edd94f698ae3/ads/video-1780505616446-Rodrigo_e_daine.mp4',
  creative_mode = 'video',
  status = 'published',
  target_distribuidora_ids = ARRAY['cemig-mg'],
  target_cidades = ARRAY['Uberlândia','Araguari','Uberaba','Patrocínio','Ituiutaba','Araxá'],
  suggested_daily_budget_cents = 7000,
  age_min = 28,
  age_max = 65,
  updated_at = now()
WHERE title = 'Uberlândia + 100km — 28% Análise (Vídeo)';