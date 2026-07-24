-- Texto padrão pós-venda d90: acompanhamento + Club + Cruzeiro iGreen + indicação.

UPDATE public.pos_venda_default_media
SET
  message_text = $txt$Olá, {{nome}}.

Tudo bem?

Hoje estou passando para fazer mais um acompanhamento da sua jornada com a iGreen.

Já faz cerca de 90 dias desde a aprovação do seu cadastro, e queremos agradecer pela confiança e pela paciência durante esse processo.

Nossa equipe continua acompanhando cada etapa da sua ativação e, sempre que houver uma atualização importante, você será informado.

Enquanto isso, não deixe de aproveitar tudo o que a iGreen já oferece para você.

No iGreen Club, você pode acompanhar suas informações, consultar suas faturas, acessar seus benefícios, aproveitar cashback, conhecer novos produtos e serviços e ficar por dentro de todas as novidades.

E quero lembrar você de um benefício muito especial.

Como cliente iGreen, você participa da campanha do Cruzeiro iGreen.

Ao manter suas faturas em dia e seguir as regras da campanha, você participa do sorteio de uma cabine para duas pessoas. Por isso, acompanhe sempre o aplicativo para não perder nenhuma novidade e conferir todos os detalhes da promoção.

E tem mais.

Se você conhece alguém que também gostaria de economizar na conta de energia, indique essa pessoa.

Além de ajudar um amigo ou familiar a reduzir a conta de luz todos os meses, você também pode receber cashback pelas indicações aprovadas, conforme as regras do programa da iGreen.

Nossa equipe cuida de todo o atendimento, tira todas as dúvidas e acompanha o cliente do começo ao fim.

A iGreen foi criada para ajudar você a economizar de várias formas, e estamos muito felizes por fazer parte dessa jornada.

Muito obrigado pela confiança.

E lembre-se de uma coisa:

Conte sempre com a gente. Sempre que precisar, nossa equipe estará pronta para ajudar você.

Um grande abraço e até a próxima.
Equipe iGreen.$txt$,
  updated_at = now()
WHERE stage = 'd90';

UPDATE public.stage_auto_messages sam
SET message_text = (
  SELECT message_text FROM public.pos_venda_default_media WHERE stage = 'd90' LIMIT 1
)
FROM public.kanban_stages ks
WHERE sam.stage_id = ks.id
  AND ks.stage_scope = 'pos_venda'
  AND ks.stage_key = 'pv_d90'
  AND ks.consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3';
