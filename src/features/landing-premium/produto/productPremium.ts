/**
 * Camada premium dos produtos Conexão.
 *
 * ── O que este arquivo é ───────────────────────────────────────────────────
 * O catálogo real (`src/data/conexaoProducts.ts`) guarda os FATOS: preços,
 * coberturas, percentuais, imagens, vídeos, FAQ. Aqui fica o POSICIONAMENTO:
 * qual é o problema que cada produto resolve, em que ordem contar a história,
 * quais objeções derrubar e qual a próxima ação.
 *
 * ── Regra que este arquivo segue ──────────────────────────────────────────
 * Nenhum número, cobertura, preço, prazo ou especificação nasce aqui. Todo
 * valor citado existe no catálogo original. O que muda é a forma de contar:
 * característica ("planos a partir de R$ 39,90") vira benefício ("a conta do
 * celular cabe no orçamento sem perder 5G").
 *
 * ── Por que cada produto tem estrutura própria ────────────────────────────
 * Um produto de proteção veicular não se vende como um clube de descontos.
 * Cada configuração escolhe suas próprias seções e a ordem delas — as páginas
 * compartilham o design system, não o roteiro.
 */

import { conexaoProducts } from "@/data/conexaoProducts";
import type { ProdutoSlug } from "../shared/premiumRoutes";

/* ══════════════════════════════════════════════════════════════
   Tipos
   ══════════════════════════════════════════════════════════════ */

export interface ItemTexto {
  t: string;
  b: string;
}

export interface PassoPremium {
  n: string;
  t: string;
  b: string;
  meta: string;
}

export interface DestaquePremium {
  icone: string;
  t: string;
  b: string;
}

export interface PlanoPremium {
  nome: string;
  resumo: string;
  itens: string[];
  destaque?: boolean;
}

export interface GaleriaPremium {
  titulo: string;
  intro: string;
  /** Caminhos completos, já resolvidos. */
  imagens: string[];
  /** Muda o formato do grid e a proporção. */
  formato: "planos" | "clientes" | "marcas" | "documento";
  /** Texto alternativo base — o índice é acrescentado. */
  altBase: string;
}

export interface VideoExtra {
  id: string;
  titulo: string;
  sub?: string;
}

/** Seções possíveis. A ordem no array define a ordem na página. */
export type BlocoPremium =
  | "problema"
  | "solucao"
  | "planos"
  | "passos"
  | "destaques"
  | "galeria"
  | "comparacao"
  | "videos"
  | "objecoes"
  | "faq";

export interface ProdutoPremium {
  slug: ProdutoSlug;
  /** Nome exibido (curto, sem "Conexão" quando redundante). */
  nome: string;
  marca: string;
  /** Para quem é — aparece no hero como qualificador. */
  publico: string;

  eyebrow: string;
  h1: { antes: string; destaque: string; depois?: string };
  sub: string;
  /** Frase curta abaixo dos CTAs, reduzindo risco. */
  reducaoRisco: string;

  ctaPrincipal: string;
  waPrincipal: string;

  confianca: { label: string; detalhe: string }[];
  numeros?: { valor: string; rotulo: string }[];

  problema?: { eyebrow: string; titulo: string; destaque?: string; intro: string; itens: ItemTexto[] };
  solucao?: { eyebrow: string; titulo: string; intro: string; pontos: ItemTexto[] };
  passos?: { eyebrow: string; titulo: string; intro: string; lista: PassoPremium[] };
  destaques?: { eyebrow: string; titulo: string; intro: string; lista: DestaquePremium[] };
  planos?: { eyebrow: string; titulo: string; intro: string; lista: PlanoPremium[]; nota?: string };
  galeria?: GaleriaPremium;
  comparacao?: {
    eyebrow: string;
    titulo: string;
    antes: { titulo: string; itens: string[] };
    depois: { titulo: string; itens: string[] };
  };
  videos?: { eyebrow: string; titulo: string; intro: string; lista: VideoExtra[] };
  objecoes?: { eyebrow: string; titulo: string; lista: { q: string; a: string }[] };
  faq?: { eyebrow: string; titulo: string; intro: string; lista: { q: string; a: string }[] };

  fechamento: { titulo: string; destaque: string; sub: string; cta: string; rodape: string };
  /** Aviso honesto no rodapé. Sempre presente. */
  legal: string;

  /** Ordem das seções nesta página. */
  ordem: BlocoPremium[];
  ancoras: { label: string; href: string }[];
}

/* ══════════════════════════════════════════════════════════════
   Utilidades de leitura do catálogo real
   ══════════════════════════════════════════════════════════════ */

function catalogo(slug: string) {
  const p = conexaoProducts.find((x) => x.slug === slug);
  if (!p) throw new Error(`Produto ausente no catálogo: ${slug}`);
  return p;
}

/** Vídeo do hero declarado no catálogo. */
export function heroVideoIdDe(slug: string): string {
  return catalogo(slug).heroVideoId;
}

/** Imagens de uma galeria do catálogo, com o caminho já resolvido. */
function imagensDoCatalogo(slug: string, indiceDaGaleria = 0): string[] {
  const galerias = catalogo(slug).sections.filter((s) => s.type === "gallery");
  const imgs = galerias[indiceDaGaleria]?.images ?? [];
  return imgs.map((img) => (img.startsWith("/") ? img : `/conexao/${slug}/${img}`));
}

/** FAQ real do catálogo (só telecom tem). */
function faqDoCatalogo(slug: string): { q: string; a: string }[] {
  const secao = catalogo(slug).sections.find((s) => s.type === "faq");
  return (secao?.faq ?? []).map((f) => ({ q: f.question, a: f.answer }));
}

/* ══════════════════════════════════════════════════════════════
   Vídeos institucionais reaproveitados (ids reais do catálogo)
   ══════════════════════════════════════════════════════════════ */

const VIDEO_CLUB = "5a250f12-19a2-4d1c-a1ab-f35f563963dd";
const VIDEO_CLUB_COMO = "9696eaf6-bdea-473f-9e9d-2d868b16b042";

/** Aviso padrão sobre valores máximos. Reaproveitado com ajuste por produto. */
const LEGAL_BASE =
  "Os percentuais e valores citados são os divulgados pela iGreen e podem variar conforme análise, disponibilidade e condições de cada caso. O consultor confirma tudo antes de qualquer contratação.";

/* ══════════════════════════════════════════════════════════════
   1. CONEXÃO TELECOM
   ══════════════════════════════════════════════════════════════ */

