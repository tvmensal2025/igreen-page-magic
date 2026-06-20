// =============================================================================
// Orçamento — Catálogo comercial por família de produto
// =============================================================================
// Cada família de produto tem uma lógica comercial diferente para o orçamento:
//   - telecom:  planos fixos (mensalidade), com/sem portabilidade
//   - seguros:  planos de proteção veicular (mensalidade por faixa)
//   - placas:   venda de sistema fotovoltaico (valor do projeto + financiamento)
//   - energia:  estimativa de economia na conta de luz (% sobre a conta)
//   - club:     mensalidade do clube de benefícios
//   - expansao: oportunidade de licenciamento (sem orçamento ao cliente)
//
// Este catálogo descreve PLANOS/PREÇOS de referência e como montar o valor do
// orçamento. Os números são valores de tabela públicos (planos iGreen Telecom,
// faixas de proteção veicular) e servem de ponto de partida — o consultor pode
// ajustar o valor final na proposta.
// =============================================================================

import type { ProductFamily } from "../catalogo/types";

// ---------------------------------------------------------------------------
// Allowlist de produtos vendáveis por orçamento (por slug).
// ---------------------------------------------------------------------------
// O orçamento é gerado só para estas 5 frentes de venda. Os demais produtos
// (Green, Club, Club PJ, Expansão) continuam no catálogo/banco com landing,
// pontuação e venda intactos — apenas não aparecem no seletor do builder,
// porque hoje seu fechamento é manual.
//
// A filtragem é por SLUG (não por família) de propósito: Solar, Livre e Green
// compartilham a família `energia`, então filtrar por família removeria os três
// juntos. O slug é a granularidade correta.
export const QUOTABLE_PRODUCT_SLUGS = [
  "conexao-solar", // placa no modelo assinatura (desconto, sem instalar)
  "conexao-placas", // venda do sistema fotovoltaico (compra + instalação)
  "conexao-telecom", // telefonia/chip
  "conexao-seguros", // proteção veicular
  "conexao-livre", // mercado livre de energia
] as const;

const QUOTABLE_SET = new Set<string>(QUOTABLE_PRODUCT_SLUGS);

/** True se o produto (por slug) pode gerar orçamento no builder. */
export function isQuotableProduct(slug: string): boolean {
  return QUOTABLE_SET.has(slug);
}

