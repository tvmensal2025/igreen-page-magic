-- Texto padrão pós-venda (aprovado): Olá {{nome}} + {{saudacao}} (dia/tarde/noite BRT).
-- Variáveis resolvidas em _shared/outbound-template-vars.ts no envio.

UPDATE public.pos_venda_default_media
SET
  message_text = $txt$Olá, {{nome}}.

{{saudacao}}.

Eu tenho uma notícia muito especial para te dar.

Seu cadastro na iGreen foi aprovado. Parabéns!

Isso significa que a análise foi concluída com sucesso e que você já faz parte da iGreen.

Agora começa a etapa de ativação do seu benefício na conta de energia.

Esse processo pode levar, em média, de 90 a 120 dias, porque depende das etapas operacionais e também da sua distribuidora de energia.

Mas eu tenho outra ótima notícia para você.

Não esqueça de baixar o seu iGreen Club.

No aplicativo, você encontra descontos e vantagens em milhares de estabelecimentos e ofertas por todo o Brasil.

São benefícios em farmácias, restaurantes, cinemas, lojas, serviços, academias, lazer, educação, viagens e muito mais.

Nas farmácias participantes, você poderá encontrar descontos especiais que, em algumas ofertas e medicamentos selecionados, podem chegar a 70%.

Os descontos e os estabelecimentos disponíveis podem variar de acordo com a sua cidade e com as condições de cada parceiro. Por isso, consulte sempre as ofertas atualizadas diretamente no aplicativo iGreen Club.

Ou seja: enquanto aguarda a ativação da economia na sua conta de energia, você já pode começar a aproveitar outras formas de economizar no seu dia a dia.

E quero que você saiba de uma coisa muito importante:

a nossa equipe continuará acompanhando todo o seu processo.

Se surgir qualquer dúvida sobre a ativação, sobre o aplicativo, sobre o iGreen Club ou sobre o seu benefício, estamos aqui para ajudar.

Obrigado pela confiança.

Estamos muito felizes em ter você com a gente.

Seja muito bem-vindo à iGreen.

Parabéns pela aprovação.$txt$,
  updated_at = now()
WHERE stage = 'aprovado';

-- Rafael: stage_auto_messages do aprovado tinha só áudio (texto null) —
-- sem isso o padrão institucional não entrava no envio.
UPDATE public.stage_auto_messages sam
SET message_text = (
  SELECT message_text FROM public.pos_venda_default_media WHERE stage = 'aprovado' LIMIT 1
)
FROM public.kanban_stages ks
WHERE sam.stage_id = ks.id
  AND ks.stage_scope = 'pos_venda'
  AND ks.stage_key = 'pv_aprovado'
  AND ks.consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3';