const TELECOM: ProdutoPremium = {
  slug: "conexao-telecom",
  nome: "Conexão Telecom",
  marca: "iGreen Telecom",
  publico: "Para quem usa o celular todo dia e paga caro por isso",

  eyebrow: "Conexão Telecom · iGreen Telecom",
  h1: { antes: "5G, ligações e WhatsApp ilimitados a partir de", destaque: "R$ 39,90" },
  sub: "Operadora 100% digital com cobertura nacional. Sem fidelidade, sem multa e com a internet que você não usou passando para o mês seguinte.",
  reducaoRisco: "Ativação pelo app em minutos. Se não gostar, cancela sem multa.",

  ctaPrincipal: "Ver planos disponíveis",
  waPrincipal:
    "Olá! Quero conhecer os planos da iGreen Telecom e saber qual cabe melhor no meu uso.",

  confianca: [
    { label: "Sem fidelidade", detalhe: "cancele sem multa" },
    { label: "Cobertura 5G", detalhe: "nacional" },
    { label: "100% digital", detalhe: "ativa pelo app" },
    { label: "Suporte 24h", detalhe: "pelo WhatsApp" },
  ],

  problema: {
    eyebrow: "O de sempre",
    titulo: "Você paga por internet que",
    destaque: "não usa — e ainda fica sem",
    intro:
      "A conta do celular é uma das poucas que quase ninguém revisa. E é justamente onde mais se perde dinheiro por hábito.",
    itens: [
      {
        t: "A franquia zera antes do fim do mês",
        b: "Você paga por um pacote que acaba no dia 20 e passa a última semana no Wi-Fi de terceiros ou comprando recarga extra.",
      },
      {
        t: "O que você não usou, você perde",
        b: "Na maioria das operadoras a franquia não usada simplesmente desaparece na virada. Você pagou por ela.",
      },
      {
        t: "Contrato que prende",
        b: "Fidelidade de 12 ou 24 meses transforma um plano ruim em um problema de dois anos.",
      },
      {
        t: "Suporte que consome sua tarde",
        b: "Menu de atendimento, protocolo, espera e transferência. Resolver qualquer coisa custa tempo.",
      },
    ],
  },

  solucao: {
    eyebrow: "Como resolvemos",
    titulo: "Uma operadora que não trabalha contra você",
    intro:
      "A iGreen Telecom é 100% digital: sem loja física, sem contrato longo e sem letra miúda no que importa.",
    pontos: [
      {
        t: "Internet acumulada",
        b: "O que você não usar no mês vai para o próximo. A franquia que você comprou continua sendo sua.",
      },
      {
        t: "Ligações e WhatsApp ilimitados",
        b: "Em todos os planos, para qualquer operadora. Você para de calcular minutos.",
      },
      {
        t: "Liberdade contratual",
        b: "Sem fidelidade e sem multa. A operadora precisa merecer você todo mês, não te prender.",
      },
      {
        t: "Portabilidade do seu número",
        b: "Você migra mantendo o número atual. Ninguém precisa saber que você trocou de operadora.",
      },
    ],
  },

  passos: {
    eyebrow: "Como ativar",
    titulo: "Da conversa ao chip ativo",
    intro: "Todo o processo acontece pelo celular, sem ir a loja nenhuma.",
    lista: [
      {
        n: "01",
        t: "Diga como você usa o celular",
        b: "Quanto de internet consome, se quer manter o número e se é para pessoa física ou empresa.",
        meta: "Conversa rápida no WhatsApp",
      },
      {
        n: "02",
        t: "Escolha o plano e ative",
        b: "A ativação é digital. Você recebe o chip (físico ou eSIM) e faz a portabilidade se quiser manter o número.",
        meta: "Sem loja, sem fila",
      },
      {
        n: "03",
        t: "Gerencie tudo no app",
        b: "Consumo, segunda via, pagamento automático no cartão e cancelamento — tudo pelo app iGreen Telecom.",
        meta: "Na sua mão",
      },
    ],
  },

  destaques: {
    eyebrow: "O que está incluído",
    titulo: "O que muda no seu dia",
    intro: "Cada item aqui é um recurso real do plano — e o que ele resolve na prática.",
    lista: [
      {
        icone: "zap",
        t: "5G de cobertura nacional",
        b: "Velocidade para trabalhar, navegar e enviar arquivos grandes sem depender de Wi-Fi.",
      },
      {
        icone: "repeat",
        t: "Franquia que acumula",
        b: "Mês tranquilo? A sobra vai para o próximo. Você deixa de jogar dinheiro fora na virada.",
      },
      {
        icone: "phone",
        t: "Ligações ilimitadas",
        b: "Para qualquer operadora do país. Sem se preocupar com quem tem qual número.",
      },
      {
        icone: "message",
        t: "WhatsApp ilimitado",
        b: "O aplicativo que você mais usa não consome a sua franquia.",
      },
      {
        icone: "unlock",
        t: "Sem fidelidade",
        b: "Nenhuma multa para sair. Experimentar custa praticamente nada.",
      },
      {
        icone: "smartphone",
        t: "Tudo no app",
        b: "Consumo, faturas, pagamento automático. Sem ligar para central de atendimento.",
      },
      {
        icone: "store",
        t: "iGreen Club incluído",
        b: "Descontos em mais de 30 mil lojas parceiras, sem pagar nada a mais pelo acesso.",
      },
      {
        icone: "message",
        t: "Suporte por WhatsApp 24h",
        b: "Você fala por mensagem, na hora que der, sem menu de opções.",
      },
      {
        icone: "leaf",
        t: "Cashback sustentável",
        b: "Parte do valor do plano é destinada a projetos de energia limpa e compensação de carbono.",
      },
    ],
  },

  galeria: {
    titulo: "Os planos, em detalhe",
    intro:
      "Franquia, valor e benefícios de cada plano. Se preferir, o consultor explica qual encaixa no seu uso.",
    imagens: imagensDoCatalogo("conexao-telecom"),
    formato: "planos",
    altBase: "Tabela de plano da iGreen Telecom",
  },

  comparacao: {
    eyebrow: "Lado a lado",
    titulo: "Operadora tradicional × iGreen Telecom",
    antes: {
      titulo: "Na operadora tradicional",
      itens: [
        "Franquia não usada some na virada do mês",
        "Fidelidade de 12 ou 24 meses com multa",
        "Atendimento por central telefônica",
        "Sem clube de descontos incluído",
        "Ativação em loja física",
      ],
    },
    depois: {
      titulo: "Na iGreen Telecom",
      itens: [
        "Internet acumulada para o mês seguinte",
        "Sem fidelidade e sem multa de saída",
        "Suporte por WhatsApp, 24 horas",
        "iGreen Club liberado, sem custo",
        "Ativação 100% digital pelo app",
      ],
    },
  },

  videos: {
    eyebrow: "Veja funcionando",
    titulo: "Conheça a operadora e o clube",
    intro: "Dois vídeos curtos: como funciona o plano e como usar o iGreen Club no dia a dia.",
    lista: [
      { id: "b65f52d4-e4f7-48c3-9c53-bdcb3b5c291a", titulo: "Benefícios da iGreen Telecom" },
      { id: VIDEO_CLUB, titulo: "iGreen Club: seu clube de descontos" },
      { id: VIDEO_CLUB_COMO, titulo: "Como usar o iGreen Club" },
    ],
  },

  faq: {
    eyebrow: "Perguntas frequentes",
    titulo: "Dúvidas sobre o plano",
    intro: "Respostas diretas às perguntas que mais aparecem antes de ativar.",
    // FAQ real do catálogo — nenhuma pergunta inventada.
    lista: faqDoCatalogo("conexao-telecom"),
  },

  fechamento: {
    titulo: "Diga só quanto de internet você usa.",
    destaque: "O resto a gente resolve.",
    sub: "O consultor indica o plano que encaixa no seu consumo, explica a portabilidade e ativa tudo pelo celular. Sem fidelidade, então o risco de testar é seu menor problema.",
    cta: "Quero ver meu plano",
    rodape: "Planos a partir de R$ 39,90 · Sem fidelidade · Ativação digital · iGreen Club incluído",
  },
  legal:
    "Valores e franquias conforme os planos vigentes da iGreen Telecom, sujeitos a alteração e à disponibilidade de cobertura no seu endereço. A portabilidade depende das regras da operadora de origem. " +
    LEGAL_BASE,

  ordem: ["problema", "solucao", "planos", "galeria", "passos", "destaques", "comparacao", "videos", "faq"],
  ancoras: [
    { label: "Planos", href: "#planos" },
    { label: "Como ativar", href: "#passos" },
    { label: "Benefícios", href: "#destaques" },
    { label: "Dúvidas", href: "#faq" },
  ],
  planos: {
    eyebrow: "Planos",
    titulo: "Escolha pelo seu uso, não pelo maior número",
    intro:
      "Todos os planos incluem ligações e WhatsApp ilimitados, internet acumulada, iGreen Club e nenhuma fidelidade. A diferença entre eles é a franquia de dados.",
    lista: [
      {
        nome: "Entrada",
        resumo: "A partir de R$ 39,90",
        itens: [
          "Ligações ilimitadas para qualquer operadora",
          "WhatsApp ilimitado",
          "Internet acumulada para o mês seguinte",
          "iGreen Club incluído",
        ],
      },
      {
        nome: "Uso intenso",
        resumo: "Mais franquia de dados",
        itens: [
          "Tudo do plano de entrada",
          "Franquia maior para quem trabalha no celular",
          "5G de cobertura nacional",
          "Sem fidelidade",
        ],
        destaque: true,
      },
      {
        nome: "Pessoa jurídica",
        resumo: "Mesmos planos, faturamento PJ",
        itens: [
          "Os mesmos benefícios da pessoa física",
          "Nota fiscal e faturamento para empresa",
          "Vários chips na mesma conta",
          "Suporte dedicado por WhatsApp",
        ],
      },
    ],
    nota:
      "A tabela completa, com a franquia exata de cada plano e o valor vigente, está nas imagens abaixo e é confirmada pelo consultor.",
  },
};

/* ══════════════════════════════════════════════════════════════
   2. CONEXÃO SEGUROS
   ══════════════════════════════════════════════════════════════ */

