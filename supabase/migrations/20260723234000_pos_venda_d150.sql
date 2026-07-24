-- Pós-venda: marco d150 (após d120) + texto padrão + colunas kanban.

-- 1) CHECK consultant_pos_venda_media (se existir)
ALTER TABLE public.consultant_pos_venda_media
  DROP CONSTRAINT IF EXISTS consultant_pos_venda_media_stage_check;
ALTER TABLE public.consultant_pos_venda_media
  ADD CONSTRAINT consultant_pos_venda_media_stage_check
  CHECK (stage IN ('aprovado','reprovado','d30','d60','d90','d120','d150'));

-- 2) RPC de estágio temporal
DROP FUNCTION IF EXISTS public.compute_pos_venda_stage(timestamptz, text, text);
CREATE OR REPLACE FUNCTION public.compute_pos_venda_stage(
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
    WHEN now() - _reference_at >= interval '150 days' THEN 'd150'
    WHEN now() - _reference_at >= interval '120 days' THEN 'd120'
    WHEN now() - _reference_at >= interval '90 days'  THEN 'd90'
    WHEN now() - _reference_at >= interval '60 days'  THEN 'd60'
    WHEN now() - _reference_at >= interval '30 days'  THEN 'd30'
    ELSE 'aprovado'
  END;
$$;

-- 3) Coluna kanban pv_d150 para todos os consultores
INSERT INTO public.kanban_stages (
  consultant_id, stage_key, label, color, position, stage_scope,
  auto_message_enabled, auto_message_type
)
SELECT c.id::text, 'pv_d150', '150 dias', '#8b5cf6', 70, 'pos_venda', false, 'text'
FROM public.consultants c
ON CONFLICT (consultant_id, stage_key) DO NOTHING;

-- 4) Texto + mídia padrão (herda image/audio de d120 se existirem)
INSERT INTO public.pos_venda_default_media AS p (
  stage, message_type, message_text, media_url, image_url, is_active, updated_at
)
SELECT
  'd150',
  coalesce(d.message_type, 'audio'),
  $txt$Olá, {{nome}}.

Tudo bem?

Estamos passando para fazer mais um acompanhamento da sua jornada com a iGreen.

Se você já está recebendo a sua economia na conta de energia, ficamos muito felizes. Esperamos que esse benefício faça a diferença todos os meses para você e sua família.

Se o seu benefício ainda não apareceu na sua fatura, fique tranquilo.

Em alguns casos, a ativação pode levar um pouco mais de tempo. Isso faz parte do processo. Neste momento, você não precisa fazer nada, apenas aguardar.

Nossa equipe continua acompanhando o seu cadastro e, assim que houver qualquer novidade, você será informado.

Enquanto isso, aproveite tudo o que a iGreen oferece.

Pelo aplicativo iGreen Club, você pode acompanhar suas informações, consultar suas faturas, aproveitar cashback, conhecer novos benefícios e acessar outros serviços disponíveis para os clientes.

Você também pode conhecer o iGreen Seguros, que oferece opções para proteger seu carro, moto, caminhão e outros patrimônios com condições especiais para clientes.

E outra novidade é o Telecon, um serviço pensado para trazer ainda mais praticidade e conveniência para quem faz parte da iGreen.

Hoje, já somos mais de 700 mil clientes espalhados por todo o Brasil, todos com o mesmo objetivo: economizar e aproveitar cada vez mais benefícios.

É uma alegria ter você fazendo parte dessa história e dessa comunidade que cresce a cada dia.

Muito obrigado pela confiança.

E lembre-se: conte sempre com a gente. Estamos acompanhando o seu processo e continuaremos ao seu lado sempre que precisar.

Um grande abraço da equipe iGreen.$txt$,
  d.media_url,
  d.image_url,
  true,
  now()
FROM (SELECT 1) _
LEFT JOIN public.pos_venda_default_media d ON d.stage = 'd120'
ON CONFLICT (stage) DO UPDATE SET
  message_text = EXCLUDED.message_text,
  media_url = COALESCE(EXCLUDED.media_url, p.media_url),
  image_url = COALESCE(EXCLUDED.image_url, p.image_url),
  is_active = true,
  updated_at = now();

-- 5) Stage auto message do Rafael (espelha padrão; mídia do d120 se houver)
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
  AND ks.stage_key = 'pv_d150'
  AND def.stage = 'd150'
  AND NOT EXISTS (
    SELECT 1 FROM public.stage_auto_messages sam WHERE sam.stage_id = ks.id
  );
