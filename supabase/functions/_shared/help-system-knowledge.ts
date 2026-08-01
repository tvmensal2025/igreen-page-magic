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
- NUNCA diga Evolution, Whapi nem nome de provedor técnico de WhatsApp. Diga só "WhatsApp".
- Use nomes EXATOS: Anúncio inteligente, Anúncio completo, Mensagens prontas, Atualizar números, Trocar número, Resumo, Resultados, Assistente (seção de anúncios), Leads novos, Quem esfriou, Quem sumiu.

Primeiros passos
- Painel: /admin?tab=dashboard. Mostra indicadores, avisos e atalhos.
- Academy: /admin?tab=academy. Reúne aulas, avaliações, progresso e anotações.
- Central de ajuda: /ajuda. Permite buscar guias, ver passos, iniciar orientação na tela ("Me leve e explique") e abrir a assistência com IA.
- Botão flutuante de ajuda (canto inferior direito): reinicia o tour, abre a Central ou o suporte com IA.
- Dados da conta: pelo menu Configurações no Painel — nome, ID iGreen, foto e senha.

Clientes e CRM
- Clientes interessados: /admin?tab=crm. Novos contatos em conversa no funil. Abra um contato para ver conversa e dados; atualize a etapa conforme o avanço.
- Clientes ativos: /admin?tab=crm-clientes. Clientes já no iGreen / cadastro em análise fica aqui (não misture com interessados novos).
- Análise do CRM: /admin?tab=crm-analise. Métricas por pessoa: áudio, vídeo, leitura, SMS, ligação (com tempo no fone), passo a passo. Duas visões separadas: interessados (quadro) e clientes ativos (carteira).
- Confirmação de mídia WhatsApp (Whapi/Evolution): áudio usa status played; vídeo usa read; delivered = chegou mas não abriu. Duração do arquivo vem da biblioteca de mídia ou reconciliação Whapi. O WhatsApp não informa tempo parcial de escuta/visualização — só sim/não.
- Ligações: tempo no fone vem do Velip (velip_time_sec / duration_sec) — esse é o tempo real de atendimento.
- Base de clientes: /admin?tab=clientes. Pesquisa cadastros e documentos por filtros.
- Conversão: /admin?tab=conversao. Aba Atender — baldes Precisa de você e Quente sem resposta.

WhatsApp e assistência de IA
- Conectar ou reconectar: /admin?tab=whatsapp. Botão Conectar WhatsApp → QR no celular. Trocar número / Recomeçar conexão quando precisar.
- Conversas: /admin?tab=whatsapp&section=conversas. Ler histórico e responder. Intervenção manual pode pausar a automação.
- Mensagens prontas: /admin?tab=whatsapp&section=templates. Públicos / Meus templates / Criar meu template.
- Base de conhecimento: /admin/conhecimento. Cadastre conteúdo correto e teste.
- Fluxos de atendimento: /admin/fluxos. Edite mensagens e caminhos; salve e simule antes de ativar.
- Estúdio de áudio: /admin?tab=audio-studio. Grave ou gere áudios e envie pelo WhatsApp.

Captação e anúncios
- Captação: /admin?tab=captacao. Contatos por anúncios e canais.
- Central de anúncios: /admin?tab=central-anuncios. Seções Resumo, Modelos, Campanhas, Resultados, Assistente, Comissões. Botões Anúncio inteligente e Anúncio completo. Atualizar números.
- Campanha reprovada: Central de anúncios → Campanhas → leia o motivo real → corrija → republicar.
- Links: /admin?tab=links. Copie páginas e teste antes de compartilhar.
- Materiais: /admin?tab=materiais. Baixe imagens, vídeos e arquivos de divulgação.

Automações
- Agendamentos: /admin?tab=agendamentos. Abas Mapa | Leads novos | Quem esfriou | Quem sumiu | Agenda | Carteira | Histórico. Botão Guia no topo.
- Motor de cadência: preferir Agendamentos → Quem esfriou; atalho /admin/motor.
- Ligações: /admin?tab=voz.

Produtos e vendas
- Produtos e vendas: /admin?tab=produtos.
- Projeto solar: /admin/solar-design.
- Parceiros: /admin?tab=parceiros.