const SEGUROS: ProdutoPremium = {
  slug: "conexao-seguros",
  nome: "Conexão Seguros",
  marca: "iGreen Seguros",
  publico: "Para quem tem carro e foi recusado ou achou caro demais",

  eyebrow: "Conexão Seguros · iGreen Seguros",
  h1: { antes: "Proteja seu carro a partir de", destaque: "R$ 99 por mês" },
  sub: "Proteção veicular com assistência 24h em todo o Brasil, rede de mais de 5.000 oficinas e contratação sem análise de perfil.",
  reducaoRisco: "Cotação sem compromisso. O consultor mostra a cobertura antes de qualquer decisão.",

  ctaPrincipal: "Quero uma cotação",
  waPrincipal:
    "Olá! Quero uma cotação de proteção veicular na iGreen Seguros. Posso passar os dados do meu carro?",

  confianca: [
    { label: "Assistência 24h", detalhe: "em todo o Brasil" },
    { label: "5.000+ oficinas", detalhe: "rede credenciada" },
    { label: "Sem análise de perfil", detalhe: "para contratar" },
    { label: "100% digital", detalhe: "sem papelada" },
  ],

  problema: {
    eyebrow: "A situação",
    titulo: "Seguro tradicional recusa,",
    destaque: "encarece ou complica",
    intro:
      "Muita gente não deixa o carro sem proteção por escolha. Deixa porque a seguradora disse não, ou cobrou um valor que não fecha.",
    itens: [
      {
        t: "Perfil recusado",
        b: "Idade, tempo de habilitação, região, uso do veículo. Basta um item fora da caixa para a proposta não sair.",
      },
      {
        t: "Preço que não cabe",
        b: "A parcela do seguro chega a competir com a do próprio carro. Muita gente desiste no orçamento.",
      },
      {
        t: "Burocracia antes de qualquer coisa",
        b: "Vistoria, documentação, questionário longo. Semanas para saber se você está coberto.",
      },
      {
        t: "O risco real continua lá",
        b: "Sem proteção, um roubo ou uma colisão vira dívida à vista. É o patrimônio inteiro num evento só.",
      },
    ],
  },

  solucao: {
    eyebrow: "A alternativa",
    titulo: "Proteção veicular com preço e regras que fecham",
    intro:
      "A iGreen Seguros trabalha com proteção veicular: cobertura clara, rede própria de oficinas e contratação sem análise de perfil.",
    pontos: [
      {
        t: "Contratação sem análise de perfil",
        b: "Você não é recusado por idade, tempo de carteira ou região. A adesão é simples e rápida.",
      },
      {
        t: "Preço acessível",
        b: "Planos até 60% mais acessíveis que os de seguradoras tradicionais, segundo a comparação da própria iGreen.",
      },
      {
        t: "Assistência que atende de verdade",
        b: "Guincho, socorro e apoio 24 horas por dia, em todo o território nacional.",
      },
      {
        t: "Apólice na palma da mão",
        b: "Gestão 100% digital pelo aplicativo: documentos, acionamento e acompanhamento.",
      },
    ],
  },

  planos: {
    eyebrow: "Planos",
    titulo: "Três níveis de proteção",
    intro:
      "Do essencial contra roubo até cobertura para terceiros. Escolha o quanto de risco você quer transferir.",
    lista: [
      {
        nome: "Basic",
        resumo: "O essencial contra perda total",
        itens: [
          "Cobertura contra roubo e furto",
          "Assistência 24 horas",
          "Guincho até 200 km",
          "Carro reserva por 7 dias",
        ],
      },
      {
        nome: "Premium",
        resumo: "Cobre também o dia a dia",
        itens: [
          "Tudo do Basic",
          "Cobertura contra colisão e incêndio",
          "Vidros e retrovisores",
          "Guincho ilimitado",
        ],
        destaque: true,
      },
      {
        nome: "Infinite",
        resumo: "Proteção completa, inclusive terceiros",
        itens: [
          "Tudo do Premium",
          "Cobertura para terceiros",
          "Proteção de acessórios",
          "Carro reserva por 30 dias e desconto em estacionamentos",
        ],
      },
    ],
    nota:
      "As coberturas e limites exatos constam nas condições do plano contratado. O consultor envia o detalhamento antes da adesão.",
  },

  passos: {
    eyebrow: "Como contratar",
    titulo: "Três passos, nenhum deles presencial",
    intro: "Você conversa, escolhe o plano e recebe a proteção ativa.",
    lista: [
      {
        n: "01",
        t: "Envie os dados do veículo",
        b: "Modelo, ano e cidade de uso. Com isso o consultor calcula o valor e indica o plano adequado.",
        meta: "Cotação sem compromisso",
      },
      {
        n: "02",
        t: "Escolha o nível de cobertura",
        b: "Basic, Premium ou Infinite. O consultor explica exatamente o que cada um cobre — e o que não cobre.",
        meta: "Sem letra miúda",
      },
      {
        n: "03",
        t: "Ative e gerencie pelo app",
        b: "Adesão digital, sem análise de perfil. A apólice, o acionamento e a assistência ficam no aplicativo.",
        meta: "Ativação rápida",
      },
    ],
  },

  destaques: {
    eyebrow: "O que você leva",
    titulo: "Proteção que resolve, não só que existe",
    intro: "Cada recurso do plano e a diferença que ele faz na hora do problema.",
    lista: [
      {
        icone: "shield-check",
        t: "Roubo, furto e colisão",
        b: "Os três eventos que viram prejuízo grande deixam de ser um problema só seu.",
      },
      {
        icone: "clock",
        t: "Assistência 24 horas",
        b: "Pane, guincho ou socorro a qualquer hora, em qualquer estado do país.",
      },
      {
        icone: "wrench",
        t: "Mais de 5.000 oficinas",
        b: "Rede credenciada ampla: mais chance de ter uma oficina parceira perto de você.",
      },
      {
        icone: "car",
        t: "Carro reserva",
        b: "Você não fica sem se locomover enquanto o seu veículo está em reparo.",
      },
      {
        icone: "percent",
        t: "Até 60% mais acessível",
        b: "A proteção passa a caber no orçamento, em vez de ficar para o ano que vem.",
      },
      {
        icone: "unlock",
        t: "Sem análise de perfil",
        b: "Quem foi recusado no seguro tradicional tem caminho aqui.",
      },
      {
        icone: "smartphone",
        t: "Tudo digital",
        b: "Apólice, acionamento e documentos no app. Sem correr atrás de papel.",
      },
      {
        icone: "store",
        t: "iGreen Club incluído",
        b: "Descontos em mais de 30 mil lojas parceiras, sem custo adicional.",
      },
      {
        icone: "leaf",
        t: "Parte vai para sustentabilidade",
        b: "Uma fração do valor é destinada a projetos ambientais da iGreen.",
      },
    ],
  },

  galeria: {
    titulo: "Coberturas de cada plano",
    intro: "O detalhamento das coberturas, direto do material da iGreen Seguros.",
    imagens: imagensDoCatalogo("conexao-seguros"),
    formato: "documento",
    altBase: "Detalhamento de cobertura do plano iGreen Seguros",
  },

  objecoes: {
    eyebrow: "Direto ao ponto",
    titulo: "As dúvidas que travam a decisão",
    lista: [
      {
        q: "Meu perfil vai ser recusado?",
        a: "A contratação é feita sem análise de perfil. Idade, tempo de habilitação e região não são motivo de recusa.",
      },
      {
        q: "Preciso fazer vistoria presencial?",
        a: "A gestão é 100% digital e a adesão é descrita como rápida e sem burocracia. O consultor informa o que é exigido no seu caso.",
      },
      {
        q: "A assistência atende fora da minha cidade?",
        a: "Sim. A assistência 24h cobre todo o território nacional.",
      },
      {
        q: "E se o carro precisar de oficina?",
        a: "A rede credenciada tem mais de 5.000 oficinas parceiras. O acionamento é feito pelo app ou pelo suporte.",
      },
      {
        q: "Fico sem carro durante o reparo?",
        a: "Não. Todos os planos incluem carro reserva — 7 dias no Basic e até 30 dias no Infinite.",
      },
      {
        q: "Quanto vou pagar de verdade?",
        a: "Os planos partem de R$ 99 por mês, e o valor final depende do veículo e da cobertura escolhida. A cotação é gratuita e sem compromisso.",
      },
    ],
  },

  videos: {
    eyebrow: "Benefício extra",
    titulo: "iGreen Club, incluído no seu plano",
    intro: "Além da proteção do carro, descontos em mais de 30 mil lojas parceiras.",
    lista: [
      { id: VIDEO_CLUB, titulo: "iGreen Club: seu clube de descontos" },
      { id: VIDEO_CLUB_COMO, titulo: "Como usar o iGreen Club" },
    ],
  },

  fechamento: {
    titulo: "Uma cotação não custa nada.",
    destaque: "Ficar sem proteção, sim.",
    sub: "Mande o modelo e o ano do seu carro. O consultor volta com o valor e com a cobertura exata de cada plano, para você decidir com o número na mão.",
    cta: "Quero minha cotação",
    rodape: "A partir de R$ 99/mês · Assistência 24h · 5.000+ oficinas · Sem análise de perfil",
  },
  legal:
    "Conexão Seguros oferece proteção veicular. Coberturas, carências, limites e exclusões seguem as condições do plano contratado, entregues antes da adesão. Valores a partir de R$ 99/mês variam conforme veículo e cobertura. " +
    LEGAL_BASE,

  ordem: ["problema", "solucao", "planos", "galeria", "passos", "destaques", "objecoes", "videos"],
  ancoras: [
    { label: "Planos", href: "#planos" },
    { label: "Coberturas", href: "#galeria" },
    { label: "Como contratar", href: "#passos" },
    { label: "Dúvidas", href: "#objecoes" },
  ],
};

export const PRODUTOS_PREMIUM_PARTE_1 = { TELECOM, SEGUROS };

/* ══════════════════════════════════════════════════════════════
   3. CONEXÃO SOLAR
   ══════════════════════════════════════════════════════════════ */

