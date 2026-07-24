-- Texto padrão pós-venda d30: check-in + iGreen Club + indicação/cashback.

UPDATE public.pos_venda_default_media
SET
  message_text = $txt$Olá, {{nome}}.

Tudo bem?

Já faz cerca de 30 dias desde a aprovação do seu cadastro na iGreen, e eu passei para saber como está a sua experiência.

Você já conseguiu acessar o iGreen Club?

Muita gente acaba esquecendo de explorar o aplicativo e acaba deixando passar descontos que já estão disponíveis.

No iGreen Club você encontra vantagens em farmácias, restaurantes, cinemas, academias, lojas, serviços, viagens, educação e milhares de outras ofertas em todo o Brasil.

Enquanto isso, a ativação do benefício na sua conta de energia continua seguindo o fluxo normal, que costuma levar de 90 a 120 dias.

E eu queria fazer um convite especial.

Se você conhece algum familiar, amigo, vizinho ou colega de trabalho que também gostaria de economizar todos os meses na conta de energia, indique essa pessoa para conversar com a nossa equipe.

Além de ajudar alguém a gastar menos todos os meses, você também pode receber cashback pelas indicações válidas, conforme as regras do programa de indicação da iGreen.

É uma forma de transformar economia em benefício para quem você gosta e, ao mesmo tempo, ser reconhecido por isso.

Se lembrar de alguém agora, basta responder esta mensagem. Nós cuidamos de todo o atendimento, explicamos como funciona e acompanhamos a pessoa do início ao fim.

Obrigado pela confiança.

E lembre-se: conte sempre com a gente. Estamos aqui para acompanhar você em cada etapa da sua jornada com a iGreen.$txt$,
  updated_at = now()
WHERE stage = 'd30';

UPDATE public.stage_auto_messages sam
SET message_text = (
  SELECT message_text FROM public.pos_venda_default_media WHERE stage = 'd30' LIMIT 1
)
FROM public.kanban_stages ks
WHERE sam.stage_id = ks.id
  AND ks.stage_scope = 'pos_venda'
  AND ks.stage_key = 'pv_d30'
  AND ks.consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3';
