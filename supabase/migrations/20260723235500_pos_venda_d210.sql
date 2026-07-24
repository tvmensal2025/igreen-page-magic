-- Pós-venda: marco d210 (após d180) + texto institucional.

ALTER TABLE public.consultant_pos_venda_media
  DROP CONSTRAINT IF EXISTS consultant_pos_venda_media_stage_check;
ALTER TABLE public.consultant_pos_venda_media
  ADD CONSTRAINT consultant_pos_venda_media_stage_check
  CHECK (stage IN ('aprovado','reprovado','d30','d60','d90','d120','d150','d180','d210'));

DROP FUNCTION IF EXISTS public.compute_pos_venda_stage(timestamptz, text, text);
CREATE FUNCTION public.compute_pos_venda_stage(
  _reference_at timestamptz,
  _status text,
  _andamento text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _status IN ('rejected','cancelled','canceled') THEN 'reprovado'
    WHEN _andamento IS NOT NULL AND _andamento ~* 'reprov|cancel' THEN 'reprovado'
    WHEN _reference_at IS NULL THEN 'espera'
    WHEN now() - _reference_at >= interval '210 days' THEN 'd210'
    WHEN now() - _reference_at >= interval '180 days' THEN 'd180'
    WHEN now() - _reference_at >= interval '150 days' THEN 'd150'
    WHEN now() - _reference_at >= interval '120 days' THEN 'd120'
    WHEN now() - _reference_at >= interval '90 days'  THEN 'd90'
    WHEN now() - _reference_at >= interval '60 days'  THEN 'd60'
    WHEN now() - _reference_at >= interval '30 days'  THEN 'd30'
    ELSE 'aprovado'
  END;
$$;

INSERT INTO public.kanban_stages (
  consultant_id, stage_key, label, color, position, stage_scope,
  auto_message_enabled, auto_message_type
)
SELECT c.id::text, 'pv_d210', '210 dias', '#c026d3', 90, 'pos_venda', false, 'text'
FROM public.consultants c
ON CONFLICT (consultant_id, stage_key) DO NOTHING;

INSERT INTO public.pos_venda_default_media AS p (
  stage, message_type, message_text, media_url, image_url, is_active, updated_at
)
SELECT
  'd210',
  coalesce(d.message_type, 'audio'),
  $txt$Olá, {{nome}}.

Tudo bem?

Hoje estamos passando para mais um acompanhamento da sua jornada com a iGreen.

Antes de qualquer coisa, queremos agradecer pela confiança.

A iGreen nasceu com um propósito muito claro: levar economia, sustentabilidade e benefícios reais para a vida das pessoas.

Hoje, milhares de famílias em todo o Brasil já fazem parte desse movimento, economizando na conta de energia e aproveitando um ecossistema completo de soluções, com benefícios exclusivos, cashback, seguros, campanhas especiais e muito mais.

E você faz parte dessa história.

Se o seu benefício já foi ativado, esperamos que essa economia esteja fazendo a diferença todos os meses.

Se ainda não apareceu na sua conta de energia, fique tranquilo.

Alguns processos realmente levam mais tempo e isso faz parte da operação. O mais importante é que nossa equipe continua acompanhando tudo para você.

Enquanto isso, continue aproveitando tudo o que a iGreen oferece pelo aplicativo iGreen Club.

Lá você encontra suas informações, acompanha suas faturas, conhece novos produtos, acessa benefícios exclusivos e fica por dentro de todas as novidades preparadas para os clientes.

A iGreen continua investindo em tecnologia, inovação e novos serviços para entregar cada vez mais valor aos seus clientes.

E nós temos muito orgulho de ter você conosco.

Muito obrigado pela confiança.

Conte sempre com a gente. Seguiremos acompanhando o seu processo e estaremos ao seu lado sempre que precisar.

Um grande abraço da equipe iGreen.$txt$,
  d.media_url,
  d.image_url,
  true,
  now()
FROM public.pos_venda_default_media d
WHERE d.stage = 'd180'
ON CONFLICT (stage) DO UPDATE SET
  message_text = EXCLUDED.message_text,
  media_url = COALESCE(EXCLUDED.media_url, p.media_url),
  image_url = COALESCE(EXCLUDED.image_url, p.image_url),
  is_active = true,
  updated_at = now();

INSERT INTO public.stage_auto_messages (
  stage_id, consultant_id, position, message_type, message_text, media_url, image_url, delay_seconds
)
SELECT
  ks.id,
  '0c2711ad-4836-41e6-afba-edd94f698ae3'::uuid,
  0,
  coalesce(def.message_type, 'audio'),
  def.message_text,
  def.media_url,
  def.image_url,
  0
FROM public.kanban_stages ks
CROSS JOIN public.pos_venda_default_media def
WHERE ks.consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3'
  AND ks.stage_scope = 'pos_venda'
  AND ks.stage_key = 'pv_d210'
  AND def.stage = 'd210'
  AND NOT EXISTS (
    SELECT 1 FROM public.stage_auto_messages sam WHERE sam.stage_id = ks.id
  );