Financeiro e pós-venda
- Financeiro: /admin?tab=financeiro. Boletos, Recebíveis, Carteira Green.
- Pós-venda: /admin?tab=crm-clientes (Clientes ativos).

Diagnóstico e suporte
- Central de ajuda: /ajuda.
- Suporte com IA: botão flutuante → Perguntar ao suporte com IA.
`;

/** Guias detalhados (onde clicar) — espelho dos guias prioritários do helpCatalog. */
export const HELP_CATALOG_FALLBACK = `
GUIAS DETALHADOS (onde clicar — espelho do helpCatalog do front)

[Primeiros passos] Comece por aqui
Abra: /admin?tab=dashboard
1. Abra o Painel no menu esquerdo — é a sua Visão Geral do dia.
2. No topo do Painel, escolha o período e confira o escopo (você ou equipe) antes de olhar números.
3. Abra Configurações (engrenagem no menu) e confirme nome + ID iGreen — sem isso a sync e os links falham.
4. Confirme o ID iGreen e salve. Só digite o ID completo e use Salvar Dados.
5. Conecte o WhatsApp (menu WhatsApp). Se pedir QR, escaneie em Aparelhos conectados no celular.
6. Em Links → Meus Links, copie um link de produto e teste no navegador.
7. Em Clientes interessados, veja quem já chegou e abra um card para a conversa.
8. Sempre que travar: botão ? no topo da tela ou Central de ajuda → suporte com IA.

[Primeiros passos] Entenda o Painel (Visão Geral)
Abra: /admin?tab=dashboard
1. Menu → Painel. Esta é a Visão Geral da operação.
2. Barra superior: filtro de licenciado, Sincronizar iGreen, período e Exportar PDF.
3. Escolha o período (ex.: 30 dias) antes de comparar qualquer número.
4. Se a carteira parecer vazia ou desatualizada, use Sincronizar (respeite o cooldown).
5. Os 4 cards mostram cadastros, média kWh, recorrência e total kWh da carteira iGreen.
6. Role a página: gráficos, top consumidores e retenção aprofundam o diagnóstico.
7. PDF: use Exportar PDF na barra quando for enviar relatório ao líder/sócio.
8. Dúvida em um número: ? desta tela ou suporte com IA citando o card que você está olhando.

[Clientes e CRM] Acompanhe clientes interessados
Abra: /admin?tab=crm
1. Menu → Clientes interessados. Aqui entram leads novos em conversa (não confundir com Clientes ativos).
2. Busque por nome ou telefone para achar um lead rápido.
3. Filtro “Parou no passo”: quem travou em conta, documento, e-mail ou portal.
4. Arraste cards entre colunas ou abra o detalhe (olho) para ver conversa e ações.
5. Use Análise / insights quando quiser diagnóstico de volume e gargalos (não é a pizza A).

[Clientes e CRM] Acompanhe clientes ativos
Abra: /admin?tab=crm-clientes
1. Menu → Clientes ativos (não é Clientes interessados).
2. Barra superior: busca, filtro de responsável e atalhos de análise.
3. Busque por nome, telefone ou situação.
4. Kanban de pós-venda: colunas de análise, assinatura, aprovado/reprovado e 30–120 dias.
5. Abra o card, resolva devolutiva/documento e só então mova a coluna.
6. Validar dados: use o botão Validar quando precisar checar inconsistências em lote.

[Clientes e CRM] Consulte a base de clientes
Abra: /admin?tab=clientes
1. Menu → Base de clientes.
2. Novo cliente: cadastra manualmente quem ainda não veio da sync.
3. Menu ⋮ → Sincronizar iGreen para puxar a carteira oficial (respeite o cooldown).
4. Busca: nome, telefone, CPF ou e-mail.
5. Filtros: produto, status, licenciado, distribuidora e cidade.
6. Clique na linha/card da lista para abrir o cadastro completo e o telefone.

[Clientes e CRM] Recupere oportunidades
Abra: /admin?tab=conversao
1. Menu → Conversão.
2. Fique na aba Atender — é a fila do dia.
3. Prioridade 1: balde Precisa de você (automação pausada / humano).
4. Prioridade 2: Quente sem resposta.
5. Abra um card e use Atender para mensagem sugerida ou chat.