const SOLAR: ProdutoPremium = {
  slug: "conexao-solar",
  nome: "Conexão Solar",
  marca: "iGreen Energy",
  publico: "Para casas e empresas que querem economizar sem investir",

  eyebrow: "Conexão Solar · iGreen Energy",
  h1: { antes: "Energia solar na sua conta de luz,", destaque: "sem sol no seu telhado" },
  sub: "A geração acontece nas nossas fazendas solares compartilhadas. Você recebe até 20% de desconto na conta, sem comprar equipamento e sem obra nenhuma.",
  reducaoRisco: "Análise gratuita a partir da sua conta de luz. Sem fidelidade.",

  ctaPrincipal: "Quero economizar na conta",
  waPrincipal:
    "Olá! Quero saber quanto consigo economizar com a Conexão Solar da iGreen Energy.",

  confianca: [
    { label: "Sem investimento", detalhe: "zero equipamento" },
    { label: "Sem obra", detalhe: "nada é instalado" },
    { label: "Sem fidelidade", detalhe: "cancele quando quiser" },
    { label: "27 estados", detalhe: "cobertura nacional" },
  ],
  numeros: [
    { valor: "até 20%", rotulo: "de desconto na conta" },
    { valor: "500+", rotulo: "fazendas solares" },
    { valor: "R$ 0", rotulo: "de investimento" },
  ],

  problema: {
    eyebrow: "O impasse",
    titulo: "Todo mundo quer energia solar.",
    destaque: "Quase ninguém tem telhado e caixa.",
    intro:
      "A economia da energia solar é real. O que trava não é a vontade — é o que ela costuma exigir antes de começar.",
    itens: [
      {
        t: "Sistema próprio exige dinheiro na frente",
        b: "Comprar placas significa investimento alto, financiamento ou anos de retorno antes do primeiro real economizado.",
      },
      {
        t: "Nem todo imóvel serve",
        b: "Apartamento, imóvel alugado, telhado sombreado ou pequeno: em muitos casos instalar não é uma opção.",
      },
      {
        t: "Obra é transtorno",
        b: "Projeto, homologação, equipe no telhado. Semanas de incômodo antes de qualquer benefício.",
      },
      {
        t: "Enquanto isso, a conta chega igual",
        b: "Cada mês de indecisão é um mês pagando a tarifa cheia por energia mais cara.",
      },
    ],
  },

  solucao: {
    eyebrow: "A saída",
    titulo: "A fazenda solar é nossa. A economia é sua.",
    intro:
      "A Conexão Solar é energia solar por assinatura: nossas fazendas geram, a distribuidora entrega e o desconto aparece na sua conta.",
    pontos: [
      {
        t: "Geração compartilhada",
        b: "A energia limpa vem de fazendas solares da iGreen, não do seu telhado. Você usa o resultado sem ser dono do equipamento.",
      },
      {
        t: "Economia desde o primeiro mês",
        b: "Não há período de retorno de investimento: como você não investe nada, a economia começa junto com a migração.",
      },
      {
        t: "Serve para quem mora de aluguel",
        b: "Como nada é instalado no imóvel, casa, apartamento ou ponto comercial alugado também entram.",
      },
      {
        t: "Acompanhamento digital",
        b: "Você vê a economia pelo aplicativo, sem precisar conferir cálculo em papel.",
      },
    ],
  },

  passos: {
    eyebrow: "Como começar",
    titulo: "Três passos e nenhum operário",
    intro: "Do primeiro contato ao desconto no boleto, tudo pelo celular.",
    lista: [
      {
        n: "01",
        t: "Envie sua conta de luz",
        b: "Uma foto da fatura basta para verificar a cobertura no seu endereço e calcular o desconto.",
        meta: "Análise gratuita",
      },
      {
        n: "02",
        t: "Adesão digital",
        b: "Sem investimento, sem taxa de adesão e sem visita técnica. Você assina online.",
        meta: "Tudo pelo celular",
      },
      {
        n: "03",
        t: "Economize todo mês",
        b: "A partir da ativação, o desconto de até 20% passa a valer. Sem fidelidade: se quiser sair, sai.",
        meta: "Ativação em poucos dias",
      },
    ],
  },

  destaques: {
    eyebrow: "Vantagens",
    titulo: "O que a Conexão Solar entrega",
    intro: "Recursos reais do produto e o que cada um significa para você.",
    lista: [
      {
        icone: "percent",
        t: "Até 20% de desconto",
        b: "Recorrente, todo mês, sobre a energia que você já consome.",
      },
      {
        icone: "zap-off",
        t: "Zero investimento",
        b: "Nenhum equipamento comprado, nenhum financiamento assumido.",
      },
      {
        icone: "home",
        t: "Sem obra no imóvel",
        b: "Nada é instalado. Serve para imóvel próprio e alugado.",
      },
      {
        icone: "leaf",
        t: "Energia 100% renovável",
        b: "Seu consumo passa a ser abastecido por geração solar.",
      },
      {
        icone: "unlock",
        t: "Sem fidelidade",
        b: "Contrato sem prisão. Testar praticamente não tem risco.",
      },
      {
        icone: "smartphone",
        t: "Economia no app",
        b: "Acompanhamento digital do quanto você deixou de pagar.",
      },
      {
        icone: "store",
        t: "iGreen Club incluído",
        b: "Descontos em mais de 30 mil lojas parceiras, sem custo.",
      },
      {
        icone: "clock",
        t: "Ativação rápida",
        b: "Poucos dias entre a assinatura e o início do desconto.",
      },
      {
        icone: "building",
        t: "Casas e empresas",
        b: "Residências e pontos comerciais podem aderir.",
      },
    ],
  },

  galeria: {
    titulo: "A Conexão Solar na prática",
    intro: "Imagens do funcionamento da energia solar por assinatura.",
    imagens: imagensDoCatalogo("conexao-solar"),
    formato: "clientes",
    altBase: "Energia solar por assinatura da iGreen Energy",
  },

  comparacao: {
    eyebrow: "Lado a lado",
    titulo: "Comprar placas × assinar energia solar",
    antes: {
      titulo: "Comprando um sistema próprio",
      itens: [
        "Investimento alto antes de qualquer economia",
        "Precisa de telhado adequado e imóvel próprio",
        "Obra, projeto e homologação",
        "Manutenção por conta do dono",
        "Anos até o retorno do investimento",
      ],
    },
    depois: {
      titulo: "Com a Conexão Solar",
      itens: [
        "R$ 0 de investimento inicial",
        "Funciona também em imóvel alugado",
        "Nenhuma obra: nada é instalado",
        "Equipamento e manutenção são da iGreen",
        "Economia já a partir da migração",
      ],
    },
  },

  videos: {
    eyebrow: "Entenda melhor",
    titulo: "Como a energia chega até você",
    intro: "O caminho da fazenda solar até a sua tomada, em vídeo.",
    lista: [
      { id: "91f62204-aec7-4247-a46a-f1935580f477", titulo: "Como funciona a Conexão Solar" },
      { id: VIDEO_CLUB, titulo: "iGreen Club: seu clube de descontos" },
    ],
  },

  objecoes: {
    eyebrow: "Direto ao ponto",
    titulo: "As perguntas que sempre aparecem",
    lista: [
      {
        q: "Preciso instalar placas em casa?",
        a: "Não. A geração acontece nas fazendas solares compartilhadas da iGreen. Seu telhado não é tocado.",
      },
      {
        q: "Funciona em apartamento ou imóvel alugado?",
        a: "Sim. Como nada é instalado no imóvel, não depende de telhado nem de autorização de obra.",
      },
      {
        q: "Preciso investir algum valor?",
        a: "Não. O produto é descrito como sem investimento inicial e sem taxa de adesão.",
      },
      {
        q: "A luz pode faltar mais depois de migrar?",
        a: "A entrega física continua sendo da mesma distribuidora, pela mesma rede. O que muda é a origem da energia e o valor.",
      },
      {
        q: "Fico preso em contrato?",
        a: "Não. A Conexão Solar não tem fidelidade — o cancelamento é possível a qualquer momento.",
      },
      {
        q: "Serve para minha empresa?",
        a: "Sim. O produto está disponível para residências e empresas.",
      },
    ],
  },

  fechamento: {
    titulo: "Uma foto da sua conta.",
    destaque: "É por onde tudo começa.",
    sub: "O consultor confere a cobertura no seu endereço, calcula o desconto real e explica o processo. Sem custo para analisar e sem fidelidade se você seguir.",
    cta: "Enviar minha conta de luz",
    rodape: "Até 20% de desconto · Sem investimento · Sem obra · Sem fidelidade",
  },
  legal:
    "O desconto de até 20% incide sobre a parte de energia da fatura e depende da análise da conta, da distribuidora e da disponibilidade no endereço de consumo. " +
    LEGAL_BASE,

  ordem: ["problema", "solucao", "passos", "destaques", "comparacao", "galeria", "videos", "objecoes"],
  ancoras: [
    { label: "Como funciona", href: "#passos" },
    { label: "Vantagens", href: "#destaques" },
    { label: "Comparação", href: "#comparacao" },
    { label: "Dúvidas", href: "#objecoes" },
  ],
};

/* ══════════════════════════════════════════════════════════════
   4. CONEXÃO PLACAS
   ══════════════════════════════════════════════════════════════ */

