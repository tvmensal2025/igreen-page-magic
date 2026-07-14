import type { TourArticle, TourStep } from "@/features/onboarding/types";

export type HelpArticle = TourArticle & {
  summary: string;
  href: string;
  keywords: string[];
  steps: string[];
  featured?: boolean;
};

export const HELP_CATEGORIES = [
  "Primeiros passos",
  "Clientes e CRM",
  "WhatsApp e IA",
  "Captação e anúncios",
  "Automações",
  "Produtos e vendas",
  "Financeiro",
  "Pós-venda",
  "Conta e suporte",
] as const;

const article = (
  id: string,
  category: (typeof HELP_CATEGORIES)[number],
  title: string,
  summary: string,
  href: string,
  keywords: string[],
  steps: string[],
  order_index: number,
  featured = false,
): HelpArticle => ({
  id: `guia-${id}`,
  category,
  title,
  summary,
  body: steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
  href,
  keywords,
  steps,
  order_index,
  featured,
  video_url: null,
  related_tour_step_id: null,
  is_active: true,
});

export const HELP_CATALOG: HelpArticle[] = [
  article("inicio", "Primeiros passos", "Comece por aqui", "Configure o essencial para receber e atender seus primeiros contatos.", "/admin?tab=dashboard", ["início", "configurar", "primeiro acesso", "painel"], ["Abra o Painel para conferir os avisos da conta.", "Conecte seu WhatsApp na área WhatsApp.", "Revise sua página e seus links na área Links.", "Acompanhe os novos contatos em Clientes interessados."], 1, true),
  article("painel", "Primeiros passos", "Entenda o Painel", "Veja resultados, pendências e atalhos para as ações mais importantes.", "/admin?tab=dashboard", ["dashboard", "indicadores", "resultado", "pendência"], ["Use os indicadores para acompanhar sua operação.", "Abra uma pendência para ir direto à área que precisa de atenção.", "Compare períodos antes de tomar uma decisão."], 2),
  article("clientes-interessados", "Clientes e CRM", "Atenda clientes interessados", "Organize contatos que chegaram e acompanhe cada conversa até a conversão.", "/admin?tab=crm", ["lead", "kanban", "interessado", "funil", "crm"], ["Abra Clientes interessados.", "Escolha um contato para consultar a conversa e os dados capturados.", "Atualize a etapa conforme o avanço do atendimento.", "Use filtros para localizar contatos parados."], 10, true),
  article("clientes-ativos", "Clientes e CRM", "Acompanhe clientes ativos", "Consulte clientes já validados, situação, documentos e dados sincronizados.", "/admin?tab=crm-clientes", ["ativo", "validado", "cliente igreen", "sincronização"], ["Abra Clientes ativos.", "Pesquise por nome, telefone ou situação.", "Abra o cliente para ver detalhes e histórico.", "Sincronize os dados quando precisar de informações recentes."], 11),
  article("base-clientes", "Clientes e CRM", "Consulte a base de clientes", "Encontre cadastros, documentos, situação e origem em uma única lista.", "/admin?tab=clientes", ["cadastro", "documento", "base", "pesquisar cliente"], ["Abra Base de clientes.", "Use busca e filtros para reduzir a lista.", "Selecione um cliente para revisar os dados.", "Corrija apenas os campos que precisam de ajuste."], 12),
  article("conversao", "Clientes e CRM", "Recupere oportunidades", "Identifique contatos parados e retome a conversa com uma ação adequada.", "/admin?tab=conversao", ["conversão", "reativar", "lead parado", "oportunidade"], ["Abra Conversão.", "Filtre por temperatura ou motivo de parada.", "Revise o resumo e a próxima ação sugerida.", "Retome pelo WhatsApp e acompanhe a resposta."], 13),
  article("whatsapp-conectar", "WhatsApp e IA", "Conecte o WhatsApp", "Vincule o número que receberá e responderá contatos dentro da plataforma.", "/admin?tab=whatsapp&section=config", ["qr code", "conectar", "instância", "número", "desconectado"], ["Abra WhatsApp e entre em Configuração.", "Escolha conectar ou reconectar.", "Leia o QR Code com o WhatsApp do número desejado.", "Aguarde o estado mudar para conectado antes de testar."], 20, true),
  article("whatsapp-atendimento", "WhatsApp e IA", "Atenda pelo WhatsApp", "Leia conversas, responda manualmente e saiba quando a automação está pausada.", "/admin?tab=whatsapp", ["conversa", "mensagem", "responder", "pausar ia", "humano"], ["Abra WhatsApp e selecione uma conversa.", "Leia o histórico e confira os dados já coletados.", "Envie uma resposta manual quando precisar assumir o atendimento.", "Reative a automação quando quiser devolver o atendimento à assistente."], 21),
  article("ia-conhecimento", "WhatsApp e IA", "Ensine a assistente de IA", "Cadastre respostas confiáveis para dúvidas de clientes e mantenha o atendimento consistente.", "/admin/conhecimento", ["faq", "base da ia", "conhecimento", "resposta", "embeddings"], ["Abra Base de conhecimento.", "Crie uma seção com título claro e conteúdo completo.", "Adicione palavras que seus clientes costumam usar.", "Salve e atualize o índice da IA quando a tela solicitar.", "Teste com uma pergunta real antes de publicar mudanças grandes."], 22, true),
  article("fluxos", "WhatsApp e IA", "Configure o fluxo de atendimento", "Defina mensagens, perguntas e caminhos usados no atendimento automático.", "/admin/fluxos", ["fluxo", "mensagem automática", "passo", "pergunta", "editor"], ["Abra Fluxos de atendimento.", "Escolha o fluxo que deseja revisar.", "Edite um passo por vez e confira suas saídas.", "Salve e use o simulador antes de ativar para clientes."], 23),
  article("captacao", "Captação e anúncios", "Acompanhe a captação", "Veja contatos recebidos por anúncios, páginas e outras origens.", "/admin?tab=captacao", ["captação", "lead ads", "origem", "formulário", "entrada"], ["Abra Captação.", "Filtre por canal, situação ou período.", "Revise os dados de cada contato.", "Converta o contato para a área comercial quando estiver pronto."], 30),
  article("meta-ads", "Captação e anúncios", "Crie uma campanha Meta", "Prepare público, criativo, orçamento e acompanhamento de anúncios do Facebook e Instagram.", "/admin/meta-ads", ["facebook", "instagram", "campanha", "anúncio", "meta", "cpl"], ["Abra Central de anúncios ou Meta Ads.", "Confirme a conexão da conta de anúncios e do WhatsApp Business.", "Escolha o público, o orçamento e os materiais.", "Revise tudo antes de publicar.", "Acompanhe custo, contatos e situação na própria campanha."], 31, true),
  article("campanha-reprovada", "Captação e anúncios", "Resolva uma campanha reprovada", "Use o motivo informado pela Meta para corrigir conexão, material ou configuração.", "/admin/meta-ads", ["reprovada", "erro meta", "2446885", "whatsapp business", "política"], ["Abra a campanha e leia o motivo da reprovação.", "Confirme se o destino usa WhatsApp Business e se a conexão está válida.", "Revise texto, imagem e público conforme o motivo exibido.", "Corrija e envie para nova análise.", "Se o motivo continuar sem clareza, abra o suporte com o nome da campanha."], 32),
  article("links", "Captação e anúncios", "Compartilhe seus links", "Copie páginas e links rastreáveis para divulgar produtos e captar contatos.", "/admin?tab=links", ["link", "página", "landing page", "divulgar", "licença"], ["Abra Links.", "Escolha o produto ou página que deseja divulgar.", "Copie o endereço vinculado à sua licença.", "Teste o endereço em uma janela anônima antes de compartilhar."], 33),
  article("agendamentos", "Automações", "Use a Central de automações", "Gerencie mensagens programadas, pós-venda, campanhas, rodízios e histórico.", "/admin?tab=agendamentos", ["automação", "agendamento", "mensagem programada", "central"], ["Abra Agendamentos.", "Escolha a área da automação que deseja configurar.", "Revise público, mensagem e horário.", "Ative somente depois de conferir uma prévia.", "Use o Histórico para acompanhar os envios."], 40, true),
  article("cadencia", "Automações", "Configure o Motor de cadência", "Defina tentativas por WhatsApp, ligação e SMS para contatos sem resposta.", "/admin/motor", ["cadência", "follow-up", "ligação", "sms", "sem resposta"], ["Abra Motor de cadência.", "Revise a ordem dos estágios e os intervalos.", "Confira a mensagem e o limite de cada canal.", "Defina dias e horários permitidos.", "Ative e acompanhe os registros antes de ampliar o uso."], 41),
  article("reaquecimento", "Automações", "Reaqueça contatos parados", "Envie retomadas controladas para contatos que interromperam a conversa.", "/admin/reaquecimento", ["reaquecimento", "reativação", "followup", "frio"], ["Abra Reaquecimento.", "Escolha os contatos e o motivo da retomada.", "Revise a mensagem e os intervalos.", "Ative com um grupo pequeno.", "Acompanhe respostas e interrompa envios sem retorno quando necessário."], 42),
  article("produtos", "Produtos e vendas", "Gerencie produtos e vendas", "Crie oportunidades de produtos iGreen e acompanhe cada etapa comercial.", "/admin?tab=produtos", ["produto", "venda", "proposta", "oportunidade", "pipeline"], ["Abra Produtos e vendas.", "Escolha o produto e crie uma oportunidade.", "Preencha os dados necessários e gere uma proposta quando disponível.", "Atualize as etapas até o fechamento.", "Registre o motivo quando a venda não avançar."], 50, true),
  article("solar", "Produtos e vendas", "Crie um estudo solar", "Analise o telhado, ajuste painéis e use o resultado em uma proposta.", "/admin/solar-design", ["solar", "telhado", "painel", "projeto", "economia"], ["Abra Projeto solar.", "Informe e confirme o endereço.", "Revise a imagem e ajuste a quantidade de painéis.", "Salve o estudo.", "Use o estudo salvo ao preparar a proposta."], 51),
  article("parceiros", "Produtos e vendas", "Gerencie parceiros", "Cadastre indicadores, links exclusivos e distribuição de contatos.", "/admin?tab=parceiros", ["parceiro", "indicação", "rodízio", "qr code", "comissão"], ["Abra Parceiros.", "Cadastre o parceiro e os dados de contato.", "Gere ou copie o link exclusivo.", "Configure rodízio e notificações quando necessário.", "Acompanhe os contatos atribuídos ao parceiro."], 52),
  article("financeiro", "Financeiro", "Entenda o Financeiro", "Acompanhe recebíveis, comissões, carteira de anúncios e movimentações.", "/admin?tab=financeiro", ["saldo", "carteira", "comissão", "recebíveis", "pagamento"], ["Abra Financeiro.", "Escolha a visão de carteira, comissão ou recebíveis.", "Use o período correto antes de comparar valores.", "Abra uma movimentação para consultar seus detalhes.", "Fale com o suporte se um valor confirmado não aparecer após a atualização."], 60, true),
  article("pos-venda", "Pós-venda", "Acompanhe o pós-venda", "Monitore aprovação, assinatura, devolutivas e contatos depois da venda.", "/admin?tab=crm-clientes", ["pós-venda", "devolutiva", "assinatura", "aprovado", "30 dias"], ["Abra Clientes ativos.", "Filtre pela situação que precisa de acompanhamento.", "Abra o cliente e revise pendências e datas.", "Resolva devolutivas antes de avançar.", "Registre o contato feito para manter o histórico."], 70),
  article("academy", "Primeiros passos", "Aprenda na Academy", "Assista às aulas, faça avaliações e acompanhe seu progresso.", "/admin?tab=academy", ["academy", "curso", "aula", "treinamento", "prova"], ["Abra Academy.", "Escolha uma trilha ou aula.", "Assista ao conteúdo e registre anotações.", "Faça a avaliação quando estiver disponível.", "Retome depois pelo progresso salvo."], 80),
  article("suporte", "Conta e suporte", "Peça ajuda ao suporte", "Converse com a assistência de IA usando dados atuais da sua operação.", "/ajuda?suporte=1", ["ajuda", "suporte", "erro", "problema", "humano"], ["Abra o menu de ajuda no canto da tela.", "Escolha Falar com suporte.", "Descreva o que tentou, a tela e a mensagem exibida.", "Inclua o nome da campanha ou contato quando isso ajudar o diagnóstico.", "Se a IA não resolver, solicite encaminhamento ao suporte humano."], 90, true),
];

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function searchHelpCatalog(query: string, category = "all", source: HelpArticle[] = HELP_CATALOG) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return source
    .filter((item) => category === "all" || item.category === category)
    .map((item) => {
      const title = normalize(item.title);
      const haystack = normalize([item.title, item.summary, item.body, item.category, ...item.keywords].join(" "));
      const score = terms.reduce((total, term) => total + (title.includes(term) ? 5 : haystack.includes(term) ? 1 : 0), 0);
      return { item, score };
    })
    .filter(({ score }) => terms.length === 0 || score === terms.length || score > terms.length)
    .sort((a, b) => b.score - a.score || Number(b.item.featured) - Number(a.item.featured) || a.item.order_index - b.item.order_index)
    .map(({ item }) => item);
}

export function mergeHelpArticles(rows: TourArticle[], steps: TourStep[]): HelpArticle[] {
  const stepById = new Map(steps.map((step) => [step.id, step]));
  const dynamic = rows.map((row): HelpArticle => {
    const linked = row.related_tour_step_id ? stepById.get(row.related_tour_step_id) : undefined;
    const parsedSteps = row.body.split("\n").map((line) => line.replace(/^\s*\d+[.)-]?\s*/, "").trim()).filter(Boolean);
    return {
      ...row,
      summary: parsedSteps[0] || row.body.slice(0, 180),
      href: linked?.cta_href || linked?.route || "/admin",
      keywords: [row.category, row.title],
      steps: parsedSteps,
    };
  });
  const dynamicTitles = new Set(dynamic.map((item) => normalize(item.title)));
  return [...dynamic, ...HELP_CATALOG.filter((item) => !dynamicTitles.has(normalize(item.title)))];
}
