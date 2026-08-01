import type { TourArticle, TourStep } from "@/features/onboarding/types";
import { menuSelectorFromHref } from "@/features/onboarding/tourHighlight";

export type GuideStepDef = {
  text: string;
  /** Rota a abrir neste passo (default: href do artigo). */
  route?: string;
  /** Seletor CSS do botão/área a destacar. Null = só texto + rota. */
  selector?: string | null;
};

export type HelpArticle = TourArticle & {
  summary: string;
  href: string;
  keywords: string[];
  steps: string[];
  /** Passos com rota/seletor para o GuideCoach destacar na tela. */
  guidedSteps?: GuideStepDef[];
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

type StepInput = string | GuideStepDef;

/** Liga cada guia ao passo correspondente do tour de 12 passos (UUIDs de produção). */
const RELATED_TOUR_STEP_BY_GUIDE: Record<string, string> = {
  inicio: "4a2bac26-09d3-448a-8f92-182410ba0d18",
  painel: "4a2bac26-09d3-448a-8f92-182410ba0d18",
  "whatsapp-conectar": "b0b465d0-0b15-44cb-afde-b14fb4a96086",
  "whatsapp-atendimento": "b0b465d0-0b15-44cb-afde-b14fb4a96086",
  "whatsapp-templates": "b0b465d0-0b15-44cb-afde-b14fb4a96086",
  "ia-conhecimento": "b0b465d0-0b15-44cb-afde-b14fb4a96086",
  fluxos: "b0b465d0-0b15-44cb-afde-b14fb4a96086",
  "audio-studio": "b0b465d0-0b15-44cb-afde-b14fb4a96086",
  agendamentos: "6133255e-0b68-4311-953a-eefae7fbaffb",
  cadencia: "6133255e-0b68-4311-953a-eefae7fbaffb",
  reaquecimento: "6133255e-0b68-4311-953a-eefae7fbaffb",
  "clientes-interessados": "cac67b81-c44f-4539-bbfb-be9e6e590d2d",
  captacao: "b548ab36-4dc7-4b72-8638-840202b3b030",
  conversao: "76ec45e1-7521-404c-aa7b-694ef8024f78",
  "clientes-ativos": "c04c05ba-f55f-4178-93bd-d8416ae271d5",
  "base-clientes": "c04c05ba-f55f-4178-93bd-d8416ae271d5",
  "central-anuncios": "bc626083-5c0b-4cc7-bc59-4b8368ac04c3",
  "meta-ads": "bc626083-5c0b-4cc7-bc59-4b8368ac04c3",
  "campanha-reprovada": "bc626083-5c0b-4cc7-bc59-4b8368ac04c3",
  links: "b548ab36-4dc7-4b72-8638-840202b3b030",
  materiais: "b548ab36-4dc7-4b72-8638-840202b3b030",
  ligacao: "6133255e-0b68-4311-953a-eefae7fbaffb",
  produtos: "7b141de5-a23e-46cb-9836-07cbb7bd1a64",
  parceiros: "b548ab36-4dc7-4b72-8638-840202b3b030",
  financeiro: "7b141de5-a23e-46cb-9836-07cbb7bd1a64",
  academy: "c78a100f-b81c-47fd-939c-33a72d17faf7",
  suporte: "aac7f92a-cac5-420b-8c4a-840a4c56e4cf",
};

function normalizeStepInputs(steps: StepInput[]): { texts: string[]; guided: GuideStepDef[] } {
  const guided = steps.map((step) => (typeof step === "string" ? { text: step } : step));
  return { texts: guided.map((s) => s.text), guided };
}

const article = (
  id: string,
  category: (typeof HELP_CATEGORIES)[number],
  title: string,
  summary: string,
  href: string,
  keywords: string[],
  steps: StepInput[],
  order_index: number,
  featured = false,
): HelpArticle => {
  const { texts, guided } = normalizeStepInputs(steps);
  return {
    id: `guia-${id}`,
    category,
    title,
    summary,
    body: texts.map((step, index) => `${index + 1}. ${step}`).join("\n"),
    href,
    keywords,
    steps: texts,
    guidedSteps: guided,
    order_index,
    featured,
    video_url: null,
    related_tour_step_id: RELATED_TOUR_STEP_BY_GUIDE[id] ?? null,
    is_active: true,
  };
};

/** Resolve passos com rota/seletor para o GuideCoach (sempre retorna lista usável). */
export function resolveGuideSteps(article: HelpArticle): GuideStepDef[] {
  const menuSel = menuSelectorFromHref(article.href);
  if (article.guidedSteps?.length) {
    return article.guidedSteps.map((step, index) => {
      const route = step.route || article.href;
      const explicit = step.selector !== undefined ? step.selector : null;
      // Nunca deixar passo “cego”: se não houver seletor, aponta o menu da rota.
      const selector =
        explicit ||
        (index === 0 ? menuSel : menuSelectorFromHref(route)) ||
        menuSel ||
        '[data-tour="guide-entry"]';
      return { text: step.text, route, selector };
    });
  }
  return (article.steps || []).map((text, index) => ({
    text,
    route: article.href,
    selector: index === 0 ? menuSel || '[data-tour="guide-entry"]' : menuSel || '[data-tour="guide-entry"]',
  }));
}

export const HELP_CATALOG: HelpArticle[] = [
  article(
    "inicio",
    "Primeiros passos",
    "Comece por aqui",
    "Ordem profissional: conta → WhatsApp → links → primeiros leads → suporte se travar.",
    "/admin?tab=dashboard",
    ["início", "configurar", "primeiro acesso", "painel", "passo a passo", "tour"],
    [
      {
        text: "Abra o Painel no menu esquerdo — é a sua Visão Geral do dia.",
        route: "/admin?tab=dashboard",
        selector: '[data-tour="dashboard"], [data-tour="menu-dashboard"]',
      },
      {
        text: "No topo do Painel, escolha o período e confira o escopo (você ou equipe) antes de olhar números.",
        route: "/admin?tab=dashboard",
        selector: '[data-tour="painel-toolbar"]',
      },
      {
        text: "Abra Configurações (engrenagem no menu) e confirme nome + ID iGreen — sem isso a sync e os links falham.",
        route: "/admin?tab=dashboard",
        selector: '[data-tour="menu-config"]',
      },
      {
        text: "Confirme o ID iGreen e salve. Só digite o ID completo e use Salvar Dados.",
        route: "/admin?tab=dashboard",
        selector: '[data-tour="cfg-igreen-id"], [data-tour="cfg-salvar"]',
      },
      {
        text: "Conecte o WhatsApp (menu WhatsApp). Se pedir QR, escaneie em Aparelhos conectados no celular.",
        route: "/admin?tab=whatsapp",
        selector: '[data-tour="wa-conectar"], [data-tour="menu-whatsapp"]',
      },
      {
        text: "Em Links → Meus Links, copie um link de produto e teste no navegador.",
        route: "/admin?tab=links",
        selector: '[data-tour="links-copiar"], [data-tour="links-meus"]',
      },
      {
        text: "Em Clientes interessados, veja quem já chegou e abra um card para a conversa.",
        route: "/admin?tab=crm",
        selector: '[data-tour="crm-kanban"], [data-tour="menu-crm"]',
      },
      {
        text: "Sempre que travar: botão ? no topo da tela ou Central de ajuda → suporte com IA.",
        route: "/ajuda",
        selector: '[data-tour="ajuda-busca"], [data-tour="menu-ajuda"]',
      },
    ],
    1,
    true,
  ),
  article(
    "painel",
    "Primeiros passos",
    "Entenda o Painel (Visão Geral)",
    "Período, sync iGreen, KPIs de carteira, gráficos e atalhos — leia nesta ordem.",
    "/admin?tab=dashboard",
    ["dashboard", "indicadores", "resultado", "pendência", "atalho", "visão geral", "painel"],
    [
      {
        text: "Menu → Painel. Esta é a Visão Geral da operação.",
        route: "/admin?tab=dashboard",
        selector: '[data-tour="dashboard"]',
      },
      {
        text: "Barra superior: filtro de licenciado, Sincronizar iGreen, período e Exportar PDF.",
        route: "/admin?tab=dashboard",
        selector: '[data-tour="painel-toolbar"]',
      },
      {
        text: "Escolha o período (ex.: 30 dias) antes de comparar qualquer número.",
        route: "/admin?tab=dashboard",
        selector: '[data-tour="painel-periodo"]',
      },
      {
        text: "Se a carteira parecer vazia ou desatualizada, use Sincronizar (respeite o cooldown).",
        route: "/admin?tab=dashboard",
        selector: '[data-tour="painel-sync"]',
      },
      {
        text: "Os 4 cards mostram cadastros, média kWh, recorrência e total kWh da carteira iGreen.",
        route: "/admin?tab=dashboard",
        selector: '[data-tour="painel-kpis"]',
      },
      {
        text: "Role a página: gráficos, top consumidores e retenção aprofundam o diagnóstico.",
        route: "/admin?tab=dashboard",
        selector: '[data-tour="painel-kpis"]',
      },
      {
        text: "PDF: use Exportar PDF na barra quando for enviar relatório ao líder/sócio.",
        route: "/admin?tab=dashboard",
        selector: '[data-tour="painel-export-pdf"]',
      },
      {
        text: "Dúvida em um número: ? desta tela ou suporte com IA citando o card que você está olhando.",
        route: "/ajuda",
        selector: '[data-tour="menu-ajuda"]',
      },
    ],
    2,
  ),
  article(
    "clientes-interessados",
    "Clientes e CRM",
    "Acompanhe clientes interessados",
    "Kanban do lead novo (em conversa): busca, filtro de passo, cards e análise — sem misturar com CRM em análise.",
    "/admin?tab=crm",
    ["crm", "interessados", "kanban", "lead", "passo", "em conversa"],
    [
      {
        text: "Menu → Clientes interessados. Aqui entram leads novos em conversa (não confundir com Clientes ativos).",
        route: "/admin?tab=crm",
        selector: '[data-tour="menu-crm"]',
      },
      {
        text: "Busque por nome ou telefone para achar um lead rápido.",
        route: "/admin?tab=crm",
        selector: '[data-tour="crm-busca"]',
      },
      {
        text: "Filtro “Parou no passo”: quem travou em conta, documento, e-mail ou portal.",
        route: "/admin?tab=crm",
        selector: '[data-tour="crm-filtro-passo"]',
      },
      {
        text: "Arraste cards entre colunas ou abra o detalhe (olho) para ver conversa e ações.",
        route: "/admin?tab=crm",
        selector: '[data-tour="crm-kanban"]',
      },
      {
        text: "Use Análise / insights quando quiser diagnóstico de volume e gargalos (não é a pizza A).",
        route: "/admin?tab=crm",
        selector: '[data-tour="crm-analise-leads"], [data-tour="crm-kanban"]',
      },
    ],
    10,
  ),
  article(
    "clientes-ativos",
    "Clientes e CRM",
    "Acompanhe clientes ativos",
    "Pós-cadastro iGreen: em análise, assinatura, aprovados e ciclo 30–120 dias.",
    "/admin?tab=crm-clientes",
    ["ativo", "validado", "cliente igreen", "sincronização", "análise", "pós-venda"],
    [
      {
        text: "Menu → Clientes ativos (não é Clientes interessados).",
        route: "/admin?tab=crm-clientes",
        selector: '[data-tour="menu-crm-clientes"]',
      },
      {
        text: "Barra superior: busca, filtro de responsável e atalhos de análise.",
        route: "/admin?tab=crm-clientes",
        selector: '[data-tour="ativos-toolbar"]',
      },
      {
        text: "Busque por nome, telefone ou situação.",
        route: "/admin?tab=crm-clientes",
        selector: '[data-tour="ativos-busca"]',
      },
      {
        text: "Kanban de pós-venda: colunas de análise, assinatura, aprovado/reprovado e 30–120 dias.",
        route: "/admin?tab=crm-clientes",
        selector: '[data-tour="ativos-kanban"]',
      },
      {
        text: "Abra o card, resolva devolutiva/documento e só então mova a coluna.",
        route: "/admin?tab=crm-clientes",
        selector: '[data-tour="ativos-kanban"]',
      },
      {
        text: "Validar dados: use o botão Validar quando precisar checar inconsistências em lote.",
        route: "/admin?tab=crm-clientes",
        selector: '[data-tour="ativos-validar"], [data-tour="ativos-toolbar"]',
      },
    ],
    11,
  ),
  article(
    "base-clientes",
    "Clientes e CRM",
    "Consulte a base de clientes",
    "Lista completa: novo cliente, sync iGreen, busca, filtros e ficha.",
    "/admin?tab=clientes",
    ["cadastro", "documento", "base", "pesquisar cliente", "lista", "sync"],
    [
      {
        text: "Menu → Base de clientes.",
        route: "/admin?tab=clientes",
        selector: '[data-tour="menu-clientes"]',
      },
      {
        text: "Novo cliente: cadastra manualmente quem ainda não veio da sync.",
        route: "/admin?tab=clientes",
        selector: '[data-tour="base-novo"]',
      },
      {
        text: "Menu ⋮ → Sincronizar iGreen para puxar a carteira oficial (respeite o cooldown).",
        route: "/admin?tab=clientes",
        selector: '[data-tour="base-sync-igreen"], [data-tour="base-novo"]',
      },
      {
        text: "Busca: nome, telefone, CPF ou e-mail.",
        route: "/admin?tab=clientes",
        selector: '[data-tour="base-busca"]',
      },
      {
        text: "Filtros: produto, status, licenciado, distribuidora e cidade.",
        route: "/admin?tab=clientes",
        selector: '[data-tour="base-filtros"]',
      },
      {
        text: "Clique na linha/card da lista para abrir o cadastro completo e o telefone.",
        route: "/admin?tab=clientes",
        selector: '[data-tour="base-lista"]',
      },
    ],
    12,
  ),
  article(
    "conversao",
    "Clientes e CRM",
    "Recupere oportunidades",
    "Fila Atender: precisa de você → quente → frio; abra e use Atender.",
    "/admin?tab=conversao",
    ["conversão", "reativar", "lead parado", "oportunidade", "quente", "frio", "atender"],
    [
      {
        text: "Menu → Conversão.",
        route: "/admin?tab=conversao",
        selector: '[data-tour="menu-conversao"]',
      },
      {
        text: "Fique na aba Atender — é a fila do dia.",
        route: "/admin?tab=conversao",
        selector: '[data-tour="conversao-tab-atender"]',
      },
      {
        text: "Prioridade 1: balde Precisa de você (automação pausada / humano).",
        route: "/admin?tab=conversao",
        selector: '[data-tour="conversao-balde-precisa"]',
      },
      {
        text: "Prioridade 2: Quente sem resposta.",
        route: "/admin?tab=conversao",
        selector: '[data-tour="conversao-balde-quente"]',
      },
      {
        text: "Abra um card e use Atender para mensagem sugerida ou chat.",
        route: "/admin?tab=conversao",
        selector: '[data-tour="conversao-atender"]',
      },
    ],
    13,
  ),
  article(
    "whatsapp-conectar",
    "WhatsApp e IA",
    "Conecte o WhatsApp",
    "QR Code até status conectado (Whapi). Não reconecte se já estiver AUTH.",
    "/admin?tab=whatsapp",
    ["qr code", "conectar", "número", "desconectado", "whatsapp", "chip", "whapi"],
    [
      {
        text: "Menu → WhatsApp.",
        route: "/admin?tab=whatsapp",
        selector: '[data-tour="menu-whatsapp"]',
      },
      {
        text: "Se desconectado, clique em Conectar WhatsApp.",
        route: "/admin?tab=whatsapp",
        selector: '[data-tour="wa-conectar"]',
      },
      {
        text: "Escaneie o QR com o celular (Aparelhos conectados). Se já conectado, o QR não deve reabrir sozinho.",
        route: "/admin?tab=whatsapp",
        selector: '[data-tour="wa-qr"], [data-tour="wa-conectar"]',
      },
      {
        text: "Após conectar, use Conversas e Mensagens prontas nas sub-abas.",
        route: "/admin?tab=whatsapp&section=conversas",
        selector: '[data-tour="wa-subtabs"]',
      },
    ],
    20,
    true,
  ),
  article(
    "whatsapp-atendimento",
    "WhatsApp e IA",
    "Atenda pelo WhatsApp",
    "Conversas, composer e Atendente IA — responder e devolver à automação.",
    "/admin?tab=whatsapp&section=conversas",
    ["conversa", "mensagem", "responder", "pausar ia", "humano", "atendente"],
    [
      {
        text: "Menu → WhatsApp.",
        route: "/admin?tab=whatsapp&section=conversas",
        selector: '[data-tour="menu-whatsapp"]',
      },
      {
        text: "Sub-aba Conversas (no celular: Chats).",
        route: "/admin?tab=whatsapp&section=conversas",
        selector: '[data-tour="wa-tab-conversas"]',
      },
      {
        text: "Escolha a conversa na lista — histórico à direita.",
        route: "/admin?tab=whatsapp&section=conversas",
        selector: '[data-tour="wa-panel-conversas"]',
      },
      {
        text: "Digite e envie no composer. Templates e mídia ficam aqui também.",
        route: "/admin?tab=whatsapp&section=conversas",
        selector: '[data-tour="wa-composer"], [data-tour="wa-panel-conversas"]',
      },
      {
        text: "Sub-aba Atendente IA: confira se a assistente está ativa e quando devolver o lead.",
        route: "/admin?tab=whatsapp&section=agente",
        selector: '[data-tour="wa-tab-agente"]',
      },
    ],
    21,
  ),
  article(
    "whatsapp-templates",
    "WhatsApp e IA",
    "Crie mensagens prontas",
    "Públicos, Meus templates e Criar — depois use no composer.",
    "/admin?tab=whatsapp&section=templates",
    ["template", "modelo", "mensagem pronta", "criar template", "rápida"],
    [
      {
        text: "Menu → WhatsApp.",
        route: "/admin?tab=whatsapp&section=templates",
        selector: '[data-tour="menu-whatsapp"]',
      },
      {
        text: "Abra Mensagens prontas.",
        route: "/admin?tab=whatsapp&section=templates",
        selector: '[data-tour="wa-tab-templates"]',
      },
      {
        text: "Meus templates: seus modelos editáveis.",
        route: "/admin?tab=whatsapp&section=templates",
        selector: '[data-tour="wa-templates-meus"]',
      },
      {
        text: "Criar meu template: nome, texto e mídia.",
        route: "/admin?tab=whatsapp&section=templates",
        selector: '[data-tour="wa-criar-template"]',
      },
      {
        text: "Para usar: Conversas → composer → escolha o modelo.",
        route: "/admin?tab=whatsapp&section=conversas",
        selector: '[data-tour="wa-tab-conversas"]',
      },
    ],
    25,
    true,
  ),
  article(
    "ia-conhecimento",
    "WhatsApp e IA",
    "Ensine a assistente de IA",
    "Base de conhecimento: seção, texto, sinônimos, índice e teste.",
    "/admin/conhecimento",
    ["faq", "base da ia", "conhecimento", "resposta", "embeddings"],
    [
      {
        text: "Abra a Base de conhecimento (/admin/conhecimento) — atalho pelo menu WhatsApp / ajuda.",
        route: "/admin/conhecimento",
        selector: '[data-tour="menu-whatsapp"]',
      },
      {
        text: "Crie ou edite uma seção com título claro (ex.: Cobertura CEMIG).",
        route: "/admin/conhecimento",
        selector: '[data-tour="menu-whatsapp"]',
      },
      {
        text: "Escreva a resposta completa que a assistente deve usar — sem inventar preço/prazo.",
        route: "/admin/conhecimento",
        selector: '[data-tour="menu-whatsapp"]',
      },
      {
        text: "Inclua sinônimos e frases que o cliente digita de verdade.",
        route: "/admin/conhecimento",
        selector: '[data-tour="menu-whatsapp"]',
      },
      {
        text: "Salve e atualize o índice da IA se a tela pedir.",
        route: "/admin/conhecimento",
        selector: '[data-tour="menu-whatsapp"]',
      },
      {
        text: "Teste no simulador ou WhatsApp antes de mudanças grandes.",
        route: "/admin?tab=whatsapp&section=agente",
        selector: '[data-tour="wa-tab-agente"]',
      },
    ],
    22,
    true,
  ),
  article(
    "fluxos",
    "WhatsApp e IA",
    "Configure o fluxo de atendimento",
    "Editor avançado: um passo por vez, simular, só então ativar.",
    "/admin/fluxos",
    ["fluxo", "mensagem automática", "passo", "pergunta", "editor", "simulador"],
    [
      {
        text: "Abra Fluxos em /admin/fluxos (atalho: WhatsApp → Roteiros do bot).",
        route: "/admin/fluxos",
        selector: '[data-tour="wa-roteiros"], [data-tour="menu-whatsapp"]',
      },
      {
        text: "Escolha o fluxo na lista e clique em um passo para editar.",
        route: "/admin/fluxos",
        selector: '[data-tour="wa-roteiros"], [data-tour="menu-whatsapp"]',
      },
      {
        text: "Altere mensagem/pergunta/saídas — um passo por vez.",
        route: "/admin/fluxos",
        selector: '[data-tour="menu-whatsapp"]',
      },
      {
        text: "Salve e use o simulador da tela.",
        route: "/admin/fluxos",
        selector: '[data-tour="menu-whatsapp"]',
      },
      {
        text: "Só publique depois do teste. Em dúvida, suporte com IA antes de mudar o fluxo principal.",
        route: "/ajuda",
        selector: '[data-tour="menu-ajuda"]',
      },
    ],
    23,
  ),
  article(
    "audio-studio",
    "WhatsApp e IA",
    "Use o Estúdio de áudio",
    "Tipo → voz → Gerar → ouvir → Baixar → enviar no WhatsApp.",
    "/admin?tab=audio-studio",
    ["áudio", "estúdio", "gerar", "sofia", "vinheta", "diego"],
    [
      {
        text: "Menu (Recursos) → Estúdio de áudio.",
        route: "/admin?tab=audio-studio",
        selector: '[data-tour="menu-audio-studio"]',
      },
      {
        text: "Escolha o tipo: Mutirão, Comércio ou Texto livre.",
        route: "/admin?tab=audio-studio",
        selector: '[data-tour="audio-tipo-mutirao"]',
      },
      {
        text: "Preencha cidade/texto e escolha a voz pública (Sofia ou Diego). A voz Rafael é privada e não aparece para consultores.",
        route: "/admin?tab=audio-studio",
        selector: '[data-tour="audio-tipo-comercio"], [data-tour="audio-tipo-livre"]',
      },
      {
        text: "Clique em Gerar áudio e ouça a prévia.",
        route: "/admin?tab=audio-studio",
        selector: '[data-tour="audio-gerar"]',
      },
      {
        text: "Baixar áudio (com/sem vinheta conforme a opção).",
        route: "/admin?tab=audio-studio",
        selector: '[data-tour="audio-baixar"], [data-tour="audio-gerar"]',
      },
      {
        text: "Envie no WhatsApp → Conversas anexando o arquivo, ou use o atalho WhatsApp da tela se aparecer.",
        route: "/admin?tab=whatsapp&section=conversas",
        selector: '[data-tour="wa-tab-conversas"]',
      },
    ],
    24,
  ),
  article(
    "captacao",
    "Captação e anúncios",
    "Acompanhe a captação",
    "Lista de leads novos/formulário: buscar, selecionar e iniciar atendimento.",
    "/admin?tab=captacao",
    ["captação", "lead ads", "origem", "formulário", "em espera"],
    [
      {
        text: "Menu → Captação.",
        route: "/admin?tab=captacao",
        selector: '[data-tour="menu-captacao"]',
      },
      {
        text: "Busque por nome ou telefone.",
        route: "/admin?tab=captacao",
        selector: '[data-tour="captacao-busca"]',
      },
      {
        text: "Selecione um ou mais leads e clique em Iniciar atendimento.",
        route: "/admin?tab=captacao",
        selector: '[data-tour="captacao-iniciar"], [data-tour="captacao-busca"]',
      },
      {
        text: "Depois acompanhe em Clientes interessados / WhatsApp.",
        route: "/admin?tab=crm",
        selector: '[data-tour="menu-crm"]',
      },
    ],
    30,
  ),
  article(
    "central-anuncios",
    "Captação e anúncios",
    "Use a Central de anúncios",
    "Navegação: Resumo → Modelos → Campanhas → Resultados → Assistente → Comissões + criar anúncio.",
    "/admin?tab=central-anuncios",
    ["central de anúncios", "campanhas", "resultados", "resumo ads", "meta"],
    [
      {
        text: "Menu (Recursos) → Central de anúncios.",
        route: "/admin?tab=central-anuncios",
        selector: '[data-tour="menu-central-anuncios"]',
      },
      {
        text: "Resumo (Dashboard): visão rápida de gasto e resultado.",
        route: "/admin?tab=central-anuncios",
        selector: '[data-tour="ads-nav-dashboard"]',
      },
      {
        text: "Modelos: templates prontos de campanha.",
        route: "/admin?tab=central-anuncios",
        selector: '[data-tour="ads-nav-gallery"]',
      },
      {
        text: "Campanhas: lista e status (ativa, pausada, reprovada).",
        route: "/admin?tab=central-anuncios",
        selector: '[data-tour="ads-nav-campaigns"]',
      },
      {
        text: "Resultados (Performance): CPL, leads e desperdício.",
        route: "/admin?tab=central-anuncios",
        selector: '[data-tour="ads-nav-performance"]',
      },
      {
        text: "Criar: Anúncio inteligente (simples) ou Anúncio completo (controle total).",
        route: "/admin?tab=central-anuncios",
        selector: '[data-tour="ads-anuncio-inteligente"]',
      },
      {
        text: "Anúncio completo quando quiser cidade, textos e dias à mão.",
        route: "/admin?tab=central-anuncios",
        selector: '[data-tour="ads-anuncio-completo"]',
      },
      {
        text: "Comissões: acompanhe o que a campanha gerou para parceiros/rede.",
        route: "/admin?tab=central-anuncios",
        selector: '[data-tour="ads-nav-commissions"]',
      },
    ],
    31,
    true,
  ),
  article(
    "meta-ads",
    "Captação e anúncios",
    "Crie uma campanha Meta",
    "WhatsApp ok → inteligente ou completo → revisar → publicar → Resultados.",
    "/admin?tab=central-anuncios",
    ["facebook", "instagram", "campanha", "anúncio", "meta", "cpl", "publicar", "inteligente"],
    [
      {
        text: "Central de anúncios no menu.",
        route: "/admin?tab=central-anuncios",
        selector: '[data-tour="menu-central-anuncios"]',
      },
      {
        text: "Confirme WhatsApp conectado antes de publicar.",
        route: "/admin?tab=whatsapp",
        selector: '[data-tour="menu-whatsapp"]',
      },
      {
        text: "Volte e clique em Anúncio inteligente (caminho recomendado).",
        route: "/admin?tab=central-anuncios",
        selector: '[data-tour="ads-anuncio-inteligente"]',
      },
      {
        text: "Ou Anúncio completo para escolher região, criativo, texto e orçamento.",
        route: "/admin?tab=central-anuncios",
        selector: '[data-tour="ads-anuncio-completo"]',
      },
      {
        text: "Avance as etapas, revise e publique. Depois abra Campanhas ou Resultados.",
        route: "/admin?tab=central-anuncios",
        selector: '[data-tour="ads-nav-campaigns"]',
      },
      {
        text: "Resultados: acompanhe CPL e pause o que estiver desperdiçando.",
        route: "/admin?tab=central-anuncios",
        selector: '[data-tour="ads-nav-performance"]',
      },
    ],
    32,
    true,
  ),
  article(
    "campanha-reprovada",
    "Captação e anúncios",
    "Resolva uma campanha reprovada",
    "Leia o motivo Meta em Campanhas, corrija criativo/destino e reenvie.",
    "/admin?tab=central-anuncios",
    ["reprovada", "erro meta", "2446885", "whatsapp business", "política"],
    [
      {
        text: "Central de anúncios → aba Campanhas.",
        route: "/admin?tab=central-anuncios",
        selector: '[data-tour="ads-nav-campaigns"]',
      },
      {
        text: "Abra a campanha reprovada e leia o motivo completo (não invente a causa).",
        route: "/admin?tab=central-anuncios",
        selector: '[data-tour="ads-nav-campaigns"]',
      },
      {
        text: "Confirme WhatsApp Business / conexão Meta válidos.",
        route: "/admin?tab=whatsapp",
        selector: '[data-tour="menu-whatsapp"]',
      },
      {
        text: "Corrija texto, imagem ou público; salve e envie de novo.",
        route: "/admin?tab=central-anuncios",
        selector: '[data-tour="ads-nav-campaigns"]',
      },
      {
        text: "Se o motivo continuar obscuro: Central de ajuda → suporte com o nome da campanha e o erro.",
        route: "/ajuda",
        selector: '[data-tour="ajuda-busca"], [data-tour="menu-ajuda"]',
      },
    ],
    33,
  ),
  article(
    "links",
    "Captação e anúncios",
    "Compartilhe seus links",
    "Meus Links, copiar por produto, QR e panfleto para gráfica.",
    "/admin?tab=links",
    ["link", "página", "landing page", "divulgar", "licença", "copiar", "qr"],
    [
      {
        text: "Menu → Links.",
        route: "/admin?tab=links",
        selector: '[data-tour="menu-links"]',
      },
      {
        text: "Aba Meus Links.",
        route: "/admin?tab=links",
        selector: '[data-tour="links-meus"]',
      },
      {
        text: "Copie o link do produto/rede desejada e teste no navegador.",
        route: "/admin?tab=links",
        selector: '[data-tour="links-copiar"], [data-tour="links-meus"]',
      },
      {
        text: "Panfleto pra gráfica → Gerar para impressão com QR.",
        route: "/admin?tab=links",
        selector: '[data-tour="links-panfleto"], [data-tour="links-panfleto-gerar"]',
      },
    ],
    34,
  ),
  article(
    "materiais",
    "Captação e anúncios",
    "Baixe materiais de divulgação",
    "Abas por tema, grade de arquivos, Drive extra e envio no Zap.",
    "/admin?tab=materiais",
    ["material", "baixar", "arquivo", "imagem", "vídeo", "divulgação", "drive"],
    [
      {
        text: "Menu (Recursos) → Materiais.",
        route: "/admin?tab=materiais",
        selector: '[data-tour="menu-materiais"]',
      },
      {
        text: "Escolha a aba do tema (notícias, depoimentos, cashback, etc.).",
        route: "/admin?tab=materiais",
        selector: '[data-tour="materiais-tabs"]',
      },
      {
        text: "Na grade, abra o card e baixe ou envie pelo WhatsApp.",
        route: "/admin?tab=materiais",
        selector: '[data-tour="materiais-grid"]',
      },
      {
        text: "Materiais extras no Drive: pasta com arquivos adicionais da rede.",
        route: "/admin?tab=materiais",
        selector: '[data-tour="materiais-drive"]',
      },
      {
        text: "Antes de anunciar na Meta, confira se o criativo está atualizado e permitido.",
        route: "/admin?tab=central-anuncios",
        selector: '[data-tour="ads-anuncio-inteligente"]',
      },
    ],
    35,
  ),
  article(
    "agendamentos",
    "Automações",
    "Central de agendamentos",
    "Mapa A/B/C, quem esfriou, agenda manual, futuros, carteira e histórico.",
    "/admin?tab=agendamentos",
    ["agendamento", "automação", "quem esfriou", "agenda", "programada", "grupo a", "grupo b"],
    [
      {
        text: "Menu → Agendamentos.",
        route: "/admin?tab=agendamentos",
        selector: '[data-tour="menu-agendamentos"]',
      },
      {
        text: "Abas do hub: Mapa, Leads novos, Quem esfriou, Quem sumiu, Agenda…",
        route: "/admin?tab=agendamentos",
        selector: '[data-tour="agenda-tabs"]',
      },
      {
        text: "Mapa: visão geral dos grupos A/B/C.",
        route: "/admin?tab=agendamentos&hubTab=mapa",
        selector: '[data-tour="agenda-tab-mapa"]',
      },
      {
        text: "Quem esfriou (Grupo B): retome quem parou de responder.",
        route: "/admin?tab=agendamentos&hubTab=grupo-b",
        selector: '[data-tour="agenda-tab-grupo-b"]',
      },
      {
        text: "Agenda: envios que você marcou. Use Agendar nova.",
        route: "/admin?tab=agendamentos&hubTab=agenda",
        selector: '[data-tour="agenda-agendar"], [data-tour="agenda-tab-agenda"]',
      },
      {
        text: "Histórico: o que já saiu (WhatsApp, SMS, voz).",
        route: "/admin?tab=agendamentos&hubTab=historico",
        selector: '[data-tour="agenda-tab-historico"]',
      },
    ],
    40,
  ),
  article(
    "cadencia",
    "Automações",
    "Configure o Motor de cadência",
    "Ligar/desligar, intervalos, limites e horários — preferir via Quem esfriou.",
    "/admin/motor",
    ["cadência", "follow-up", "ligação", "sms", "sem resposta", "grupo b"],
    [
      {
        text: "Caminho recomendado: Agendamentos → Quem esfriou (atalho /admin/motor).",
        route: "/admin?tab=agendamentos&hubTab=grupo-b",
        selector: '[data-tour="agenda-tab-grupo-b"]',
      },
      {
        text: "No motor, leia Ligado/Desligado no topo.",
        route: "/admin/motor",
        selector: '[data-tour="menu-agendamentos"]',
      },
      {
        text: "Para ligar: switch → Confirmar e ligar. Revise estágios e limites WA/SMS/voz.",
        route: "/admin/motor",
        selector: '[data-tour="menu-agendamentos"]',
      },
      {
        text: "Defina dias/horários permitidos antes de ampliar volume. Salve no rodapé.",
        route: "/admin/motor",
        selector: '[data-tour="menu-agendamentos"]',
      },
      {
        text: "Se algo sair do esperado: Desligado e suporte com IA.",
        route: "/ajuda",
        selector: '[data-tour="menu-ajuda"]',
      },
    ],
    41,
  ),
  article(
    "reaquecimento",
    "Automações",
    "Reaqueça contatos parados",
    "Retomada controlada via Quem esfriou + histórico.",
    "/admin/reaquecimento",
    ["reaquecimento", "reativação", "followup", "frio", "grupo b"],
    [
      {
        text: "Agendamentos → Quem esfriou.",
        route: "/admin?tab=agendamentos&hubTab=grupo-b",
        selector: '[data-tour="agenda-tab-grupo-b"]',
      },
      {
        text: "Escolha o grupo e revise a mensagem/intervalos na tela.",
        route: "/admin?tab=agendamentos&hubTab=grupo-b",
        selector: '[data-tour="agenda-tabs"]',
      },
      {
        text: "Comece pequeno — evite massa no primeiro teste.",
        route: "/admin?tab=agendamentos&hubTab=grupo-b",
        selector: '[data-tour="agenda-tab-grupo-b"]',
      },
      {
        text: "Acompanhe em Histórico; pause se não houver retorno.",
        route: "/admin?tab=agendamentos&hubTab=historico",
        selector: '[data-tour="agenda-tab-historico"]',
      },
    ],
    42,
  ),
  article(
    "ligacao",
    "Automações",
    "Faça ligações pela plataforma",
    "Nova ligação, SMS, bases, Não Perturbe, ciclo, textos, histórico e painel.",
    "/admin?tab=voz",
    ["ligação", "voz", "telefone", "discador", "sms", "gravar", "não perturbe"],
    [
      {
        text: "Menu (Recursos) → Ligação.",
        route: "/admin?tab=voz",
        selector: '[data-tour="menu-voz"]',
      },
      {
        text: "Aba Nova ligação: áudio Sofia / gravar / upload e iniciar.",
        route: "/admin?tab=voz",
        selector: '[data-tour="voz-tab-nova"]',
      },
      {
        text: "SMS: envios de texto pela mesma base.",
        route: "/admin?tab=voz",
        selector: '[data-tour="voz-tab-sms"]',
      },
      {
        text: "Bases: listas de números. Não Perturbe: quem nunca mais contatar.",
        route: "/admin?tab=voz",
        selector: '[data-tour="voz-tab-bases"]',
      },
      {
        text: "Não Perturbe (bloqueados): respeite sempre — fora de envios automáticos.",
        route: "/admin?tab=voz",
        selector: '[data-tour="voz-tab-dnc"]',
      },
      {
        text: "Programação do ciclo e Textos automáticos: horários e conteúdo.",
        route: "/admin?tab=voz",
        selector: '[data-tour="voz-tab-ciclo"]',
      },
      {
        text: "Histórico e Painel: o que saiu e métricas. Ajuda interna: leia na primeira vez.",
        route: "/admin?tab=voz",
        selector: '[data-tour="voz-tab-historico"]',
      },
      {
        text: "Aba Ajuda do módulo: o que este módulo faz, passo a passo.",
        route: "/admin?tab=voz",
        selector: '[data-tour="voz-tab-ajuda"]',
      },
    ],
    43,
  ),
  article(
    "produtos",
    "Produtos e vendas",
    "Gerencie produtos e vendas",
    "Acompanhamento, orçamentos, pipeline, catálogo e estudo solar.",
    "/admin?tab=produtos",
    ["produto", "venda", "proposta", "orçamento", "pipeline", "solar"],
    [
      {
        text: "Menu → Produtos & Vendas.",
        route: "/admin?tab=produtos",
        selector: '[data-tour="menu-produtos"]',
      },
      {
        text: "Acompanhamento: visão das oportunidades e cross-sell.",
        route: "/admin?tab=produtos",
        selector: '[data-tour="prod-tab-acompanhamento"]',
      },
      {
        text: "Orçamentos: crie e edite propostas (Novo orçamento).",
        route: "/admin?tab=produtos",
        selector: '[data-tour="prod-tab-orcamentos"]',
      },
      {
        text: "Vendas em andamento (Pipeline): arraste conforme o avanço.",
        route: "/admin?tab=produtos",
        selector: '[data-tour="prod-tab-pipeline"]',
      },
      {
        text: "Catálogo: produtos disponíveis para proposta.",
        route: "/admin?tab=produtos",
        selector: '[data-tour="prod-tab-catalogo"]',
      },
      {
        text: "Ações rápidas (Novo orçamento) e atalho Projeto solar.",
        route: "/admin?tab=produtos",
        selector: '[data-tour="prod-acoes"], [data-tour="prod-solar"]',
      },
    ],
    50,
    true,
  ),
  article(
    "solar",
    "Produtos e vendas",
    "Crie um estudo solar",
    "Endereço, telhado, painéis, salvar e usar no orçamento.",
    "/admin/solar-design",
    ["solar", "telhado", "painel", "projeto", "economia"],
    [
      {
        text: "Abra Projeto solar (/admin/solar-design) ou o atalho em Produtos.",
        route: "/admin/solar-design",
        selector: '[data-tour="prod-solar"], [data-tour="menu-produtos"]',
      },
      {
        text: "Informe o endereço e confirme no mapa.",
        route: "/admin/solar-design",
        selector: '[data-tour="prod-solar"], [data-tour="menu-produtos"]',
      },
      {
        text: "Ajuste painéis no telhado e salve o estudo.",
        route: "/admin/solar-design",
        selector: '[data-tour="prod-solar"], [data-tour="menu-produtos"]',
      },
      {
        text: "Volte em Produtos → Orçamentos e use o estudo na proposta.",
        route: "/admin?tab=produtos",
        selector: '[data-tour="prod-tab-orcamentos"]',
      },
    ],
    51,
  ),
  article(
    "parceiros",
    "Captação e anúncios",
    "Rede de parceiros",
    "Cadastro, abas por parceiro, palavra-chave, QR, banners e ranking de indicações.",
    "/admin?tab=parceiros",
    [
      "parceiro",
      "indicação",
      "comissão",
      "rede",
      "qr",
      "keyword",
      "banner",
      "visão geral",
      "ranking",
    ],
    [
      {
        text: "Menu → Parceiros — aqui fica a sua rede de indicadores.",
        route: "/admin?tab=parceiros",
        selector: '[data-tour="menu-parceiros"]',
      },
      {
        text: "Cabeçalho: título da rede e atalhos principais.",
        route: "/admin?tab=parceiros",
        selector: '[data-tour="parceiros-header"], [data-tour="parceiros-page"]',
      },
      {
        text: "Meus banners: materiais e QR dos seus pontos (consultor).",
        route: "/admin?tab=parceiros",
        selector: '[data-tour="parceiros-banners"]',
      },
      {
        text: "Novo: cadastra nome, palavra-chave, frase do WhatsApp e telefone de aviso.",
        route: "/admin?tab=parceiros",
        selector: '[data-tour="parceiros-novo"], [data-tour="parceiros-novo-cta"], [data-tour="parceiros-vazio"]',
      },
      {
        text: "Abas: Visão geral + um nome por parceiro. Clique no nome para abrir tudo dele.",
        route: "/admin?tab=parceiros",
        selector: '[data-tour="parceiros-tabs"], [data-tour="parceiros-page"]',
      },
      {
        text: "Se aparecer Fila de revisão: lead de campanha com pool que falhou na atribuição — escolha o parceiro manualmente.",
        route: "/admin?tab=parceiros",
        selector: '[data-tour="parceiros-revisao"], [data-tour="parceiros-page"]',
      },
      {
        text: "Visão geral: pódio e quem mais indicou nos últimos 30 dias.",
        route: "/admin?tab=parceiros",
        selector: '[data-tour="parceiros-podium"], [data-tour="parceiros-kpis"], [data-tour="parceiros-overview"]',
      },
      {
        text: "KPIs: parceiros ativos, interessados (30 dias), conversão e destaque.",
        route: "/admin?tab=parceiros",
        selector: '[data-tour="parceiros-kpis"], [data-tour="parceiros-overview"]',
      },
      {
        text: "Gráficos: volume, tendência, funil e origem das indicações.",
        route: "/admin?tab=parceiros",
        selector: '[data-tour="parceiros-charts"], [data-tour="parceiros-overview"]',
      },
      {
        text: "Ranking detalhado: editar, QR e comparar parceiros lado a lado.",
        route: "/admin?tab=parceiros",
        selector: '[data-tour="parceiros-ranking"], [data-tour="parceiros-overview"]',
      },
      {
        text: "Abra a aba de um parceiro (nome na faixa de abas).",
        route: "/admin?tab=parceiros",
        selector: '[data-tour="parceiros-tab-partner"], [data-tour="parceiros-tabs"]',
      },
      {
        text: "Card do parceiro: status, código curto e leads recentes.",
        route: "/admin?tab=parceiros",
        selector: '[data-tour="parceiros-card"], [data-tour="parceiros-workspace"]',
      },
      {
        text: "Palavra-chave: o WhatsApp usa isso (ou o marcador #R do código) para atribuir o lead a este parceiro — não escolhe campanha Meta.",
        route: "/admin?tab=parceiros",
        selector: '[data-tour="parceiros-keywords"], [data-tour="parceiros-workspace"]',
      },
      {
        text: "Frase WhatsApp: texto que vai no link/QR quando o lead escaneia.",
        route: "/admin?tab=parceiros",
        selector: '[data-tour="parceiros-frase"], [data-tour="parceiros-workspace"]',
      },
      {
        text: "Editar dados: corrige keyword, frase, ID iGreen e telefone de notificação.",
        route: "/admin?tab=parceiros",
        selector: '[data-tour="parceiros-editar"], [data-tour="parceiros-workspace"]',
      },
      {
        text: "Baixar QR: gere o QR/link para o parceiro indicar leads.",
        route: "/admin?tab=parceiros",
        selector: '[data-tour="parceiros-qr"], [data-tour="parceiros-workspace"]',
      },
      {
        text: "Banners do parceiro: link do portal, pontos nomeados e materiais dele.",
        route: "/admin?tab=parceiros",
        selector: '[data-tour="parceiros-banners-panel"], [data-tour="parceiros-link"], [data-tour="parceiros-workspace"]',
      },
      {
        text: "Rodízio de anúncios (Meta) atribui por UUID de campanha — separado da keyword. Comissões ficam em Anúncios.",
        route: "/admin?tab=central-anuncios",
        selector: '[data-tour="ads-nav-commissions"], [data-tour="menu-central-anuncios"]',
      },
    ],
    52,
    true,
  ),
  article(
    "financeiro",
    "Financeiro",
    "Acompanhe o financeiro",
    "Boletos, recebíveis, carteira Green e extrato (admin).",
    "/admin?tab=financeiro",
    ["boleto", "financeiro", "recebível", "carteira", "vencimento", "extrato"],
    [
      {
        text: "Menu → Financeiro.",
        route: "/admin?tab=financeiro",
        selector: '[data-tour="menu-financeiro"]',
      },
      {
        text: "Boletos: vencimentos e status de pagamento.",
        route: "/admin?tab=financeiro",
        selector: '[data-tour="fin-tab-boletos"]',
      },
      {
        text: "Recebíveis: ganhos da Conexão Green.",
        route: "/admin?tab=financeiro",
        selector: '[data-tour="fin-tab-recebiveis"]',
      },
      {
        text: "Carteira Green: adimplência e métricas iGreen.",
        route: "/admin?tab=financeiro",
        selector: '[data-tour="fin-tab-carteira"]',
      },
      {
        text: "Extrato (se liberado): movimentos detalhados.",
        route: "/admin?tab=financeiro",
        selector: '[data-tour="fin-tab-extrato"], [data-tour="fin-tab-carteira"]',
      },
    ],
    60,
  ),
  article(
    "pos-venda",
    "Pós-venda",
    "Acompanhe o pós-venda",
    "Kanban de Clientes ativos + mensagens automáticas em Agendamentos.",
    "/admin?tab=crm-clientes",
    ["pós-venda", "devolutiva", "assinatura", "aprovado", "30 dias"],
    [
      {
        text: "Menu → Clientes ativos.",
        route: "/admin?tab=crm-clientes",
        selector: '[data-tour="menu-crm-clientes"]',
      },
      {
        text: "Use busca e filtros da barra.",
        route: "/admin?tab=crm-clientes",
        selector: '[data-tour="ativos-toolbar"]',
      },
      {
        text: "Trabalhe o kanban: análise → assinatura → aprovado → 30–120 dias.",
        route: "/admin?tab=crm-clientes",
        selector: '[data-tour="ativos-kanban"]',
      },
      {
        text: "Resolva devolutiva antes de mover o card; registre o contato.",
        route: "/admin?tab=crm-clientes",
        selector: '[data-tour="ativos-kanban"]',
      },
      {
        text: "Automações de pós-venda: Agendamentos → Agenda (revise antes de ampliar).",
        route: "/admin?tab=agendamentos&hubTab=agenda",
        selector: '[data-tour="agenda-tab-agenda"]',
      },
    ],
    70,
  ),
  article(
    "academy",
    "Primeiros passos",
    "Aprenda na Academy",
    "Catálogo de trilhas, aulas, anotações e provas.",
    "/admin?tab=academy",
    ["academy", "curso", "aula", "treinamento", "prova"],
    [
      {
        text: "Menu (Recursos) → Academy.",
        route: "/admin?tab=academy",
        selector: '[data-tour="menu-academy"]',
      },
      {
        text: "Catálogo: escolha trilha ou aula.",
        route: "/admin?tab=academy",
        selector: '[data-tour="academy-catalog"]',
      },
      {
        text: "Assista, anote e faça a prova quando disponível — o progresso fica salvo.",
        route: "/admin?tab=academy",
        selector: '[data-tour="academy-catalog"]',
      },
      {
        text: "Volte depois pela mesma trilha; use Central de ajuda se travar em algum módulo.",
        route: "/ajuda",
        selector: '[data-tour="menu-ajuda"]',
      },
    ],
    80,
  ),
  article(
    "conta-dados",
    "Conta e suporte",
    "Atualize seus dados da conta",
    "Configurações: nome, ID iGreen, automações, senha e WhatsApp.",
    "/admin?tab=dashboard",
    ["dados", "perfil", "configurações", "id igreen", "conta", "senha"],
    [
      {
        text: "Abra Configurações (engrenagem no menu esquerdo).",
        route: "/admin?tab=dashboard",
        selector: '[data-tour="menu-config"]',
      },
      {
        text: "Painel lateral de configurações: dados do perfil.",
        route: "/admin?tab=dashboard",
        selector: '[data-tour="cfg-sheet"], [data-tour="cfg-dados"]',
      },
      {
        text: "Confirme nome e telefone.",
        route: "/admin?tab=dashboard",
        selector: '[data-tour="cfg-nome"]',
      },
      {
        text: "ID iGreen correto — base da sync e dos links de cadastro.",
        route: "/admin?tab=dashboard",
        selector: '[data-tour="cfg-igreen-id"]',
      },
      {
        text: "Mensagens automáticas / Cérebro: ligue só o que quiser (default Cérebro off).",
        route: "/admin?tab=dashboard",
        selector: '[data-tour="cfg-automacoes"]',
      },
      {
        text: "Troque a senha no card de senha, se precisar.",
        route: "/admin?tab=dashboard",
        selector: '[data-tour="cfg-senha"]',
      },
      {
        text: "Salvar Dados no rodapé e feche o painel.",
        route: "/admin?tab=dashboard",
        selector: '[data-tour="cfg-salvar"]',
      },
    ],
    91,
  ),
  article(
    "saude-bot",
    "Conta e suporte",
    "Veja a saúde do atendimento",
    "Alertas de WhatsApp, fluxo e automação — corrija e revalide.",
    "/admin/saude-bot",
    ["saúde", "bot", "alerta", "diagnóstico", "atendimento"],
    [
      {
        text: "Abra Saúde do atendimento (/admin/saude-bot).",
        route: "/admin/saude-bot",
        selector: '[data-tour="menu-whatsapp"]',
      },
      {
        text: "Leia os alertas (WhatsApp, fluxo, automação).",
        route: "/admin/saude-bot",
        selector: '[data-tour="menu-whatsapp"]',
      },
      {
        text: "Siga o link da área indicada (ex.: reconectar WhatsApp).",
        route: "/admin?tab=whatsapp",
        selector: '[data-tour="menu-whatsapp"]',
      },
      {
        text: "Volte e confira se o alerta sumiu; se persistir, suporte com IA.",
        route: "/ajuda",
        selector: '[data-tour="menu-ajuda"]',
      },
    ],
    92,
  ),
  article(
    "suporte",
    "Conta e suporte",
    "Peça ajuda ao suporte",
    "Central de ajuda + IA com dados da sua operação + tour da plataforma.",
    "/ajuda?suporte=1",
    ["ajuda", "suporte", "erro", "problema", "humano", "ia", "central"],
    [
      {
        text: "Abra a Central de ajuda no menu (ou /ajuda).",
        route: "/ajuda",
        selector: '[data-tour="menu-ajuda"]',
      },
      {
        text: "Busque a tarefa ou o erro (ex.: campanha reprovada, WhatsApp).",
        route: "/ajuda",
        selector: '[data-tour="ajuda-busca"]',
      },
      {
        text: "Ajuda rápida: guias em destaque para o dia a dia.",
        route: "/ajuda",
        selector: '[data-tour="ajuda-destaques"]',
      },
      {
        text: "Lista completa por assunto à esquerda / filtros.",
        route: "/ajuda",
        selector: '[data-tour="ajuda-guias"]',
      },
      {
        text: "Em cada guia: Me leve e explique (tour guiado) ou Tour da plataforma.",
        route: "/ajuda",
        selector: '[data-tour="ajuda-tour-plataforma"]',
      },
      {
        text: "Perguntar ao suporte com IA (? verde): descreva tela, botão e erro. A conversa fica salva.",
        route: "/ajuda?suporte=1",
        selector: '[data-tour="ajuda-busca"]',
      },
    ],
    90,
    true,
  ),
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

/** Resolve guia por id completo (`guia-…`) ou slug (`whatsapp-conectar`). */
export function getHelpArticleById(idOrSlug: string, source: HelpArticle[] = HELP_CATALOG): HelpArticle | undefined {
  const raw = idOrSlug.trim();
  if (!raw) return undefined;
  const withPrefix = raw.startsWith("guia-") ? raw : `guia-${raw}`;
  return source.find((item) => item.id === raw || item.id === withPrefix);
}

export function mergeHelpArticles(rows: TourArticle[], steps: TourStep[]): HelpArticle[] {
  const stepById = new Map(steps.map((step) => [step.id, step]));
  const dynamic = rows.map((row): HelpArticle => {
    const linked = row.related_tour_step_id ? stepById.get(row.related_tour_step_id) : undefined;
    const parsedSteps = row.body.split("\n").map((line) => line.replace(/^\s*\d+[.)-]?\s*/, "").trim()).filter(Boolean);
    const href = linked?.cta_href || linked?.route || "/admin";
    const menuSel = menuSelectorFromHref(href);
    return {
      ...row,
      summary: parsedSteps[0] || row.body.slice(0, 180),
      href,
      keywords: [row.category, row.title],
      steps: parsedSteps,
      guidedSteps: parsedSteps.map((text, index) => ({
        text,
        route: href,
        selector: index === 0 ? menuSel : menuSel,
      })),
    };
  });
  // Catálogo local (com seletores ricos) prevalece sobre artigos do banco com o mesmo título.
  const catalogByTitle = new Map(HELP_CATALOG.map((item) => [normalize(item.title), item]));
  const mergedDynamic = dynamic.map((item) => catalogByTitle.get(normalize(item.title)) || item);
  const usedTitles = new Set(mergedDynamic.map((item) => normalize(item.title)));
  return [...mergedDynamic, ...HELP_CATALOG.filter((item) => !usedTitles.has(normalize(item.title)))];
}

/** Texto compacto para injetar no prompt da IA (edge functions). */
export function formatHelpCatalogForAi(source: HelpArticle[] = HELP_CATALOG): string {
  return source
    .map((item) => {
      const steps = item.steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
      return `[${item.category}] ${item.title}\nResumo: ${item.summary}\nAbra: ${item.href}\n${steps}`;
    })
    .join("\n\n");
}