const PLACAS: ProdutoPremium = {
  slug: "conexao-placas",
  nome: "Conexão Placas",
  marca: "iGreen Energy",
  publico: "Para quem tem telhado próprio e quer o sistema no nome",

  eyebrow: "Conexão Placas · iGreen Energy",
  h1: { antes: "Sistema solar no seu telhado com até", destaque: "95% de economia" },
  sub: "Projeto sob medida para o seu consumo, instalação profissional com garantia de 25 anos e financiamento em até 120 vezes.",
  reducaoRisco: "Projeto e orçamento sem compromisso, calculados sobre o seu consumo real.",

  ctaPrincipal: "Quero meu projeto",
  waPrincipal:
    "Olá! Quero um projeto de energia solar com placas da iGreen Energy para o meu imóvel.",

  confianca: [
    { label: "Garantia 25 anos", detalhe: "nos equipamentos" },
    { label: "Até 120x", detalhe: "financiamento" },
    { label: "Retorno até 4 anos", detalhe: "do investimento" },
    { label: "Projeto sob medida", detalhe: "para seu consumo" },
  ],
  numeros: [
    { valor: "até 95%", rotulo: "de economia na conta" },
    { valor: "25 anos", rotulo: "de garantia" },
    { valor: "até 8%", rotulo: "de valorização do imóvel" },
  ],

  problema: {
    eyebrow: "A conta que não para de subir",
    titulo: "Você já pagou um sistema solar.",
    destaque: "Só que para a distribuidora.",
    intro:
      "Somando as faturas dos próximos anos, o valor costuma passar do custo de um sistema próprio. A diferença é que, no fim, você não fica com nada.",
    itens: [
      {
        t: "Dinheiro que sai e não volta",
        b: "Cada fatura paga é despesa encerrada. O mesmo valor aplicado em geração própria vira patrimônio.",
      },
      {
        t: "Consumo alto castiga mais",
        b: "Quem tem comércio, indústria, chácara ou casa grande sente cada reajuste em cheio.",
      },
      {
        t: "Reajuste você não controla",
        b: "A tarifa é decidida fora da sua casa. Com geração própria, a maior parte do custo passa a ser previsível.",
      },
      {
        t: "Telhado parado é ativo desperdiçado",
        b: "Se você já tem a área e ela recebe sol, ela pode estar produzindo em vez de só existir.",
      },
    ],
  },

  solucao: {
    eyebrow: "A solução",
    titulo: "Geração própria, dimensionada para o seu consumo",
    intro:
      "A Conexão Placas é o sistema fotovoltaico instalado no seu imóvel: projeto, equipamento, instalação e monitoramento.",
    pontos: [
      {
        t: "Projeto personalizado",
        b: "O sistema é dimensionado pelo seu consumo real, não por um pacote padrão. Nem sobra investimento, nem falta geração.",
      },
      {
        t: "Instalação com garantia de 25 anos",
        b: "Equipe profissional e garantia longa nos equipamentos — o horizonte do sistema é de décadas.",
      },
      {
        t: "Financiamento em até 120 meses",
        b: "A parcela pode ser planejada olhando o valor que você já paga de energia hoje.",
      },
      {
        t: "Monitoramento em tempo real",
        b: "Você acompanha a geração pelo aplicativo e vê o sistema trabalhando.",
      },
    ],
  },

  passos: {
    eyebrow: "Como funciona",
    titulo: "Do orçamento ao sistema gerando",
    intro: "Um processo técnico conduzido por quem já instalou para os clientes das fotos abaixo.",
    lista: [
      {
        n: "01",
        t: "Análise do seu consumo",
        b: "Você envia a conta de luz. Com o histórico de consumo, calculamos o tamanho ideal do sistema.",
        meta: "Orçamento sem compromisso",
      },
      {
        n: "02",
        t: "Projeto e financiamento",
        b: "Você recebe o projeto dimensionado e as opções de pagamento, incluindo financiamento em até 120x.",
        meta: "Projeto sob medida",
      },
      {
        n: "03",
        t: "Instalação e monitoramento",
        b: "Equipe profissional instala e o sistema entra em operação. Você acompanha a geração pelo app.",
        meta: "Garantia de 25 anos",
      },
    ],
  },

  destaques: {
    eyebrow: "O que você recebe",
    titulo: "Por que instalar com a iGreen",
    intro: "Cada item é um compromisso do produto — e o que ele significa no longo prazo.",
    lista: [
      {
        icone: "percent",
        t: "Até 95% de economia",
        b: "A maior parte da fatura sai do seu orçamento mensal.",
      },
      {
        icone: "shield-check",
        t: "Garantia de 25 anos",
        b: "O sistema é feito para durar décadas, com cobertura de longo prazo nos equipamentos.",
      },
      {
        icone: "wallet",
        t: "Financiamento em até 120x",
        b: "Você não precisa do valor inteiro à vista para começar.",
      },
      {
        icone: "trending-up",
        t: "Retorno em até 4 anos",
        b: "Depois disso, a economia continua e o ativo é seu.",
      },
      {
        icone: "home",
        t: "Valorização de até 8%",
        b: "O imóvel com geração própria vale mais na hora de vender ou alugar.",
      },
      {
        icone: "wrench",
        t: "Instalação profissional",
        b: "Projeto e execução por equipe técnica, não por serviço avulso.",
      },
      {
        icone: "smartphone",
        t: "Monitoramento em tempo real",
        b: "Você vê quanto o sistema gerou hoje, direto no aplicativo.",
      },
      {
        icone: "building",
        t: "Residências, comércios e indústrias",
        b: "O dimensionamento atende do consumo doméstico ao industrial.",
      },
      {
        icone: "leaf",
        t: "Energia limpa e própria",
        b: "Geração renovável no seu nome, com impacto ambiental positivo.",
      },
    ],
  },

  galeria: {
    titulo: "Sistemas já instalados",
    intro:
      "Projetos entregues pela iGreen Energy. Cada foto é uma instalação real de cliente.",
    imagens: imagensDoCatalogo("conexao-placas", 0),
    formato: "clientes",
    altBase: "Sistema de energia solar instalado pela iGreen Energy em cliente",
  },

  comparacao: {
    eyebrow: "Lado a lado",
    titulo: "Continuar pagando × gerar sua energia",
    antes: {
      titulo: "Pagando a distribuidora",
      itens: [
        "Despesa mensal para sempre, sem fim previsto",
        "Reajuste de tarifa fora do seu controle",
        "Nenhum patrimônio no final",
        "Telhado sem uso produtivo",
        "Nenhuma valorização do imóvel",
      ],
    },
    depois: {
      titulo: "Com sistema próprio",
      itens: [
        "Até 95% de economia na fatura",
        "Custo previsível por 25 anos de garantia",
        "O sistema é um ativo seu",
        "Telhado gerando energia todos os dias",
        "Valorização do imóvel em até 8%",
      ],
    },
  },

  videos: {
    eyebrow: "Motivos",
    titulo: "Por que instalar energia solar",
    intro: "O raciocínio por trás da decisão, em vídeo.",
    lista: [
      { id: "30706e15-262f-451c-8350-4b3103f45197", titulo: "Motivos para instalar energia solar" },
      { id: VIDEO_CLUB, titulo: "iGreen Club: seu clube de descontos" },
    ],
  },

  objecoes: {
    eyebrow: "Direto ao ponto",
    titulo: "O que costuma travar a decisão",
    lista: [
      {
        q: "Preciso ter o valor todo à vista?",
        a: "Não. Há financiamento facilitado em até 120 vezes.",
      },
      {
        q: "Em quanto tempo o investimento volta?",
        a: "O retorno informado é de até 4 anos, dependendo do consumo e do sistema dimensionado.",
      },
      {
        q: "E se o equipamento der problema?",
        a: "A garantia dos equipamentos é de 25 anos, e a instalação é feita por equipe profissional com suporte técnico especializado.",
      },
      {
        q: "Serve para empresa?",
        a: "Sim. O produto atende residências, comércios e indústrias, com projeto dimensionado para cada consumo.",
      },
      {
        q: "Como sei que o sistema está funcionando?",
        a: "O monitoramento é em tempo real pelo aplicativo: você acompanha a geração todos os dias.",
      },
      {
        q: "Instalar valoriza o imóvel?",
        a: "Sim. A valorização informada pela iGreen chega a 8%.",
      },
    ],
  },

  fechamento: {
    titulo: "O cálculo começa na sua conta de luz.",
    destaque: "O resto é projeto.",
    sub: "Envie sua fatura. O consultor dimensiona o sistema para o seu consumo, apresenta o investimento, as opções de financiamento e o retorno estimado.",
    cta: "Quero meu orçamento",
    rodape: "Até 95% de economia · Garantia de 25 anos · Financiamento em até 120x",
  },
  legal:
    "Economia de até 95%, retorno em até 4 anos e valorização de até 8% são estimativas que dependem do consumo, do dimensionamento do sistema, das condições do imóvel e da distribuidora local. Financiamento sujeito a aprovação de crédito. " +
    LEGAL_BASE,

  ordem: ["problema", "solucao", "passos", "destaques", "comparacao", "galeria", "videos", "objecoes"],
  ancoras: [
    { label: "Como funciona", href: "#passos" },
    { label: "Vantagens", href: "#destaques" },
    { label: "Instalações", href: "#galeria" },
    { label: "Dúvidas", href: "#objecoes" },
  ],
};

