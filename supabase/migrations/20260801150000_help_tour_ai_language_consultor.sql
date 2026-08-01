-- Atualiza textos do tour + base da IA para nomes reais da UI.
-- Consultor nunca deve ver Evolution/Whapi; só "WhatsApp".
-- Não apaga seções — só corrige conteúdo.

UPDATE public.ai_knowledge_sections
SET content = E'Este sistema é uma plataforma completa com:\n- Painel com indicadores\n- CRM (Clientes interessados e Clientes ativos)\n- WhatsApp integrado (conectar pelo QR Code)\n- Central de anúncios (Anúncio inteligente e Anúncio completo)\n- Links e materiais de divulgação\n- Financeiro (boletos, recebíveis e carteira)\n- Academy e suporte com IA dentro do painel',
    updated_at = now()
WHERE title = 'SEÇÃO 12 — SOBRE O PAINEL DO CONSULTOR';

UPDATE public.ai_knowledge_sections
SET content = E'P: Como cadastro / atendo um cliente novo?\nR: No painel, abra Clientes interessados (ou Captação). O lead geralmente chega pelo WhatsApp ou anúncio. Abra o card, veja a conversa e siga as etapas do atendimento. O cadastro de energia do cliente é feito pelo fluxo do WhatsApp/portal — não existe mais uma aba chamada "Novo Cliente" para isso.\n\nP: Como acompanho o status do cliente?\nR: Clientes interessados = quem ainda está em conversa/cadastro. Clientes ativos = quem já enviou cadastro / está em análise na iGreen, aprovado ou no pós-venda.\n\nP: Como pego meu link de divulgação?\nR: Menu → Links → Meus Links. Copie o link do produto e teste antes de divulgar.\n\nP: O WhatsApp do painel é meu número ou da iGreen?\nR: É o seu. Você conecta o WhatsApp pelo QR Code na aba WhatsApp. Prefira um chip de anúncio dedicado.\n\nP: Posso usar a assistente automática para responder leads?\nR: Sim — o atendimento automático ajuda no WhatsApp. Se você responder na mão, a automação daquela conversa pode pausar; reative quando quiser devolver.\n\nP: Como crio anúncios no Facebook/Instagram?\nR: Menu → Central de anúncios → Anúncio inteligente (recomendado) ou Anúncio completo. Depois acompanhe em Campanhas ou Resultados.\n\nP: Onde vejo minhas comissões e boletos?\nR: Menu → Financeiro (Boletos, Recebíveis, Carteira Green).\n\nP: Como indico um parceiro?\nR: Menu → Parceiros → Novo Parceiro → copie o link exclusivo.\n\nP: Como peço ajuda?\nR: Botão verde de ajuda (?) no canto da tela → Perguntar ao suporte com IA, ou Central de ajuda.',
    updated_at = now()
WHERE title = 'FAQ 6 — OPERAÇÃO DO PAINEL (LICENCIADO)';

UPDATE public.ai_knowledge_sections
SET content = E'1. Seja sempre positivo, encorajador e profissional\n2. Use emojis com moderação (1-2 por mensagem)\n3. Respostas curtas e diretas (máximo 3-4 parágrafos)\n4. Se não souber, direcione para o consultor ou suporte humano\n5. NUNCA invente informações, preços, botões ou políticas\n6. Incentive o cadastro quando fizer sentido\n7. NÃO invente valores de comissão — diga que o consultor confirma na conversa / Financeiro\n8. NUNCA diga Evolution, Whapi ou nomes técnicos de API de WhatsApp — diga só WhatsApp\n9. Use nomes exatos da tela: Central de anúncios, Anúncio inteligente, Mensagens prontas, Clientes interessados, Clientes ativos\n10. Informe canais oficiais só quando estiverem nesta base de conhecimento',
    updated_at = now()
WHERE title = 'REGRAS DE RESPOSTA DA IA';

UPDATE public.ai_knowledge_sections
SET title = 'SEÇÃO 14 — PROMOÇÕES (CONFIRMAR COM PATROCINADOR)',
    content = E'Promoções e bônus mudam com frequência.\n\nQuando o lead perguntar sobre promoção, bônus, maratona ou evento:\n1. NÃO cite valores ou prêmios de campanhas antigas como se estivessem válidos hoje\n2. Diga que o consultor confirma as condições atuais na conversa\n3. Se houver promoção ativa publicada pelo administrador nesta base, use só esse texto\n4. Incentive o cadastro / contato com o consultor sem inventar número',
    updated_at = now()
WHERE title LIKE 'SEÇÃO 14 — PROMOÇÕES%';

UPDATE public.tour_steps
SET body = E'Sem WhatsApp conectado, você não recebe nem responde contatos pela plataforma.\n\nUse um número de anúncio: um chip dedicado só para esta operação (leads e campanhas).\n\nComo conectar:\n1. Abra WhatsApp no menu\n2. Clique em Conectar WhatsApp\n3. Leia o QR Code com o celular do número escolhido\n\n[[ALERT]]\nCUIDADO — não use o número pessoal do dia a dia\nConectar o WhatsApp que você já usa no cotidiano aumenta o risco de bloqueio. Anúncios e volume de mensagens podem fazer o WhatsApp restringir o número. Prefira um chip só para anúncios.\n[[/ALERT]]',
    updated_at = now()
WHERE order_index = 3 AND title ILIKE '%WhatsApp%';

UPDATE public.tour_steps
SET body = E'Acompanhe campanhas do Facebook e Instagram, custo e contatos.\n\nPara criar: use Anúncio inteligente (recomendado) ou Anúncio completo nesta mesma Central de anúncios. Depois veja Campanhas ou Resultados.',
    updated_at = now()
WHERE order_index = 9 AND title ILIKE '%anúncios%';
