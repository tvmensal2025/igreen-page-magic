export const HELP_SYSTEM_KNOWLEDGE = `
DOCUMENTAÇÃO DE NAVEGAÇÃO DA PLATAFORMA IGREEN

Regras para orientar o usuário:
- Dê passos numerados, curtos e na ordem correta.
- Quando houver uma página indicada, termine com: "Abra: [nome] — [rota]".
- Nunca invente botões, estados, valores, políticas ou resultados.
- Se os dados da operação contradisserem um guia geral, explique a situação real e use o guia apenas como orientação.
- Se faltar informação, faça uma pergunta objetiva. Se não houver solução segura, indique o suporte humano.
- Use linguagem simples (consultor não técnico).
- Sempre diga ONDE clicar: nome do item do menu esquerdo, nome da aba e nome do botão, como na UI.
- Prefira 5 a 8 passos curtos. Comece pelo menu (ex.: "No menu esquerdo, clique em WhatsApp"). Evite siglas como DNC; diga "bloqueado" ou "nunca mais contatar".
- Não diga "robô"; diga "assistente automática" ou "atendimento automático".

Primeiros passos
- Painel: /admin?tab=dashboard. Mostra indicadores, avisos e atalhos.
- Academy: /admin?tab=academy. Reúne aulas, avaliações, progresso e anotações.
- Central de ajuda: /ajuda. Permite buscar guias, ver passos, iniciar orientação na tela ("Me leve e explique") e abrir a assistência com IA.
- Botão flutuante de ajuda (canto inferior direito): reinicia o tour, abre a Central ou o suporte com IA.
- Dados da conta: pelo menu Configurações no Painel — nome, ID iGreen, foto e senha.

Clientes e CRM
- Clientes interessados: /admin?tab=crm. Novos contatos em conversa no funil. Abra um contato para ver conversa e dados; atualize a etapa conforme o avanço.
- Clientes ativos: /admin?tab=crm-clientes. Clientes já validados, situação, histórico e dados sincronizados (cadastro em análise fica aqui, não na pizza de novos).
- Base de clientes: /admin?tab=clientes. Pesquisa cadastros e documentos por filtros.
- Conversão: /admin?tab=conversao. Localiza oportunidades paradas, mostra contexto e ajuda a retomar o contato.

WhatsApp e assistência de IA
- Conectar ou reconectar: /admin?tab=whatsapp&section=config. Leia o QR Code com o WhatsApp desejado e aguarde o estado conectado antes de testar. O canal em uso é Whapi; não peça reconectar Evolution só por status antigo.
- Conversas: /admin?tab=whatsapp. Permite ler histórico e responder manualmente. Uma intervenção manual pode pausar a automação; reative-a quando quiser devolver o atendimento.
- Base de conhecimento: /admin/conhecimento. Cadastre conteúdo correto, palavras usadas pelos clientes e teste perguntas reais. Atualize o índice quando a tela solicitar.
- Fluxos de atendimento: /admin/fluxos. Edite mensagens, perguntas e caminhos. Salve e simule antes de ativar.
- Fluxo B e personalidade: /admin/fluxo-b. Ajusta estratégia e comportamento do atendimento correspondente.
- Estúdio de áudio: /admin?tab=audio-studio. Grave ou gere áudios e envie pelo WhatsApp.

Captação e anúncios
- Captação: /admin?tab=captacao. Mostra contatos recebidos por anúncios, páginas e outros canais.
- Central de anúncios: /admin?tab=central-anuncios. Abas Dashboard, Modelos, Campanhas, Performance. Botão Criar campanha. Sincronizar agora / Conectar minha conta quando pedido.
- Meta Ads: /admin/meta-ads. Gerencia conexão, público, criativos, orçamento, publicação e métricas.
- Campanha reprovada: abra /admin/meta-ads, leia o motivo, valide a conexão e o WhatsApp Business, corrija material ou configuração e envie para nova análise. Não afirme a causa sem ler o motivo real.
- Links: /admin?tab=links. Copie páginas vinculadas à licença e teste o endereço antes de compartilhar.
- Materiais: /admin?tab=materiais. Baixe imagens, vídeos e arquivos de divulgação.

Automações
- Agendamentos: /admin?tab=agendamentos. Central para mensagens programadas, campanhas, pós-venda, rodízios e histórico. É o lugar para ligar/desligar automações do dia a dia.
- Motor de cadência: /admin/motor. Configura tentativas por WhatsApp, ligação e SMS, intervalos, limites e horários.
- Reaquecimento: /admin/reaquecimento. Retoma contatos parados com mensagens e intervalos controlados.
- Central operacional: /admin/agendamentos-central. Reúne textos e configurações operacionais avançadas.
- Ligações: /admin?tab=voz. Gerencia campanhas de voz, bases e histórico.

Produtos e vendas
- Produtos e vendas: /admin?tab=produtos. Cria oportunidades, propostas e acompanha etapas comerciais.
- Projeto solar: /admin/solar-design. Analisa endereço e telhado, ajusta painéis e salva o estudo para uso em proposta.
- Parceiros: /admin?tab=parceiros. Cadastra indicadores, links exclusivos, notificações e rodízios.

Financeiro e pós-venda
- Financeiro: /admin?tab=financeiro. Reúne carteira, movimentações, recebíveis e comissões. Sempre confirme período e situação antes de explicar um valor.
- Pós-venda: /admin?tab=crm-clientes. Acompanha aprovação, assinatura, devolutivas e contatos posteriores.
- Carteira de anúncios: fica no contexto financeiro e de Meta Ads. Use os dados atuais do consultor para informar saldo; não invente mínimos ou taxas.

Diagnóstico e suporte
- Saúde do atendimento: /admin/saude-bot.
- Saúde de produção: /admin/saude-producao (uso avançado/admin).
- Monitor do portal: /admin/portal-monitor (uso avançado).
- Reconciliação iGreen: /admin/recon (uso avançado).
- Protocolos: /admin/protocolos (uso avançado).
- Central de ajuda: /ajuda.
- Para suporte com contexto, use o menu flutuante de ajuda e escolha "Perguntar ao suporte com IA".
`;

