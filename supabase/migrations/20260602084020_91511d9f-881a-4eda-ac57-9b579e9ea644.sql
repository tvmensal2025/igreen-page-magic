
INSERT INTO public.message_templates (consultant_id, name, content, shortcut, is_quick_reply) VALUES
('0c2711ad-4836-41e6-afba-edd94f698ae3','Boas-vindas v1 (curta)','Oi {{first_name}}! Vi que você se interessou pelo desconto na conta de luz 💡
Em 1 pergunta rápida: quanto vem sua conta de luz hoje? (média)','/oi1', true),
('0c2711ad-4836-41e6-afba-edd94f698ae3','Boas-vindas v2 (benefício)','Oi {{first_name}}, na maioria dos casos a gente reduz a conta em 15-20%, sem obra e sem custo. Posso ver se rola pra você? Me manda o valor médio 👇','/oi2', true),
('0c2711ad-4836-41e6-afba-edd94f698ae3','Boas-vindas v3 (prova social)','Oi {{first_name}} 👋 Já são +500 mil pessoas economizando com a iGreen.
Pra te dizer se cabe no seu caso, me passa o valor médio da sua conta?','/oi3', true),
('0c2711ad-4836-41e6-afba-edd94f698ae3','Follow-up 1h','{{first_name}}, ainda dá pra continuar de onde paramos? 🙂','/fup1h', true),
('0c2711ad-4836-41e6-afba-edd94f698ae3','Follow-up 24h','{{first_name}}, ontem você perguntou sobre desconto na luz.
Se quiser, te mando uma simulação rápida — só preciso do valor da conta 📊','/fup24h', true),
('0c2711ad-4836-41e6-afba-edd94f698ae3','Follow-up 72h','{{first_name}}, vou separar 5 minutos hoje pra te montar a simulação.
Manda só o valor da conta que eu cuido do resto 💚','/fup72h', true),
('0c2711ad-4836-41e6-afba-edd94f698ae3','Follow-up 7d','{{first_name}}, vou deixar essa porta aberta. Quando quiser, é só responder qualquer coisa que eu retomo de onde paramos.','/fup7d', true),
('0c2711ad-4836-41e6-afba-edd94f698ae3','Objeção: é golpe?','Entendo 100% sua preocupação. A iGreen é regulamentada pela ANEEL (Lei 14.300), atende +500 mil clientes e tem CNPJ ativo. Você não paga nada — só sua conta de luz, mas com desconto.','/golpe', true),
('0c2711ad-4836-41e6-afba-edd94f698ae3','Objeção: fidelidade','Sem fidelidade. Pode cancelar quando quiser, sem multa, sem burocracia.','/fidelidade', true),
('0c2711ad-4836-41e6-afba-edd94f698ae3','Objeção: preço','O cadastro é 100% gratuito. Você continua pagando sua conta normalmente, mas com 15-20% de desconto aplicado automaticamente.','/preco', true),
('0c2711ad-4836-41e6-afba-edd94f698ae3','Objeção: como funciona','Funciona assim: você continua recebendo sua conta da distribuidora normal, só que com créditos de energia limpa descontados. Sem obra, sem instalação, sem trocar nada na sua casa.','/comofunciona', true),
('0c2711ad-4836-41e6-afba-edd94f698ae3','Objeção: e se der problema','Se algo der errado, é só pedir cancelamento — sem multa. Sua conta segue 100% igual com a distribuidora.','/problema', true),
('0c2711ad-4836-41e6-afba-edd94f698ae3','Objeção: vou pensar / depois','Tranquilo, {{first_name}}! Me diz: prefere que eu te chame amanhã ou semana que vem? (e qual horário é melhor pra você)','/depois', true),
('0c2711ad-4836-41e6-afba-edd94f698ae3','Objeção: já tenho desconto','Que ótimo! Posso simular pra ver se nossa proposta cobre o que você já tem? Sem compromisso — em 2 minutos eu te respondo.','/jadesconto', true),
('0c2711ad-4836-41e6-afba-edd94f698ae3','Objeção: medo de mexer','Você não mexe em *nada* da sua instalação elétrica. Continua tudo igual — só muda quem te dá os créditos de energia. É só burocracia digital.','/medo', true),
('0c2711ad-4836-41e6-afba-edd94f698ae3','Objeção: quem são vocês','Somos parceiros oficiais iGreen Energy. Te mando link com CNPJ e ANEEL se quiser confirmar.','/quemsomos', true)
ON CONFLICT DO NOTHING;
