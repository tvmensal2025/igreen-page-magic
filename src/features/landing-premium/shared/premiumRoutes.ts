/**
 * Mapa das rotas premium — fonte única para a navegação entre as páginas.
 *
 * Todas as rotas premium ficam sob o prefixo `/premium`, o que garante duas
 * coisas: nenhum conflito com as rotas originais (`/conexao-*`, `/licenciado`,
 * `/:licenca`) e um lugar só para adicionar produto novo.
 *
 * `slugProduto` é o slug real do catálogo (`src/data/conexaoProducts.ts`), usado
 * para buscar o conteúdo e para escolher o acento visual.
 */

export interface PremiumRoute {
  /** Slug do produto no catálogo, ou identificador da página. */
  id: string;
  /** Rótulo curto para o menu. */
  label: string;
  /** Descrição de uma linha, exibida no menu do celular. */
  resumo: string;
  /** Caminho premium com `:licenca` a ser substituído. */
  path: (licenca: string) => string;
  /** Agrupamento no menu. */
  grupo: "energia" | "servicos" | "beneficios" | "negocio";
}

export const PREMIUM_ROUTES: PremiumRoute[] = [
  {
    id: "conexao-green",
    label: "Conexão Green",
    resumo: "Até 20% de desconto na conta de luz, sem placas",
    path: (l) => `/premium/${l}`,
    grupo: "energia",
  },
  {
    id: "conexao-livre",
    label: "Conexão Livre",
    resumo: "Mercado Livre de Energia, até 30% para empresas",
    path: (l) => `/premium/conexao-livre/${l}`,
    grupo: "energia",
  },
  {
    id: "conexao-solar",
    label: "Conexão Solar",
    resumo: "Energia de fazendas solares por assinatura",
    path: (l) => `/premium/conexao-solar/${l}`,
    grupo: "energia",
  },
  {
    id: "conexao-placas",
    label: "Conexão Placas",
    resumo: "Sistema próprio no seu telhado, até 95%",
    path: (l) => `/premium/conexao-placas/${l}`,
    grupo: "energia",
  },
  {
    id: "conexao-telecom",
    label: "Conexão Telecom",
    resumo: "Planos 5G a partir de R$ 39,90, sem fidelidade",
    path: (l) => `/premium/conexao-telecom/${l}`,
    grupo: "servicos",
  },
  {
    id: "conexao-seguros",
    label: "Conexão Seguros",
    resumo: "Proteção veicular a partir de R$ 99/mês",
    path: (l) => `/premium/conexao-seguros/${l}`,
    grupo: "servicos",
  },
  {
    id: "conexao-club",
    label: "Conexão Club",
    resumo: "Descontos em 30 mil lojas no Brasil",
    path: (l) => `/premium/conexao-club/${l}`,
    grupo: "beneficios",
  },
  {
    id: "conexao-club-pj",
    label: "Club para Empresas",
    resumo: "Benefício corporativo sem custo de implantação",
    path: (l) => `/premium/conexao-club-pj/${l}`,
    grupo: "beneficios",
  },
  {
    id: "conexao-expansao",
    label: "Seja Licenciado",
    resumo: "Plano de carreira e comissões recorrentes",
    path: (l) => `/premium/expansao/${l}`,
    grupo: "negocio",
  },
];

export const GRUPO_LABEL: Record<PremiumRoute["grupo"], string> = {
  energia: "Energia",
  servicos: "Serviços",
  beneficios: "Benefícios",
  negocio: "Oportunidade",
};

/** Slugs de produto que a LP premium genérica de produto atende. */
export const PRODUTO_SLUGS = [
  "conexao-telecom",
  "conexao-seguros",
  "conexao-solar",
  "conexao-placas",
  "conexao-livre",
  "conexao-club",
  "conexao-club-pj",
] as const;

export type ProdutoSlug = (typeof PRODUTO_SLUGS)[number];