/* ══════════════════════════════════════════════════════════════
   5. CONEXÃO LIVRE
   ══════════════════════════════════════════════════════════════ */

const LIVRE: ProdutoPremium = {
  slug: "conexao-livre",
  nome: "Conexão Livre",
  marca: "iGreen Energy",
  publico: "Para empresas e grandes consumidores de energia",

  eyebrow: "Conexão Livre · Mercado Livre de Energia",
  h1: { antes: "Sua empresa pode escolher de quem compra energia e economizar até", destaque: "30%" },
  sub: "No Mercado Livre de Energia você deixa de ser cliente cativo da distribuidora. Migração gratuita, sem obra e sem fidelidade.",
  reducaoRisco: "Estudo de viabilidade gratuito a partir das faturas da sua empresa.",

  ctaPrincipal: "Quero avaliar minha migração",
  waPrincipal:
    "Olá! Quero avaliar a migração da minha empresa para o Mercado Livre de Energia com a iGreen.",

  confianca: [
    { label: "Até 30%", detalhe: "de desconto" },
    { label: "Migração gratuita", detalhe: "sem custo" },
    { label: "Sem obra", detalhe: "nada muda no local" },
    { label: "Sem fidelidade", detalhe: "flexibilidade total" },
  ],
  numeros: [
    { valor: "até 30%", rotulo: "de economia na energia" },
    { valor: "R$ 0", rotulo: "de custo de migração" },
    { valor: "100%", rotulo: "fontes renováveis certificadas" },
  ],

  problema: {
    eyebrow: "O mercado cativo",
    titulo: "Sua empresa paga o preço",
    destaque: "que alguém definiu por ela",
    intro:
      "No mercado cativo existe um fornecedor e uma tarifa. Não há negociação, não há escolha e não há previsibilidade.",
    itens: [
      {
        t: "Zero poder de negociação",
        b: "Você paga a tarifa regulada da distribuidora da sua região. Não há proposta concorrente para comparar.",
      },
      {
        t: "Custo imprevisível no orçamento",
        b: "Reajustes e bandeiras entram no meio do ano e desorganizam o planejamento financeiro.",
      },
      {
        t: "Energia é despesa de peso",
        b: "Em indústria, comércio e agronegócio, a energia costuma estar entre os maiores custos fixos.",
      },
      {
        t: "A economia existe e está parada na mesa",
        b: "Empresas com o mesmo perfil já migraram e pagam menos pela mesma energia.",
      },
    ],
  },

  solucao: {
    eyebrow: "A solução",
    titulo: "Liberdade para escolher o seu fornecedor",
    intro:
      "O Mercado Livre de Energia permite comprar energia de quem oferecer as melhores condições. A iGreen conduz a migração e a gestão, em aliança com a Comerc.",
    pontos: [
      {
        t: "Migração 100% gratuita",
        b: "A mudança não tem custo para a empresa. Você não paga para começar a economizar.",
      },
      {
        t: "Nada muda na sua operação",
        b: "Sem investimento e sem obra na propriedade. A rede e a entrega continuam iguais; muda o contrato de compra.",
      },
      {
        t: "Contratos transparentes",
        b: "Previsibilidade de custo com condições claras — dá para colocar a energia no orçamento anual.",
      },
      {
        t: "Consultoria em todo o processo",
        b: "Análise de viabilidade, migração e acompanhamento com consultoria especializada e gestão digital.",
      },
    ],
  },

  passos: {
    eyebrow: "Como migrar",
    titulo: "Da análise ao contrato",
    intro: "A viabilidade é verificada antes de qualquer compromisso.",
    lista: [
      {
        n: "01",
        t: "Envie as faturas da empresa",
        b: "Com o histórico de consumo e demanda, avaliamos se o seu perfil se qualifica e qual a economia possível.",
        meta: "Estudo gratuito",
      },
      {
        n: "02",
        t: "Receba a proposta comercial",
        b: "Você vê a economia projetada e as condições do contrato antes de decidir qualquer coisa.",
        meta: "Números na mesa",
      },
      {
        n: "03",
        t: "Migração conduzida",
        b: "A iGreen executa a migração sem custo e sem interrupção do fornecimento, com gestão digital depois.",
        meta: "Sem parar a operação",
      },
    ],
  },

  destaques: {
    eyebrow: "Vantagens",
    titulo: "O que a empresa ganha",
    intro: "Cada recurso do Mercado Livre e o efeito prático no negócio.",
    lista: [
      {
        icone: "percent",
        t: "Até 30% de desconto",
        b: "Redução direta em um dos maiores custos fixos da operação.",
      },
      {
        icone: "wallet",
        t: "Migração sem custo",
        b: "Você não investe para migrar: o retorno começa sem desembolso inicial.",
      },
      {
        icone: "home",
        t: "Sem obra na propriedade",
        b: "Nenhuma intervenção física. A operação não para um dia.",
      },
      {
        icone: "trending-up",
        t: "Previsibilidade de custo",
        b: "Contratos transparentes permitem planejar a energia no orçamento.",
      },
      {
        icone: "unlock",
        t: "Sem fidelidade",
        b: "Flexibilidade contratual em vez de amarra de longo prazo.",
      },
      {
        icone: "leaf",
        t: "Fontes renováveis certificadas",
        b: "Energia limpa com certificação — insumo para relatório ESG.",
      },
      {
        icone: "users",
        t: "Consultoria dedicada",
        b: "Especialista acompanhando análise, migração e operação.",
      },
      {
        icone: "smartphone",
        t: "Gestão digital",
        b: "Acompanhamento do consumo e dos contratos de forma simplificada.",
      },
      {
        icone: "building",
        t: "Feito para grandes consumidores",
        b: "Indústria, comércio e agronegócio com consumo relevante.",
      },
    ],
  },

  galeria: {
    titulo: "Aliança, missão e gestão",
    intro:
      "A parceria com a Comerc, a missão pela energia limpa e a gestão da energia na palma da mão.",
    imagens: imagensDoCatalogo("conexao-livre", 1),
    formato: "documento",
    altBase: "Material institucional da Conexão Livre iGreen",
  },

  comparacao: {
    eyebrow: "Lado a lado",
    titulo: "Mercado cativo × Mercado Livre",
    antes: {
      titulo: "Mercado cativo",
      itens: [
        "Um único fornecedor, sem alternativa",
        "Tarifa regulada, sem negociação",
        "Reajustes e bandeiras fora do seu controle",
        "Sem escolha da fonte de energia",
        "Custo difícil de projetar no orçamento",
      ],
    },
    depois: {
      titulo: "Mercado Livre com a iGreen",
      itens: [
        "Você escolhe de quem comprar",
        "Até 30% de desconto na energia",
        "Contratos transparentes e previsíveis",
        "Fontes renováveis certificadas",
        "Migração gratuita e sem obra",
      ],
    },
  },

  videos: {
    eyebrow: "Entenda",
    titulo: "Mercado Livre, aliança e geração",
    intro: "Três vídeos: como funciona, quem são os parceiros e a estrutura que gera a energia.",
    lista: [
      { id: "743b84c6-c1ca-440a-a605-20bae557e4ae", titulo: "Como funciona o Mercado Livre de Energia" },
      { id: "025e9bea-6d25-49ac-881c-718c4920e49d", titulo: "Aliança estratégica" },
      { id: "38a9c9b1-600b-4f39-a872-3eb0f3f897e9", titulo: "Usinas fotovoltaicas" },
    ],
  },

  objecoes: {
    eyebrow: "Direto ao ponto",
    titulo: "Perguntas de quem decide",
    lista: [
      {
        q: "Migrar custa quanto?",
        a: "Nada. A migração é 100% gratuita — sem custos para a empresa.",
      },
      {
        q: "Vai precisar de obra ou parada de operação?",
        a: "Não. Não há investimento nem obras na propriedade. A entrega física da energia continua pela mesma rede.",
      },
      {
        q: "Minha empresa se qualifica?",
        a: "O Mercado Livre é voltado a empresas e grandes consumidores. A qualificação é verificada no estudo gratuito, a partir das suas faturas.",
      },
      {
        q: "Fico preso a um contrato longo?",
        a: "O produto é descrito como sem fidelidade, com flexibilidade total.",
      },
      {
        q: "A energia é realmente renovável?",
        a: "Sim. São fontes renováveis certificadas, o que também serve como insumo para relatórios de sustentabilidade.",
      },
      {
        q: "Quem acompanha depois da migração?",
        a: "Há consultoria especializada durante todo o processo e gestão digital simplificada depois.",
      },
    ],
  },

  fechamento: {
    titulo: "O estudo é gratuito.",
    destaque: "A economia, recorrente.",
    sub: "Envie as faturas de energia da empresa. O consultor verifica a qualificação, projeta a economia e apresenta as condições — antes de qualquer contrato.",
    cta: "Quero o estudo de viabilidade",
    rodape: "Até 30% de desconto · Migração gratuita · Sem obra · Sem fidelidade",
  },
  legal:
    "A migração para o Mercado Livre de Energia depende da qualificação da unidade consumidora conforme a regulação vigente. O desconto de até 30% varia com o perfil de consumo, a distribuidora e as condições de contratação. " +
    LEGAL_BASE,

  ordem: ["problema", "solucao", "passos", "destaques", "comparacao", "galeria", "videos", "objecoes"],
  ancoras: [
    { label: "Como migrar", href: "#passos" },
    { label: "Vantagens", href: "#destaques" },
    { label: "Comparação", href: "#comparacao" },
    { label: "Dúvidas", href: "#objecoes" },
  ],
};