// ---------------------------------------------------------------------------
// Plano comercial (item selecionável no orçamento).
// ---------------------------------------------------------------------------
export interface CommercialPlan {
  /** Identificador estável do plano. */
  id: string;
  /** Nome exibido. */
  label: string;
  /** Mensalidade de referência em centavos (inteiro). Ex.: 5490 = R$ 54,90. */
  price: number;
  /** Periodicidade do preço. */
  period: "month" | "once";
  /** Destaques do plano (bullets na proposta). */
  highlights: string[];
  /** Metadados específicos (ex.: dados do plano telecom). */
  meta?: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// Como o valor do orçamento é montado para cada família.
//   - plan_monthly: mensalidade do plano escolhido (telecom, seguros, club)
//   - project_once: valor único do projeto (placas), com financiamento opcional
//   - savings_estimate: estimativa de economia sobre a conta de luz (energia)
//   - market_free:      mercado livre de energia (até 30%, sem valor exato —
//                       foco na solução e na parceria Comerc + iGreen)
//   - none:             produto não orçável (ex.: Expansão) — sem planos e sem
//                       valor calculado; o builder não oferece orçamento.
// ---------------------------------------------------------------------------
export type PricingMode =
  | "plan_monthly"
  | "project_once"
  | "savings_estimate"
  | "market_free"
  | "none";

export interface FamilyCommercialConfig {
  family: ProductFamily;
  pricingMode: PricingMode;
  /** Rótulo do valor principal exibido na proposta. */
  amountLabel: string;
  /** Planos de referência (vazio quando o valor é livre/estimado). */
  plans: CommercialPlan[];
  /** Texto curto explicando a lógica comercial (aparece no builder). */
  commercialNote: string;
  /** % de desconto estimado na conta (apenas energia). [min, max] */
  savingsRange?: [number, number];
}

// ─── Telecom (planos oficiais iGreen Telecom) ───────────────────────────────
const TELECOM_PLANS: CommercialPlan[] = [
  {
    id: "start",
    label: "Start — 11GB",
    price: 5490,
    period: "month",
    highlights: [
      "6GB + 5GB na portabilidade",
      "Ligações e WhatsApp ilimitados",
      "Internet acumulada + iGreen Club grátis",
    ],
    meta: { dados: "11GB", semPortabilidade: 5990 },
  },
  {
    id: "mega",
    label: "Mega — 15GB",
    price: 5990,
    period: "month",
    highlights: [
      "10GB + 5GB na portabilidade",
      "Ligações e WhatsApp ilimitados",
      "Internet acumulada + iGreen Club grátis",
    ],
    meta: { dados: "15GB", semPortabilidade: 6490 },
  },
  {
    id: "giga",
    label: "Giga — 20GB",
    price: 6990,
    period: "month",
    highlights: [
      "15GB + 5GB na portabilidade",
      "Ligações e WhatsApp ilimitados",
      "Internet acumulada + iGreen Club grátis",
    ],
    meta: { dados: "20GB", semPortabilidade: 7490 },
  },
  {
    id: "ultra",
    label: "Ultra — 28GB",
    price: 7990,
    period: "month",
    highlights: [
      "23GB + 5GB na portabilidade",
      "Ligações e WhatsApp ilimitados",
      "Internet acumulada + iGreen Club grátis",
    ],
    meta: { dados: "28GB", semPortabilidade: 8490 },
  },
  {
    id: "infinity",
    label: "Infinity — 50GB",
    price: 9990,
    period: "month",
    highlights: [
      "45GB + 5GB na portabilidade",
      "Ligações e WhatsApp ilimitados",
      "Internet acumulada + iGreen Club grátis",
    ],
    meta: { dados: "50GB", semPortabilidade: 10490 },
  },
];

// ─── Seguros (faixas de proteção veicular) ──────────────────────────────────
const SEGUROS_PLANS: CommercialPlan[] = [
  {
    id: "basic",
    label: "Basic",
    price: 9900,
    period: "month",
    highlights: [
      "Roubo, furto e assistência 24h",
      "Guincho até 200km",
      "Carro reserva por 7 dias",
    ],
  },
  {
    id: "premium",
    label: "Premium",
    price: 14900,
    period: "month",
    highlights: [
      "Tudo do Basic + colisão, incêndio e vidros",
      "Guincho ilimitado",
      "Proteção de retrovisores",
    ],
  },
  {
    id: "infinite",
    label: "Infinite",
    price: 19900,
    period: "month",
    highlights: [
      "Tudo do Premium + cobertura a terceiros",
      "Carro reserva por 30 dias",
      "Proteção de acessórios e desconto em estacionamentos",
    ],
  },
];

// ─── Club (mensalidade do clube de benefícios) ──────────────────────────────
const CLUB_PLANS: CommercialPlan[] = [
  {
    id: "club-pf",
    label: "iGreen Club",
    price: 2990,
    period: "month",
    highlights: [
      "Descontos em +30 mil lojas",
      "Cashback em compras",
      "Cinema, farmácias e restaurantes",
    ],
  },
];

// ─── Mapa família → configuração comercial ──────────────────────────────────
export const FAMILY_COMMERCIAL: Record<ProductFamily, FamilyCommercialConfig> = {
  telecom: {
    family: "telecom",
    pricingMode: "plan_monthly",
    amountLabel: "Mensalidade",
    plans: TELECOM_PLANS,
    commercialNote:
      "Plano mensal sem fidelidade. Com portabilidade o cliente ganha +5GB e mantém o número.",
  },
  seguros: {
    family: "seguros",
    pricingMode: "plan_monthly",
    amountLabel: "Mensalidade",
    plans: SEGUROS_PLANS,
    commercialNote:
      "Proteção veicular mensal. O valor final pode variar conforme o veículo informado na captura.",
  },
  club: {
    family: "club",
    pricingMode: "plan_monthly",
    amountLabel: "Mensalidade",
    plans: CLUB_PLANS,
    commercialNote: "Clube de benefícios com cashback e descontos. Cobrança mensal recorrente.",
  },
  placas: {
    family: "placas",
    pricingMode: "project_once",
    amountLabel: "Valor do projeto",
    plans: [],
    commercialNote:
      "Venda de sistema fotovoltaico. Informe o valor do projeto (à vista) e, se houver, a opção de financiamento em até 120x.",
  },
  energia: {
    family: "energia",
    pricingMode: "savings_estimate",
    amountLabel: "Economia estimada/mês",
    plans: [],
    commercialNote:
      "Energia por assinatura sem custo de adesão. O orçamento mostra a economia estimada sobre a conta de luz atual do cliente.",
    savingsRange: [0.15, 0.2],
  },
  expansao: {
    family: "expansao",
    pricingMode: "none",
    amountLabel: "Investimento",
    plans: [],
    commercialNote:
      "Oportunidade de licenciamento — não gera orçamento ao cliente final. Use a landing de Expansão.",
  },
};

/** Retorna a configuração comercial de uma família. */
export function getCommercialConfig(family: ProductFamily): FamilyCommercialConfig {
  return FAMILY_COMMERCIAL[family];
}

// ===========================================================================
// Benefícios iGreen Club — conquistar o cliente na proposta
// ===========================================================================
// Incluso gratuitamente em todos os produtos (energia, telecom, seguros). Os
// dados são públicos (site iGreen Club / Clube Certo) e servem para enriquecer
// a proposta com prova de valor concreta: farmácias, cinemas, restaurantes.
export interface ClubBenefit {
  icon: "pharmacy" | "cinema" | "food" | "shopping" | "travel" | "cashback";
  label: string;
  detail: string;
}

export const IGREEN_CLUB_BENEFITS: ClubBenefit[] = [
  {
    icon: "pharmacy",
    label: "Farmácias",
    detail: "Descontos em Drogasil, Droga Raia, Onofre e Farmadelivery.",
  },
  {
    icon: "cinema",
    label: "Cinemas",
    detail: "Meia-entrada e combo de pipoca com desconto — até 50% off.",
  },
  {
    icon: "food",
    label: "Restaurantes & Apps",
    detail: "Até 30% em restaurantes, iFood, Rappi e delivery.",
  },
  {
    icon: "shopping",
    label: "Lojas & Online",
    detail: "Magalu, Casas Bahia, Netshoes, Nike, Centauro e +30 mil lojas.",
  },
  {
    icon: "travel",
    label: "Viagens",
    detail: "Passagens, hotéis e pacotes (LATAM, Gol, Azul, Booking, CVC).",
  },
  {
    icon: "cashback",
    label: "Cashback sustentável",
    detail: "Indique amigos e acumule crédito para abater na conta de luz.",
  },
];

export const IGREEN_CLUB_SUMMARY =
  "iGreen Club grátis: +600 mil ofertas em +30 mil lojas de todo o Brasil, com descontos de até 90% e geolocalização no app.";

// ===========================================================================
// Perfil comercial por SLUG (sobrepõe a config da família)
// ===========================================================================
// Solar e Livre dividem a família `energia`, mas vendem de formas diferentes:
//   - Solar: assinatura de energia solar, economia estimada de até 20%.
//   - Livre: mercado livre de energia (ACL), até 30% via parceria Comerc +
//            iGreen, SEM valor exato — foco na solução, gestão e credibilidade.
// O perfil por slug permite essa distinção sem quebrar a config por família.
export interface SlugCommercialProfile {
  /** Sobrepõe o modo de precificação da família, quando necessário. */
  pricingMode?: PricingMode;
  /** Sobrepõe o rótulo do valor principal. */
  amountLabel?: string;
  /** Sobrepõe a nota comercial exibida no builder. */
  commercialNote?: string;
  /** Sobrepõe a faixa de economia (energia). */
  savingsRange?: [number, number];
  /** Título comercial curto para a proposta. */
  headline?: string;
  /** Diferenciais exibidos na proposta pública. */
  highlights?: string[];
  /** Nota sobre parceria/credibilidade (ex.: Comerc na Conexão Livre). */
  partnerNote?: string;
  /** Mostra os benefícios do iGreen Club na proposta deste produto. */
  showClubBenefits?: boolean;

