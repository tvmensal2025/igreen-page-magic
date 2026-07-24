-- Pós-venda: marco d180 (após d150) + texto padrão + colunas kanban.

ALTER TABLE public.consultant_pos_venda_media
  DROP CONSTRAINT IF EXISTS consultant_pos_venda_media_stage_check;
ALTER TABLE public.consultant_pos_venda_media
  ADD CONSTRAINT consultant_pos_venda_media_stage_check
  CHECK (stage IN ('aprovado','reprovado','d30','d60','d90','d120','d150','d180'));

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
SELECT c.id::text, 'pv_d180', '180 dias', '#a855f7', 80, 'pos_venda', false, 'text'
FROM public.consultants c
ON CONFLICT (consultant_id, stage_key) DO NOTHING;

INSERT INTO public.pos_venda_default_media AS p (
  stage, message_type, message_text, media_url, image_url, is_active, updated_at
)
SELECT
  'd180',
  coalesce(d.message_type, 'audio'),
  $txt$Olá, {{nome}}.

Tudo bem?

Hoje estamos passando para mais um acompanhamento da sua jornada com a iGreen.

Já se passaram cerca de 180 dias desde a aprovação do seu cadastro, e queremos, antes de tudo, agradecer pela confiança em fazer parte da nossa história.

Se você já está recebendo a sua economia na conta de energia, esperamos que ela esteja fazendo a diferença todos os meses. Esse é o propósito da iGreen: ajudar milhares de famílias a economizar de forma simples e sustentável.

Se a sua ativação ainda não foi concluída, fique tranquilo.

Alguns processos realmente podem levar mais tempo, dependendo da distribuidora e das etapas de integração. Nossa equipe continua acompanhando o seu processo e você não precisa realizar nenhuma ação neste momento. Basta aguardar.

Enquanto isso, continue aproveitando o iGreen Club.

No aplicativo você encontra benefícios exclusivos, cashback, consulta de faturas, novidades da iGreen e acesso aos nossos produtos e serviços.

Você também pode conhecer o iGreen Seguros, com soluções para proteger seu carro, moto e outros patrimônios, além de acompanhar as novidades do Telecon e de outros benefícios que a iGreen disponibiliza aos seus clientes.

Hoje, a iGreen já conta com mais de 700 mil clientes em todo o Brasil, e é uma grande satisfação ter você fazendo parte dessa comunidade que cresce a cada dia.

E lembre-se: se você conhece alguém que também gostaria de economizar na conta de energia, indique essa pessoa para a nossa equipe. Além de ajudar alguém a reduzir os gastos mensais, você também pode receber cashback pelas indicações aprovadas, conforme as regras do programa.

Muito obrigado pela confiança.

É um privilégio ter você conosco.

Conte sempre com a gente. Nossa equipe continuará acompanhando o seu processo até a conclusão e estará sempre pronta para ajudar no que você precisar.

Um grande abraço da equipe iGreen.$txt$,
  d.media_url,
  d.image_url,
  true,
  now()
FROM public.pos_venda_default_media d
WHERE d.stage = 'd150'
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
  AND ks.stage_key = 'pv_d180'
  AND def.stage = 'd180'
  AND NOT EXISTS (
    SELECT 1 FROM public.stage_auto_messages sam WHERE sam.stage_id = ks.id
  );