/** Guias detalhados (onde clicar) — espelho dos guias prioritários do helpCatalog. */
export const HELP_CATALOG_FALLBACK = `
GUIAS DETALHADOS (onde clicar)

[Primeiros passos] Comece por aqui
Abra: /admin?tab=dashboard
1. No canto inferior direito, toque no botão verde de ajuda (?) se quiser repetir esta orientação a qualquer momento.
2. No menu esquerdo, clique em Painel e confira avisos e pendências do dia.
3. Abra Configurações (ícone de engrenagem / menu da conta no topo) e confirme seu nome e ID iGreen.
4. No menu, clique em WhatsApp. Se aparecer Conectar → ou Conectar WhatsApp, leia o QR Code com o celular.
5. No menu, clique em Links → aba Meus Links → escolha um produto → clique em Copiar e teste o endereço no navegador.
6. No menu, clique em Clientes interessados para ver quem já chegou. Abra um card pelo ícone de olho para ver a conversa.
7. Se algo falhar, volte ao botão verde de ajuda e escolha Perguntar ao suporte com IA descrevendo a tela e o que tentou.

[Clientes e CRM] Atenda clientes interessados
Abra: /admin?tab=crm
1. No menu esquerdo (grupo Visão Geral), clique em Clientes interessados.
2. No campo Buscar cliente interessado..., digite nome ou telefone.
3. Use o filtro Parou no passo para achar quem travou em uma etapa.
4. No card desejado, clique no ícone de olho (Ver detalhes, linha do tempo e próxima mensagem).
5. Leia a conversa e os dados capturados; se precisar falar na hora, abra o WhatsApp a partir do contato.
6. Arraste o card entre colunas para atualizar a etapa, ou use o menu ⋮ → Editar.
7. Para incluir alguém na mão: clique em Adicionar Cliente interessado → preencha → Salvar.
8. Se a lista for longa, role até Carregar mais deals.

[Clientes e CRM] Recupere oportunidades
Abra: /admin?tab=conversao
1. No menu esquerdo, clique em Conversão.
2. Na aba Fila, clique em Recarregar se a lista estiver desatualizada.
3. Filtre por Temperatura (Quente, Morno, Frio, Morto, Objeção, Resgate) e por Origem (Meta Ads, WhatsApp, Parceiro).
4. Use Buscar nome / resumo para achar um caso específico.
5. Abra o card, leia o resumo e a próxima ação sugerida.
6. Para vários de uma vez: marque com Selecionar → Todos (ou alguns) → clique em Reativar.
7. Confira também as abas Frases, Resultados e Ajustes se precisar mudar textos ou ver desempenho.

[WhatsApp e IA] Conecte o WhatsApp
Abra: /admin?tab=whatsapp
1. No menu esquerdo (Gestão Comercial), clique em WhatsApp.
2. Se o topo mostrar Conectar → ou status desconectado, continue neste guia.
3. No painel Conexão WhatsApp, clique no botão Conectar WhatsApp.
4. Quando aparecer Escaneie / QR Code, no celular abra WhatsApp → Configurações → Dispositivos conectados → Conectar dispositivo e leia o QR.
5. Se o QR expirar, clique em Gerar novo QR ou Atualizar agora e tente de novo.
6. Espere o status mudar para conectado antes de testar envio de mensagem.
7. Para trocar de chip: clique em Desconectar / trocar chip → confirme em Sim, desconectar → conecte o novo número.
8. Se travar: use Resetar Conexão (com cuidado) e depois Conectar WhatsApp novamente. Não peça “reconectar Evolution” — o canal em uso é este WhatsApp da plataforma.

[WhatsApp e IA] Atenda pelo WhatsApp
Abra: /admin?tab=whatsapp
1. No menu, clique em WhatsApp.
2. Clique na sub-aba Conversas.
3. Clique na conversa na lista à esquerda e leia o histórico.
4. Digite a resposta no campo de mensagem e envie. Resposta manual pode pausar a automação daquela conversa.
5. Clique na sub-aba Atendente IA e confira se a assistente está ativa para o atendimento.
6. Quando quiser devolver à automação, clique na opção de reativar / retomar atendimento automático na conversa (quando aparecer).
7. Outras sub-abas: Envio em Massa, Templates, Agendamentos e Histórico — só clique em Envio em Massa depois de revisar a mensagem.

[WhatsApp e IA] Use o Estúdio de áudio
Abra: /admin?tab=audio-studio
1. No menu (Recursos), clique em Estúdio de áudio.
2. Escolha o tipo: Mutirão, Comércio ou Texto livre.
3. Escolha a voz: Sofia, Diego ou Rafael.
4. Clique em Gerar áudio (o botão mostra o tipo escolhido).
5. Ouça a prévia. Se precisar, clique em Gerar novamente.
6. Clique em Baixar áudio (com ou sem vinheta, conforme as opções da tela).
7. Para usar no atendimento: abra WhatsApp → Conversas e envie o arquivo na conversa desejada.
8. Opcional: Publicar para outros consultores se a tela oferecer e você quiser compartilhar o áudio.

[Captação e anúncios] Acompanhe a captação
Abra: /admin?tab=captacao
1. No menu (Gestão Comercial), clique em Captação.
2. Escolha o período: 48h, 7d, 30d, 60d, 90d ou Todos.
3. Alterne entre as abas Em atendimento e Em espera.
4. Use Buscar nome ou telefone para achar um lead.
5. Marque leads com Selecionar todos ou Só sem atendimento; use Limpar seleção para desmarcar.
6. Clique em Iniciar atendimento nos selecionados quando for assumir a conversa.
7. No card do lead, confira se é o titular ou conta de outro titular antes de seguir o cadastro.

[Captação e anúncios] Use a Central de anúncios
Abra: /admin?tab=central-anuncios
1. No menu (Recursos), clique em Central de anúncios.
2. Clique nas abas Dashboard, Modelos, Campanhas, Performance, Inteligência ou Comissões conforme o que quiser ver.
3. Para criar: clique em Criar campanha (abre o assistente de publicação).
4. Se aparecer Como anunciar no WhatsApp em 4 passos, clique em Abrir aba WhatsApp, Conectar Facebook e Abrir Meta Business Suite na ordem pedida.
5. Clique em Sincronizar agora para atualizar métricas; use Ver último sync se algo parecer atrasado.
6. Se ainda não vinculou a Meta, clique em Conectar minha conta (opcional) quando o botão aparecer.

[Captação e anúncios] Crie uma campanha Meta
Abra: /admin/meta-ads
1. Abra Meta Ads em /admin/meta-ads, ou no menu clique em Central de anúncios → Criar campanha.
2. Confirme WhatsApp conectado; se pedir conta Meta, clique em Conectar minha conta.
3. No assistente, avance pelas etapas: Região → Criativo → Texto & Mensagem → Orçamento → Revisar & Publicar.
4. Em cada etapa, preencha os campos obrigatórios e clique em Continuar.
5. Na revisão, confira público, criativo, mensagem e valor diário.
6. Clique em Publicar campanha e aguarde a análise da Meta.
7. Depois, no menu clique em Central de anúncios → Performance (ou Campanhas) para ver status e custo.

[Captação e anúncios] Resolva uma campanha reprovada
Abra: /admin/meta-ads
1. Abra Meta Ads ou Central de anúncios → Campanhas.
2. Clique na campanha reprovada e leia o motivo completo na tela (não invente a causa).
3. Confirme destino WhatsApp Business e se a conexão Meta/WhatsApp está válida.
4. Corrija texto, imagem ou público conforme o motivo (ex.: política, destino, criativo).
5. Salve e envie novamente para análise.
6. Se o motivo continuar sem clareza, abra o suporte com IA e informe o nome exato da campanha e a mensagem de erro.

[Captação e anúncios] Compartilhe seus links
Abra: /admin?tab=links
1. No menu (Recursos), clique em Links.
2. Abra a aba Meus Links (Resultados mostra desempenho).
3. Toque no produto desejado (ex.: Conexão Green, Cadastro Rápido).
4. Em cada rede (WhatsApp, Instagram, etc.), clique em Copiar.
5. Cole o link em uma janela anônima do navegador e confira se abre sua página.
6. Para QR: clique no ícone QR Code ao lado do link.
7. Para impressão: no bloco Panfleto pra Gráfica, clique em Gerar.

[Captação e anúncios] Baixe materiais de divulgação
Abra: /admin?tab=materiais
1. No menu (Recursos), clique em Materiais.
2. Escolha o produto ou pasta do material.
3. Abra o arquivo desejado e use Baixar / download.
4. Antes de anunciar, confira se o criativo está atualizado e permitido pela Meta.
5. Guarde uma cópia e use no wizard de campanha (etapa Criativo) ou envie ao cliente pelo WhatsApp.

[Automações] Use a Central de automações
Abra: /admin?tab=agendamentos
1. No menu, clique em Agendamentos (título da tela: Central de Automações).
2. Clique no botão Guia no topo para ver o que já funciona, o que pode ligar/desligar e a ordem segura.
3. Use as abas: Mapa | Grupo A | Grupo B | Grupo C | Agenda | Carteira | Histórico.
4. Na aba Agenda, escolha a sub-aba: Manual, Pós-venda, Reaquecimento, Campanhas ou Rodízios.
5. Para agendar na mão: Agenda → Manual → Agendar nova → preencha → Agendar.
6. Filtre Próximos envios por Todos, Motor A→B→C, Manual, Pós-venda, WA, Ligação ou Reaquecer.
7. Em Ajustar todos os textos, revise frases antes de ligar envios em volume.
8. Só ative interruptores depois de ler o Guia e conferir uma prévia no Histórico.

[Automações] Configure o Motor de cadência
Abra: /admin/motor
1. Caminho recomendado: no menu clique em Agendamentos → aba Grupo B (leads frios). Atalho técnico: /admin/motor.
2. Leia o status Ligado / Desligado no topo da tela do motor.
3. Para ligar: clique no switch → no diálogo Ligar o motor de cadência? clique em Confirmar e ligar.
4. Revise estágios, intervalos e limites de WhatsApp, ligação e SMS nos campos da tela.
5. Defina dias e horários permitidos antes de ampliar o volume.
6. Clique em Atualizar; só use Executar tick agora para teste pontual e com cuidado.
7. Clique em Salvar configurações no rodapé.
8. Acompanhe respostas; se algo sair do esperado, clique para Desligado e abra o suporte com IA.

[Automações] Faça ligações pela plataforma
Abra: /admin?tab=voz
1. No menu (Recursos), clique em Ligação.
2. Abra a aba Nova ligação.
3. Gere áudio com Gerar áudio Sofia (v3) ou clique em Gravar / Upload conforme a etapa do assistente.
4. Avance com Continuar até revisar a base e o texto.
5. Clique em Iniciar ligações só depois de conferir a lista e o áudio.
6. Use as abas Bases, Não Perturbe, Programação do ciclo, SMS e Histórico para organizar e respeitar quem não quer contato.
7. Leia a aba Ajuda dentro de Ligação (painel O que este módulo faz) se for a primeira vez.

[Produtos e vendas] Gerencie produtos e vendas
Abra: /admin?tab=produtos
1. No menu, clique em Produtos & Vendas.
2. Use as abas: Acompanhamento, Orçamentos, Pipeline e Catálogo.
3. Para criar: clique em Novo orçamento → preencha o sheet Criar orçamento → confirme.
4. Acompanhe etapas no Pipeline; atualize conforme o avanço da venda.
5. Em Acompanhamento, veja Oportunidades de venda cruzada → Configurar / Enviar no WhatsApp quando fizer sentido.
6. Registre o motivo quando a venda não avançar, para não perder o histórico.

[Produtos e vendas] Gerencie parceiros
Abra: /admin?tab=parceiros
1. No menu, clique em Parceiros.
2. Clique em Novo Parceiro (ou Cadastrar primeiro parceiro se a lista estiver vazia).
3. No diálogo Novo Parceiro Indicador, preencha nome e dados pedidos → clique em Criar Parceiro.
4. Abra o parceiro criado e copie / gere o link exclusivo (e QR se disponível).
5. Configure rodízio e notificações se a tela oferecer essas opções.
6. Acompanhe os contatos atribuídos na própria área de Parceiros.

[Financeiro] Entenda o Financeiro
Abra: /admin?tab=financeiro
1. No menu esquerdo, clique em Financeiro.
2. Clique na aba Boletos, Recebíveis ou Carteira Green (Extrato pode aparecer para perfis admin).
3. Ajuste o período / filtros no topo antes de comparar valores.
4. Em Boletos, clique em um item da tabela para ver detalhes e ações de cobrança.
5. Em Recebíveis ou Carteira Green, clique na movimentação para ver o detalhe.
6. Se um valor confirmado não aparecer, atualize a página; se continuar errado, abra o suporte com IA e informe data e tipo (boleto/comissão/carteira).

[Pós-venda] Acompanhe o pós-venda
Abra: /admin?tab=crm-clientes
1. No menu, clique em Clientes ativos.
2. Filtre pela coluna / situação que precisa de atenção (em análise, aprovado, reprovado, 30/60/90/120 dias).
3. Abra o cliente e revise pendências, datas e documentos.
4. Resolva devolutivas antes de mover o card.
5. Registre o contato feito (WhatsApp ou nota) para manter o histórico.
6. Mensagens automáticas de pós-venda ficam em Agendamentos → Agenda → Pós-venda — revise antes de ampliar.

[Conta e suporte] Peça ajuda ao suporte
Abra: /ajuda?suporte=1
1. Toque no botão verde de ajuda (?) no canto inferior direito.
2. Clique em Perguntar ao suporte com IA.
3. Descreva: o que queria fazer, em qual tela estava e qual botão clicou.
4. Cole a mensagem de erro ou o nome da campanha/cliente se houver.
5. Siga os passos numerados que a IA responder (ela usa seus dados reais de saldo e Meta quando disponíveis).
6. A conversa fica salva; se precisar, limpe com o ícone de lixeira no topo do chat.
7. Se a IA não resolver, peça encaminhamento ao suporte humano.
`;

export function formatHelpArticles(rows: Array<{ category?: string; title?: string; body?: string; video_url?: string | null }>) {
  if (!rows.length) return "";
  return `\nARTIGOS PUBLICADOS PELO ADMINISTRADOR\n${rows.map((row) => `\n[${row.category || "Geral"}] ${row.title || "Sem título"}\n${row.body || ""}${row.video_url ? `\nVídeo: ${row.video_url}` : ""}`).join("\n")}`;
}

export function resolveHelpKnowledge(articles: Array<{ category?: string; title?: string; body?: string; video_url?: string | null }>) {
  const published = formatHelpArticles(articles);
  if (published) return published;
  return `\n${HELP_CATALOG_FALLBACK}`;
}