/* ══════════════════════════════════════════════════════════════
   6. CONEXÃO CLUB
   ══════════════════════════════════════════════════════════════ */

const CLUB: ProdutoPremium = {
  slug: "conexao-club",
  nome: "Conexão Club",
  marca: "iGreen Club",
  publico: "Para quem quer gastar menos no que já compra todo mês",

  eyebrow: "Conexão Club · iGreen Club",
  h1: { antes: "Desconto em", destaque: "30 mil lojas", depois: "nas compras que você já faz" },
  sub: "Farmácia, supermercado, moda, pet, cinema e restaurante. Mais de 600 mil produtos e serviços com preço exclusivo, direto no aplicativo.",
  reducaoRisco: "O consultor explica como funciona e como usar antes de você decidir.",

  ctaPrincipal: "Quero acesso ao Club",
  waPrincipal: "Olá! Quero saber como funciona o iGreen Club e como ter acesso aos descontos.",

  confianca: [
    { label: "30 mil lojas", detalhe: "parceiras no Brasil" },
    { label: "600 mil produtos", detalhe: "com preço exclusivo" },
    { label: "Cashback", detalhe: "nas compras" },
    { label: "No aplicativo", detalhe: "fácil de usar" },
  ],
  numeros: [
    { valor: "30 mil", rotulo: "lojas parceiras" },
    { valor: "600 mil", rotulo: "produtos e serviços" },
    { valor: "todos os dias", rotulo: "novas ofertas" },
  ],

  problema: {
    eyebrow: "O gasto invisível",
    titulo: "O dinheiro não escapa nas compras grandes.",
    destaque: "Escapa nas pequenas.",
    intro:
      "Remédio, mercado, lanche, cinema, presente. São valores baixos, repetidos muitas vezes — e é aí que o mês inteiro se decide.",
    itens: [
      {
        t: "Você paga o preço de tabela por hábito",
        b: "Comprar sempre no mesmo lugar, do mesmo jeito, custa mais caro sem que ninguém perceba.",
      },
      {
        t: "Caçar cupom dá trabalho",
        b: "Procurar desconto em cada site e cada app consome tempo que quase ninguém tem.",
      },
      {
        t: "Programa de pontos que não vira nada",
        b: "Muitos programas exigem acúmulo alto e vencem antes de valer a pena resgatar.",
      },
      {
        t: "Clube de vantagens que cobra mensalidade",
        b: "Quando o clube tem assinatura, boa parte da economia vai embora só para manter o acesso.",
      },
    ],
  },

  solucao: {
    eyebrow: "Como funciona",
    titulo: "Um lugar só para todo desconto",
    intro:
      "O iGreen Club reúne as lojas parceiras num aplicativo. Você consulta antes de comprar e usa o desconto na hora.",
    pontos: [
      {
        t: "Mais de 30 mil lojas parceiras",
        b: "Rede ampla em todo o Brasil: as chances de a loja que você já usa estar dentro são altas.",
      },
      {
        t: "Mais de 600 mil produtos e serviços",
        b: "Não é uma lista curta de parceiros: cobre farmácia, mercado, moda, eletrônicos, pet e lazer.",
      },
      {
        t: "Cashback nas compras",
        b: "Além do desconto no preço, parte do valor volta para você.",
      },
      {
        t: "Ofertas renovadas",
        b: "Novas ofertas todos os dias — vale abrir o app antes de qualquer compra.",
      },
    ],
  },

  destaques: {
    eyebrow: "Onde você economiza",
    titulo: "As categorias que pesam no mês",
    intro: "Cada categoria da rede e o motivo de ela importar no seu orçamento.",
    lista: [
      {
        icone: "store",
        t: "Supermercado e varejo",
        b: "Desconto no que entra em casa toda semana, não só em compra grande.",
      },
      {
        icone: "shield-check",
        t: "Farmácias e drogarias",
        b: "Medicação de uso contínuo é despesa fixa: desconto aqui aparece todo mês.",
      },
      {
        icone: "smartphone",
        t: "Moda e eletrônicos",
        b: "Preço exclusivo nas compras planejadas, que são as de maior valor.",
      },
      {
        icone: "users",
        t: "Cinema, restaurante e lazer",
        b: "Sair de casa deixa de ser o primeiro item cortado do orçamento.",
      },
      {
        icone: "repeat",
        t: "Cashback em todas as compras",
        b: "Parte do que você gasta volta, somando ao desconto do preço.",
      },
      {
        icone: "wallet",
        t: "Sem mensalidade de clube",
        b: "O acesso é benefício de cliente iGreen: nenhuma assinatura separada.",
      },
      {
        icone: "smartphone",
        t: "App direto ao ponto",
        b: "Você acha a loja, vê o desconto e usa. Sem cadastro a cada compra.",
      },
      {
        icone: "clock",
        t: "Ofertas novas todo dia",
        b: "A lista muda: consultar antes de comprar virou hábito que compensa.",
      },
      {
        icone: "leaf",
        t: "Impacto ambiental positivo",
        b: "Parte do valor movimentado é direcionada a iniciativas sustentáveis.",
      },
    ],
  },

  galeria: {
    titulo: "Algumas das marcas parceiras",
    intro:
      "Uma amostra da rede. São mais de 30 mil lojas — estas são só algumas das mais conhecidas.",
    imagens: imagensDoCatalogo("conexao-club"),
    formato: "marcas",
    altBase: "Marca parceira do iGreen Club",
  },

  videos: {
    eyebrow: "Veja funcionando",
    titulo: "O Club em dois minutos",
    intro: "Como encontrar o desconto e como usar no dia a dia.",
    lista: [
      { id: VIDEO_CLUB, titulo: "iGreen Club: seu clube de descontos" },
      { id: VIDEO_CLUB_COMO, titulo: "Como usar o iGreen Club" },
    ],
  },

  objecoes: {
    eyebrow: "Direto ao ponto",
    titulo: "O que você deve estar se perguntando",
    lista: [
      {
        q: "Tem mensalidade?",
        a: "O acesso ao iGreen Club é um benefício de ser cliente iGreen, sem assinatura separada para usar.",
      },
      {
        q: "Só serve para compra online?",
        a: "A rede inclui lojas físicas e serviços — farmácia, supermercado, cinema e restaurante, entre outros.",
      },
      {
        q: "As lojas do meu bairro participam?",
        a: "A rede tem mais de 30 mil lojas parceiras em todo o Brasil. A consulta por loja é feita no próprio aplicativo.",
      },
      {
        q: "Como recebo o cashback?",
        a: "O cashback é aplicado nas compras realizadas pela plataforma e acompanhado pelo aplicativo.",
      },
      {
        q: "É difícil de usar?",
        a: "O aplicativo foi feito para consulta rápida: você procura a loja, vê o desconto disponível e usa.",
      },
      {
        q: "Quem pode ter acesso?",
        a: "Clientes iGreen recebem o acesso. O consultor desta página explica como funciona no seu caso.",
      },
    ],
  },

  fechamento: {
    titulo: "Antes da próxima compra,",
    destaque: "vale abrir o app.",
    sub: "Fale com o consultor para entender como ter acesso ao iGreen Club e começar a usar o desconto nas compras que você já faria de qualquer forma.",
    cta: "Quero acesso ao Club",
    rodape: "30 mil lojas · 600 mil produtos · Cashback · Sem mensalidade de clube",
  },
  legal:
    "A disponibilidade de lojas, produtos, descontos e cashback varia por região, parceiro e período, conforme as ofertas vigentes no aplicativo iGreen Club. " +
    LEGAL_BASE,

  ordem: ["problema", "solucao", "destaques", "galeria", "videos", "objecoes"],
  ancoras: [
    { label: "Como funciona", href: "#solucao" },
    { label: "Categorias", href: "#destaques" },
    { label: "Marcas", href: "#galeria" },
    { label: "Dúvidas", href: "#objecoes" },
  ],
};

/* ══════════════════════════════════════════════════════════════
   7. CONEXÃO CLUB PJ
   ══════════════════════════════════════════════════════════════ */