[WhatsApp e IA] Conecte o WhatsApp
Abra: /admin?tab=whatsapp
1. Menu → WhatsApp.
2. Se desconectado, clique em Conectar WhatsApp.
3. Escaneie o QR com o celular (Aparelhos conectados). Se já conectado, o QR não deve reabrir sozinho.
4. Após conectar, use Conversas e Mensagens prontas nas sub-abas.

[WhatsApp e IA] Atenda pelo WhatsApp
Abra: /admin?tab=whatsapp&section=conversas
1. Menu → WhatsApp.
2. Sub-aba Conversas (no celular: Chats).
3. Escolha a conversa na lista — histórico à direita.
4. Digite e envie no composer. Templates e mídia ficam aqui também.
5. Sub-aba Atendente IA: confira se a assistente está ativa e quando devolver o lead.

[WhatsApp e IA] Crie mensagens prontas
Abra: /admin?tab=whatsapp&section=templates
1. Menu → WhatsApp.
2. Abra Mensagens prontas.
3. Meus templates: seus modelos editáveis.
4. Criar meu template: nome, texto e mídia.
5. Para usar: Conversas → composer → escolha o modelo.

[WhatsApp e IA] Ensine a assistente de IA
Abra: /admin/conhecimento
1. Abra a Base de conhecimento (/admin/conhecimento).
2. Crie ou edite uma seção com título claro (ex.: Cobertura CEMIG).
3. Escreva a resposta completa que a assistente deve usar — sem inventar preço/prazo.
4. Inclua sinônimos e frases que o cliente digita de verdade.
5. Salve e atualize o índice da IA se a tela pedir.
6. Teste no simulador ou WhatsApp antes de mudanças grandes.

[WhatsApp e IA] Configure o fluxo de atendimento
Abra: /admin/fluxos
1. Abra Fluxos em /admin/fluxos (ferramenta avançada).
2. Escolha o fluxo na lista e clique em um passo para editar.
3. Altere mensagem/pergunta/saídas — um passo por vez.
4. Salve e use o simulador da tela.
5. Só publique depois do teste. Em dúvida, suporte com IA antes de mudar o fluxo principal.

[WhatsApp e IA] Use o Estúdio de áudio
Abra: /admin?tab=audio-studio
1. Menu (Recursos) → Estúdio de áudio.
2. Escolha o tipo: Mutirão, Comércio ou Texto livre.
3. Preencha cidade/texto e escolha a voz (Sofia, Diego ou Rafael).
4. Clique em Gerar áudio e ouça a prévia.
5. Baixar áudio (com/sem vinheta conforme a opção).
6. Envie no WhatsApp → Conversas anexando o arquivo, ou use o atalho WhatsApp da tela se aparecer.

[Captação e anúncios] Acompanhe a captação
Abra: /admin?tab=captacao
1. Menu → Captação.
2. Busque por nome ou telefone.
3. Selecione um ou mais leads e clique em Iniciar atendimento.
4. Depois acompanhe em Clientes interessados / WhatsApp.

[Captação e anúncios] Use a Central de anúncios
Abra: /admin?tab=central-anuncios
1. Menu (Recursos) → Central de anúncios.
2. Resumo (Dashboard): visão rápida de gasto e resultado.
3. Modelos: templates prontos de campanha.
4. Campanhas: lista e status (ativa, pausada, reprovada).
5. Resultados (Performance): CPL, leads e desperdício.
6. Criar: Anúncio inteligente (simples) ou Anúncio completo (controle total).
7. Anúncio completo quando quiser cidade, textos e dias à mão.
8. Comissões: acompanhe o que a campanha gerou para parceiros/rede.

[Captação e anúncios] Crie uma campanha Meta
Abra: /admin?tab=central-anuncios
1. Central de anúncios no menu.
2. Confirme WhatsApp conectado antes de publicar.
3. Volte e clique em Anúncio inteligente (caminho recomendado).
4. Ou Anúncio completo para escolher região, criativo, texto e orçamento.
5. Avance as etapas, revise e publique. Depois abra Campanhas ou Resultados.
6. Resultados: acompanhe CPL e pause o que estiver desperdiçando.

