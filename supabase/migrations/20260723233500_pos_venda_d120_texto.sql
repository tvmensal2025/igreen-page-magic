-- Texto padrão pós-venda d120: acompanhamento economia + Club + tranquilidade.

UPDATE public.pos_venda_default_media
SET
  message_text = $txt$Olá, {{nome}}.

Tudo bem?

Hoje estamos passando para mais um acompanhamento da sua jornada com a iGreen.

Já faz cerca de 120 dias desde a aprovação do seu cadastro.

É importante saber que muitos clientes já começam a visualizar a economia diretamente na conta de energia nessa fase. Se esse já é o seu caso, ficamos muito felizes por você.

Se a economia ainda não apareceu na sua fatura, fique tranquilo.

Isso faz parte do processo. Cada distribuidora possui seus próprios prazos e etapas de integração, por isso alguns clientes recebem o benefício antes e outros um pouco depois.

O mais importante é que nossa equipe continua acompanhando o seu processo para que tudo aconteça da forma correta.

Enquanto isso, continue aproveitando o iGreen Club, acompanhando suas informações, suas faturas, os benefícios disponíveis e todas as novidades preparadas para os clientes iGreen.

Se surgir qualquer dúvida, estamos sempre à disposição para ajudar.

Muito obrigado pela confiança.

Conte sempre com a gente. Estamos acompanhando você até a conclusão do seu benefício e continuaremos ao seu lado sempre que precisar.

Um grande abraço da equipe iGreen.$txt$,
  updated_at = now()
WHERE stage = 'd120';

UPDATE public.stage_auto_messages sam
SET message_text = (
  SELECT message_text FROM public.pos_venda_default_media WHERE stage = 'd120' LIMIT 1
)
FROM public.kanban_stages ks
WHERE sam.stage_id = ks.id
  AND ks.stage_scope = 'pos_venda'
  AND ks.stage_key = 'pv_d120'
  AND ks.consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3';
