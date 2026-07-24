-- Texto padrão pós-venda reprovado: indeferido + nova análise em ~60 dias.

UPDATE public.pos_venda_default_media
SET
  message_text = $txt$Olá, {{nome}}.

Tudo bem?

Estamos entrando em contato para informar o resultado da análise do seu cadastro.

Neste momento, infelizmente, não foi possível aprovar a sua solicitação.

Isso não significa que você não poderá fazer parte da iGreen no futuro.

As análises são realizadas com base em critérios técnicos e operacionais, e algumas situações podem impedir a aprovação nesta etapa.

A boa notícia é que você poderá participar de uma nova análise.

Dentro de aproximadamente 60 dias, nossa equipe entrará em contato novamente para verificar se já existe a possibilidade de realizar um novo processo de avaliação.

Até lá, não é necessário fazer nenhuma ação. Assim que chegar o momento, nós mesmos faremos contato com você.

Agradecemos pela confiança e pela oportunidade de apresentar a iGreen.

Esperamos poder dar uma notícia positiva na próxima análise.

Muito obrigado pela compreensão.

E lembre-se: conte sempre com a gente. Estaremos à disposição para esclarecer qualquer dúvida e acompanharemos você em uma nova oportunidade.

Um grande abraço da equipe iGreen.$txt$,
  updated_at = now()
WHERE stage = 'reprovado';

UPDATE public.stage_auto_messages sam
SET message_text = (
  SELECT message_text FROM public.pos_venda_default_media WHERE stage = 'reprovado' LIMIT 1
)
FROM public.kanban_stages ks
WHERE sam.stage_id = ks.id
  AND ks.stage_scope = 'pos_venda'
  AND ks.stage_key = 'pv_reprovado'
  AND ks.consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3';