[Captação e anúncios] Resolva uma campanha reprovada
Abra: /admin?tab=central-anuncios
1. Central de anúncios → aba Campanhas.
2. Abra a campanha reprovada e leia o motivo completo (não invente a causa).
3. Confirme WhatsApp Business / conexão Meta válidos.
4. Corrija texto, imagem ou público; salve e envie de novo.
5. Se o motivo continuar obscuro: Central de ajuda → suporte com o nome da campanha e o erro.

[Captação e anúncios] Compartilhe seus links
Abra: /admin?tab=links
1. Menu → Links.
2. Aba Meus Links.
3. Copie o link do produto/rede desejada e teste no navegador.
4. Panfleto pra gráfica → Gerar para impressão com QR.

[Captação e anúncios] Baixe materiais de divulgação
Abra: /admin?tab=materiais
1. Menu (Recursos) → Materiais.
2. Escolha a aba do tema (notícias, depoimentos, cashback, etc.).
3. Na grade, abra o card e baixe ou envie pelo WhatsApp.
4. Materiais extras no Drive: pasta com arquivos adicionais da rede.
5. Antes de anunciar na Meta, confira se o criativo está atualizado e permitido.

[Automações] Central de agendamentos
Abra: /admin?tab=agendamentos
1. Menu → Agendamentos.
2. Abas do hub: Mapa, Leads novos, Quem esfriou, Quem sumiu, Agenda…
3. Mapa: visão geral dos grupos A/B/C.
4. Quem esfriou (Grupo B): retome quem parou de responder.
5. Agenda: envios que você marcou. Use Agendar nova.
6. Histórico: o que já saiu (WhatsApp, SMS, voz).

[Automações] Configure o Motor de cadência
Abra: /admin/motor
1. Caminho recomendado: Agendamentos → Quem esfriou (atalho /admin/motor).
2. No motor, leia Ligado/Desligado no topo.
3. Para ligar: switch → Confirmar e ligar. Revise estágios e limites WA/SMS/voz.
4. Defina dias/horários permitidos antes de ampliar volume. Salve no rodapé.
5. Se algo sair do esperado: Desligado e suporte com IA.

[Automações] Reaqueça contatos parados
Abra: /admin/reaquecimento
1. Agendamentos → Quem esfriou.
2. Escolha o grupo e revise a mensagem/intervalos na tela.
3. Comece pequeno — evite massa no primeiro teste.
4. Acompanhe em Histórico; pause se não houver retorno.

[Automações] Faça ligações pela plataforma
Abra: /admin?tab=voz
1. Menu (Recursos) → Ligação.
2. Aba Nova ligação: áudio Sofia / gravar / upload e iniciar.
3. SMS: envios de texto pela mesma base.
4. Bases: listas de números. Não Perturbe: quem nunca mais contatar.
5. Não Perturbe (bloqueados): respeite sempre — fora de envios automáticos.
6. Programação do ciclo e Textos automáticos: horários e conteúdo.
7. Histórico e Painel: o que saiu e métricas. Ajuda interna: leia na primeira vez.
8. Aba Ajuda do módulo: o que este módulo faz, passo a passo.

[Produtos e vendas] Gerencie produtos e vendas
Abra: /admin?tab=produtos
1. Menu → Produtos & Vendas.
2. Acompanhamento: visão das oportunidades e cross-sell.
3. Orçamentos: crie e edite propostas (Novo orçamento).
4. Vendas em andamento (Pipeline): arraste conforme o avanço.
5. Catálogo: produtos disponíveis para proposta.
6. Ações rápidas (Novo orçamento) e atalho Projeto solar.

[Produtos e vendas] Crie um estudo solar
Abra: /admin/solar-design
1. Abra Projeto solar (/admin/solar-design) ou o atalho em Produtos.
2. Informe o endereço e confirme no mapa.
3. Ajuste painéis no telhado e salve o estudo.
4. Volte em Produtos → Orçamentos e use o estudo na proposta.