const CLUB_PJ: ProdutoPremium = {
  slug: "conexao-club-pj",
  nome: "Club para Empresas",
  marca: "iGreen Club Empresas",
  publico: "Para RH e gestores que querem beneficiar a equipe sem novo custo",

  eyebrow: "Conexão Club PJ · iGreen Club Empresas",
  h1: { antes: "Um benefício real para sua equipe,", destaque: "sem custo de implantação" },
  sub: "Sua empresa oferece acesso a descontos em mais de 30 mil lojas, com plataforma personalizável e relatórios de uso para o RH.",
  reducaoRisco: "Consultoria dedicada para implantação. O consultor apresenta o formato antes de qualquer decisão.",

  ctaPrincipal: "Falar com um especialista",
  waPrincipal:
    "Olá! Quero entender como implantar o iGreen Club para os colaboradores da minha empresa.",

  confianca: [
    { label: "Sem custo", detalhe: "de implantação" },
    { label: "White-label", detalhe: "com a sua marca" },
    { label: "Relatórios", detalhe: "de uso para o RH" },
    { label: "Consultoria", detalhe: "dedicada" },
  ],

  problema: {
    eyebrow: "O desafio do RH",
    titulo: "Benefício bom costuma vir com",
    destaque: "uma linha nova no orçamento",
    intro:
      "Retenção e satisfação são metas de todo RH. O problema quase nunca é a intenção — é o custo por colaborador.",
    itens: [
      {
        t: "Benefício novo é custo novo",
        b: "Cada programa adicional entra na folha. Em ano apertado, é o primeiro item a ser cortado.",
      },
      {
        t: "Colaborador sente o aperto no salário real",
        b: "Sem aumento, a percepção é de perda. O RH fica sem instrumento para responder.",
      },
      {
        t: "Programa que ninguém usa",
        b: "Benefício sem adesão vira custo sem retorno — e sem dado nenhum para justificar.",
      },
      {
        t: "Discurso ESG sem prática",
        b: "Falar de sustentabilidade sem nada concreto por trás desgasta a comunicação interna.",
      },
    ],
  },

  solucao: {
    eyebrow: "A proposta",
    titulo: "Economia real para a equipe, sem entrar na folha",
    intro:
      "O iGreen Club Empresas dá aos colaboradores acesso à rede de descontos, com plataforma personalizável e acompanhamento para a gestão.",
    pontos: [
      {
        t: "Sem custo de implantação",
        b: "A empresa oferece o benefício sem criar uma nova despesa de implantação.",
      },
      {
        t: "Plataforma com a sua marca",
        b: "Ambiente white-label personalizável: para o colaborador, o benefício é da empresa.",
      },
      {
        t: "Dados para o RH",
        b: "Dashboard de acompanhamento e relatórios de impacto e economia — adesão deixa de ser achismo.",
      },
      {
        t: "Posicionamento sustentável",
        b: "O programa conecta o benefício à agenda ESG da empresa, com iniciativas de energia limpa.",
      },
    ],
  },

  passos: {
    eyebrow: "Implantação",
    titulo: "Três etapas até a equipe usando",
    intro: "A consultoria conduz o processo do desenho à ativação.",
    lista: [
      {
        n: "01",
        t: "Conversa de diagnóstico",
        b: "Tamanho da equipe, perfil dos colaboradores e o que a empresa quer comunicar com o benefício.",
        meta: "Sem compromisso",
      },
      {
        n: "02",
        t: "Personalização da plataforma",
        b: "O ambiente é configurado com a identidade da empresa e o programa de recompensas é ajustado.",
        meta: "White-label",
      },
      {
        n: "03",
        t: "Ativação e acompanhamento",
        b: "A equipe recebe o acesso e o RH passa a acompanhar uso e economia pelo dashboard.",
        meta: "Ativação rápida",
      },
    ],
  },

  destaques: {
    eyebrow: "Para a empresa",
    titulo: "O que o programa entrega",
    intro: "Cada recurso e o efeito dele na gestão de pessoas.",
    lista: [
      {
        icone: "wallet",
        t: "Sem custo de implantação",
        b: "Benefício que não abre nova linha de despesa para começar.",
      },
      {
        icone: "users",
        t: "Satisfação e retenção",
        b: "Economia concreta no dia a dia do colaborador, sentida no orçamento da casa dele.",
      },
      {
        icone: "store",
        t: "Mais de 30 mil lojas",
        b: "Rede ampla o suficiente para ser útil a perfis muito diferentes de equipe.",
      },
      {
        icone: "smartphone",
        t: "Plataforma white-label",
        b: "Personalizável com a marca da empresa: o benefício reforça o employer branding.",
      },
      {
        icone: "trending-up",
        t: "Dashboard e relatórios",
        b: "Métricas de uso e de economia para justificar e melhorar o programa.",
      },
      {
        icone: "leaf",
        t: "Selo de empresa sustentável",
        b: "Conexão com a agenda ESG, com prática por trás do discurso.",
      },
      {
        icone: "percent",
        t: "Redução de custos operacionais",
        b: "A empresa também acessa condições em energia e telecom pela iGreen.",
      },
      {
        icone: "repeat",
        t: "Recompensas customizáveis",
        b: "O programa se adapta ao que faz sentido para a sua cultura.",
      },
      {
        icone: "message",
        t: "Suporte corporativo dedicado",
        b: "Canal próprio para o RH, sem fila de atendimento comum.",
      },
    ],
  },

  galeria: {
    titulo: "A rede que sua equipe acessa",
    intro:
      "Uma amostra das marcas parceiras. São mais de 30 mil lojas disponíveis para os colaboradores.",
    // Mesmas imagens do Club PF: são logos de marcas, então formato "marcas"
    // (quadrado) e não "documento". Rotular errado aqui daria a impressão de
    // material institucional quando são parceiros comerciais.
    imagens: imagensDoCatalogo("conexao-club-pj"),
    formato: "marcas",
    altBase: "Marca parceira do iGreen Club disponível para colaboradores",
  },

  videos: {
    eyebrow: "Veja funcionando",
    titulo: "Como o Club funciona",
    intro: "O mesmo aplicativo que os colaboradores vão usar.",
    lista: [
      { id: VIDEO_CLUB, titulo: "iGreen Club: seu clube de descontos" },
      { id: VIDEO_CLUB_COMO, titulo: "Como usar o iGreen Club" },
    ],
  },

  objecoes: {
    eyebrow: "Direto ao ponto",
    titulo: "As perguntas do comitê",
    lista: [
      {
        q: "Quanto custa para a empresa?",
        a: "O programa é apresentado como benefício corporativo sem custo de implantação para a empresa. O consultor detalha o formato aplicável ao seu caso.",
      },
      {
        q: "Dá para usar a nossa marca?",
        a: "Sim. A plataforma é white-label e personalizável com a identidade da empresa.",
      },
      {
        q: "Como medimos se está sendo usado?",
        a: "Há dashboard de acompanhamento e relatórios de impacto e economia para o RH.",
      },
      {
        q: "Serve para equipes de qualquer tamanho?",
        a: "A implantação é conduzida por consultoria dedicada, que ajusta o programa ao tamanho e ao perfil da equipe.",
      },
      {
        q: "Quanto tempo leva para ativar?",
        a: "A ativação é descrita como rápida para toda a equipe, após a personalização da plataforma.",
      },
      {
        q: "Ajuda na nossa pauta ESG?",
        a: "Sim. O programa está ligado a iniciativas de sustentabilidade da iGreen e serve como posicionamento ESG.",
      },
    ],
  },

  fechamento: {
    titulo: "Um benefício que a equipe usa.",
    destaque: "E o RH consegue medir.",
    sub: "Fale com o consultor para ver o formato de implantação, a personalização com a sua marca e os relatórios que o RH recebe.",
    cta: "Falar com um especialista",
    rodape: "Sem custo de implantação · White-label · Relatórios para o RH · Consultoria dedicada",
  },
  legal:
    "Condições de implantação, personalização e relatórios conforme a proposta apresentada para cada empresa. A disponibilidade de lojas e descontos varia por região e período. " +
    LEGAL_BASE,

  ordem: ["problema", "solucao", "passos", "destaques", "galeria", "videos", "objecoes"],
  ancoras: [
    { label: "A proposta", href: "#solucao" },
    { label: "Implantação", href: "#passos" },
    { label: "Recursos", href: "#destaques" },
    { label: "Dúvidas", href: "#objecoes" },
  ],
};

/* ══════════════════════════════════════════════════════════════
   Registro
   ══════════════════════════════════════════════════════════════ */

export const PRODUTOS_PREMIUM: Record<ProdutoSlug, ProdutoPremium> = {
  "conexao-telecom": TELECOM,
  "conexao-seguros": SEGUROS,
  "conexao-solar": SOLAR,
  "conexao-placas": PLACAS,
  "conexao-livre": LIVRE,
  "conexao-club": CLUB,
  "conexao-club-pj": CLUB_PJ,
};

/** Busca a configuração premium por slug. `null` se o slug não é atendido. */
export function produtoPremiumPorSlug(slug: string | undefined): ProdutoPremium | null {
  if (!slug) return null;
  return PRODUTOS_PREMIUM[slug as ProdutoSlug] ?? null;
}