  // ── Mídia do "site de proposta" (todos os caminhos são assets reais) ──
  /** Imagem de fundo do hero. */
  heroImage?: string;
  /** Subtítulo do hero (frase de impacto). */
  heroSubtitle?: string;
  /** Vídeo explicativo ("Como funciona"). Caminho de arquivo local (legado). */
  video?: string;
  /** ID do vídeo do topo (mesmo da landing do produto, hospedado no MinIO).
      É o vídeo oficial de cada produto — preferir este a `video`. */
  heroVideoId?: string;
  /** Passos de "como funciona" (numerados na proposta). */
  steps?: { title: string; detail: string }[];
  /** Galeria de imagens (prova visual). */
  gallery?: string[];
  /** Métricas de credibilidade (parceria/empresa). */
  stats?: { value: string; label: string }[];
  /** Vídeos de depoimento (prova social). */
  testimonials?: string[];
}

export const SLUG_COMMERCIAL: Record<string, SlugCommercialProfile> = {
  "conexao-solar": {
    pricingMode: "savings_estimate",
    amountLabel: "Economia estimada/mês",
    savingsRange: [0.1, 0.2],
    headline: "Energia solar por assinatura — até 20% de desconto na conta",
    commercialNote:
      "Energia solar por assinatura: a energia é gerada em fazendas solares (não há placas instaladas no imóvel do cliente). Sem custo de adesão, sem obras e sem fidelidade. Mostre a economia estimada sobre a conta atual.",
    highlights: [
      "Até 20% de desconto na conta de luz, todo mês",
      "Energia solar gerada em fazendas solares — sem instalar placas no seu imóvel",
      "Sem investimento em equipamentos e sem taxa de adesão",
      "Cancele quando quiser — sem fidelidade, regulamentado pela ANEEL/Lei 14.300",
    ],
    partnerNote:
      "Energia limpa gerada em fazendas solares (parceria Comerc — usina Hélio Valgas, 5ª maior do Brasil, 662 MWp).",
    showClubBenefits: true,
    heroImage: "/images/feed-1.jpeg",
    heroSubtitle:
      "Receba energia solar por assinatura, gerada em fazendas solares, e veja sua conta de luz cair todo mês — sem instalar nada e sem custo de adesão.",
    heroVideoId: "e71c0378-9980-40f0-9110-6e41ea908a15",
    steps: [
      {
        title: "Nossas fazendas solares geram energia",
        detail: "A energia limpa é produzida em fazendas solares e injetada na rede da distribuidora.",
      },
      {
        title: "A distribuidora entrega na sua casa",
        detail: "Você continua recebendo energia normalmente, pela mesma rede de sempre.",
      },
      {
        title: "Você economiza todo mês",
        detail: "Recebe até 20% de desconto na conta de luz, sem nenhum custo de adesão.",
      },
    ],
    gallery: ["/images/conexao-solar.webp", "/images/cashback-sustentavel.jpeg", "/images/feed-1.jpeg"],
    stats: [
      { value: "600 mil+", label: "clientes ativos" },
      { value: "até 20%", label: "de desconto na conta" },
      { value: "662 MWp", label: "usina Hélio Valgas" },
    ],
    testimonials: ["/videos/depoimento-1.mp4", "/videos/depoimento-2.mp4", "/videos/depoimento-3.mp4"],
  },
  "conexao-placas": {
    pricingMode: "project_once",
    amountLabel: "Valor do projeto",
    headline: "Sistema fotovoltaico próprio — até 95% de economia",
    commercialNote:
      "Venda do sistema fotovoltaico instalado no imóvel do cliente. Informe o valor do projeto (à vista) e, se houver, o financiamento em até 120x. Visita técnica após o aceite.",
    highlights: [
      "Até 95% de economia na conta de luz",
      "Projeto sob medida + visita técnica após aprovação",
      "Garantia: painéis 15 anos, inversor 10 anos, desempenho 30 anos",
      "1 ano de seguro fotovoltaico grátis + registro Inmetro",
      "Financiamento em até 120x e entrega em até 45 dias úteis",
    ],
    partnerNote:
      "Equipamentos homologados Inmetro. Não inclui obras civis, transformador ou medidor.",
    showClubBenefits: false,
    heroImage: "/images/conexao-placas.webp",
    heroSubtitle:
      "Gere sua própria energia com um sistema fotovoltaico instalado no seu imóvel e reduza a conta de luz em até 95%.",
    heroVideoId: "ad9ddfd6-3505-49ee-bbd1-2e44a2cb6d7c",
    steps: [
      {
        title: "Projeto sob medida",
        detail: "Dimensionamos o sistema para o seu consumo, com simulação de geração e economia.",
      },
      {
        title: "Visita técnica e instalação",
        detail: "Após a aprovação, agendamos a visita e instalamos com equipe especializada.",
      },
      {
        title: "Economia por décadas",
        detail: "Painéis com garantia de desempenho de até 30 anos gerando energia limpa.",
      },
    ],
    gallery: ["/images/conexao-placas.webp", "/images/feed-1.jpeg", "/images/feed-10.jpeg"],
    stats: [
      { value: "até 95%", label: "de economia na conta" },
      { value: "120x", label: "financiamento facilitado" },
      { value: "25 anos", label: "de garantia" },
    ],
  },
  "conexao-livre": {
    pricingMode: "market_free",
    amountLabel: "Desconto estimado",
    headline: "Mercado Livre de Energia — até 30% de economia",
    commercialNote:
      "Migração para o Ambiente de Contratação Livre (ACL) via parceria Comerc + iGreen. Para empresas e grandes consumidores. NÃO informe valor fechado: o foco é a solução e a economia de até 30% (a estimativa exata vem da análise de viabilidade).",
    savingsRange: [0.15, 0.3],
    highlights: [
      "Até 30% de economia na energia para empresas",
      "Migração 100% gratuita, sem obras e sem investimento",
      "Gestão completa na CCEE + telemetria + plataforma PowerView",
      "Energia de fontes renováveis com certificado (I-REC)",
    ],
    partnerNote:
      "Parceria Comerc: ~7% de toda a energia do Brasil passa pela Comerc, 5 mil unidades em gestão e 2,2 GW de capacidade instalada.",
    showClubBenefits: false,
    heroImage: "/images/conexao-livre.webp",
    heroSubtitle:
      "Sua empresa migra para o Mercado Livre de Energia com a gestão da Comerc e economiza até 30% — sem obras e sem investimento.",
    heroVideoId: "9b67408c-8b26-4b3e-834b-c02908f21324",
    steps: [
      {
        title: "Análise de viabilidade",
        detail: "A Comerc avalia seu consumo e mostra a economia real possível, sem custo.",
      },
      {
        title: "Migração e gestão na CCEE",
        detail: "Cuidamos de toda a documentação, telemetria e representação na CCEE.",
      },
      {
        title: "Economia e previsibilidade",
        detail: "Acompanhe consumo e economia pela plataforma PowerView, mês a mês.",
      },
    ],
    gallery: ["/images/conexao-livre.webp", "/images/conexao-livre-banner.png"],
    stats: [
      { value: "até 30%", label: "de economia" },
      { value: "~7%", label: "da energia do Brasil" },
      { value: "2,2 GW", label: "capacidade instalada" },
    ],
  },
  "conexao-telecom": {
    headline: "iGreen Telecom 5G — sem fidelidade, internet que acumula",
    highlights: [
      "+5GB grátis e permanentes ao fazer a portabilidade",
      "Ligações e WhatsApp ilimitados em todos os planos",
      "Internet que acumula para o mês seguinte",
      "Sem fidelidade — cancele quando quiser",
    ],
    showClubBenefits: true,
    heroImage: "/images/conexao-telecom.webp",
    heroSubtitle:
      "Internet 5G com a maior cobertura do Brasil, ligações e WhatsApp ilimitados, e o que você não usar acumula para o mês seguinte.",
    heroVideoId: "073a2de8-4096-4096-b499-5b0fb1e0de3e",
    steps: [
      {
        title: "Escolha seu plano",
        detail: "De 11GB a 50GB, todos com 5G, ligações e WhatsApp ilimitados.",
      },
      {
        title: "Faça a portabilidade",
        detail: "Traga seu número e ganhe +5GB grátis e permanentes em qualquer plano.",
      },
      {
        title: "Ative e gerencie pelo app",
        detail: "Ativação 100% digital e o que não usar acumula para o próximo mês.",
      },
    ],
    gallery: ["/images/planos-igreen-telecom.png", "/images/conexao-telecom.webp"],
    stats: [
      { value: "5G", label: "cobertura nacional" },
      { value: "+5GB", label: "grátis na portabilidade" },
      { value: "0", label: "fidelidade" },
    ],
  },
  "conexao-seguros": {
    headline: "Proteção veicular completa, até 60% mais barata",
    highlights: [
      "Cobertura contra roubo, furto, colisão e terceiros",
      "Assistência 24h e guincho em todo o Brasil",
      "Sem análise de perfil e sem burocracia",
      "Rede com +5.000 oficinas credenciadas",
    ],
    showClubBenefits: true,
    heroImage: "/__l5e/assets-v1/e11e76fd-3666-4a8b-bae3-aff7cb8a6b27/conexao-seguros.jpg",
    heroSubtitle:
      "Proteja seu veículo com cobertura completa, assistência 24h e preço até 60% mais acessível que as seguradoras tradicionais.",
    heroVideoId: "d812a2d3-6e3c-4eb7-b2f3-2778df2c1f1b",
    steps: [
      {
        title: "Escolha o plano",
        detail: "Basic, Premium ou Infinite — cobertura sob medida para o seu veículo.",
      },
      {
        title: "Contrate sem burocracia",
        detail: "Sem análise de perfil e sem vistoria complicada para ativar.",
      },
      {
        title: "Conte com assistência 24h",
        detail: "Guincho, carro reserva e rede com +5.000 oficinas em todo o Brasil.",
      },
    ],
    gallery: [
      "/__l5e/assets-v1/e11e76fd-3666-4a8b-bae3-aff7cb8a6b27/conexao-seguros.jpg",
      "/images/cashback-sustentavel.jpeg",
    ],
    stats: [
      { value: "até 60%", label: "mais barato" },
      { value: "24h", label: "assistência nacional" },
      { value: "+5.000", label: "oficinas credenciadas" },
    ],
  },

};

/** Retorna o perfil comercial específico de um produto (por slug), se houver. */
export function getSlugProfile(slug: string): SlugCommercialProfile | null {
  return SLUG_COMMERCIAL[slug] ?? null;
}

/**
 * Resolve a configuração comercial efetiva de um produto, combinando a config
 * da família com o perfil específico do slug (que tem prioridade). É o que o
 * builder deve usar para Solar × Livre × Placas se comportarem corretamente.
 */
export function resolveCommercialConfig(
  slug: string,
  family: ProductFamily,
): FamilyCommercialConfig {
  const base = FAMILY_COMMERCIAL[family];
  const profile = SLUG_COMMERCIAL[slug];
  if (!profile) return base;
  return {
    ...base,
    pricingMode: profile.pricingMode ?? base.pricingMode,
    amountLabel: profile.amountLabel ?? base.amountLabel,
    commercialNote: profile.commercialNote ?? base.commercialNote,
    savingsRange: profile.savingsRange ?? base.savingsRange,
  };
}