[Captação e anúncios] Rede de parceiros
Abra: /admin?tab=parceiros
1. Menu → Parceiros — aqui fica a sua rede de indicadores.
2. Cabeçalho: título da rede e atalhos principais.
3. Meus banners: materiais e QR dos seus pontos (consultor).
4. Novo: cadastra nome, palavra-chave, frase do WhatsApp e telefone de aviso.
5. Abas: Visão geral + um nome por parceiro. Clique no nome para abrir tudo dele.
6. Visão geral: pódio e quem mais indicou nos últimos 30 dias.
7. KPIs: parceiros ativos, interessados (30 dias), conversão e destaque.
8. Gráficos: volume, tendência, funil e origem das indicações.
9. Ranking detalhado: editar, QR e comparar parceiros lado a lado.
10. Abra a aba de um parceiro (nome na faixa de abas).
11. Card do parceiro: status, código curto e leads recentes.
12. Palavra-chave: atribui lead ao parceiro no WhatsApp (não escolhe campanha Meta).
13. Frase WhatsApp: texto do link/QR.
14. Editar dados: keyword, frase, ID iGreen e telefone de notificação.
15. Baixar QR: gere o QR/link para o parceiro indicar.
16. Banners do parceiro: link do portal e pontos nomeados.
17. Rodízio Meta usa UUID de campanha — comissões em Anúncios.

[Financeiro] Acompanhe o financeiro
Abra: /admin?tab=financeiro
1. Menu → Financeiro.
2. Boletos: vencimentos e status de pagamento.
3. Recebíveis: ganhos da Conexão Green.
4. Carteira Green: adimplência e métricas iGreen.
5. Extrato (se liberado): movimentos detalhados.

[Pós-venda] Acompanhe o pós-venda
Abra: /admin?tab=crm-clientes
1. Menu → Clientes ativos.
2. Use busca e filtros da barra.
3. Trabalhe o kanban: análise → assinatura → aprovado → 30–120 dias.
4. Resolva devolutiva antes de mover o card; registre o contato.
5. Automações de pós-venda: Agendamentos → Agenda (revise antes de ampliar).

[Primeiros passos] Aprenda na Academy
Abra: /admin?tab=academy
1. Menu (Recursos) → Academy.
2. Catálogo: escolha trilha ou aula.
3. Assista, anote e faça a prova quando disponível — o progresso fica salvo.
4. Volte depois pela mesma trilha; use Central de ajuda se travar em algum módulo.

[Conta e suporte] Atualize seus dados da conta
Abra: /admin?tab=dashboard
1. Abra Configurações (engrenagem no menu esquerdo).
2. Painel lateral de configurações: dados do perfil.
3. Confirme nome e telefone.
4. ID iGreen correto — base da sync e dos links de cadastro.
5. Mensagens automáticas / Cérebro: ligue só o que quiser (default Cérebro off).
6. Troque a senha no card de senha, se precisar.
7. Salvar Dados no rodapé e feche o painel.

[Conta e suporte] Veja a saúde do atendimento
Abra: /admin/saude-bot
1. Abra Saúde do atendimento (/admin/saude-bot).
2. Leia os alertas (WhatsApp, fluxo, automação).
3. Siga o link da área indicada (ex.: reconectar WhatsApp).
4. Volte e confira se o alerta sumiu; se persistir, suporte com IA.

[Conta e suporte] Peça ajuda ao suporte
Abra: /ajuda?suporte=1
1. Abra a Central de ajuda no menu (ou /ajuda).
2. Busque a tarefa ou o erro (ex.: campanha reprovada, WhatsApp).
3. Ajuda rápida: guias em destaque para o dia a dia.
4. Lista completa por assunto à esquerda / filtros.
5. Em cada guia: Me leve e explique (tour guiado) ou Tour da plataforma.
6. Perguntar ao suporte com IA (? verde): descreva tela, botão e erro. A conversa fica salva.
`

export function formatHelpArticles(rows: Array<{ category?: string; title?: string; body?: string; video_url?: string | null }>) {
  if (!rows.length) return "";
  return `\nARTIGOS PUBLICADOS PELO ADMINISTRADOR\n${rows.map((row) => `\n[${row.category || "Geral"}] ${row.title || "Sem título"}\n${row.body || ""}${row.video_url ? `\nVídeo: ${row.video_url}` : ""}`).join("\n")}`;
}

export function resolveHelpKnowledge(articles: Array<{ category?: string; title?: string; body?: string; video_url?: string | null }>) {
  const published = formatHelpArticles(articles);
  if (published) return published;
  return `\n${HELP_CATALOG_FALLBACK}`;
}
