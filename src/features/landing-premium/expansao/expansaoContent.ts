/**
 * Conteúdo da LP premium da Expansão (ser Licenciado iGreen).
 *
 * ── Fonte dos dados ────────────────────────────────────────────────────────
 * Tudo vem de `src/components/licenciada/*`, que é a página original:
 * - LicCareerPlan: os 5 níveis, as metas em kWh e os percentuais por produto
 * - LicConexaoExpansao: bônus de R$ 300 / R$ 100, 30% do kWh, 5 níveis, regras
 *   de qualificação por equipe
 * - LicLicenseSection: o que a licença inclui
 *
 * ── Cuidado deliberado com renda ───────────────────────────────────────────
 * A página original exibe um valor mensal ao lado de cada nível (de R$ 500 a
 * R$ 50.000) e usa frases como "dinheiro que você deixa na mesa". Esses valores
 * são METAS do plano de carreira atreladas a acúmulo de kWh — não são renda
 * garantida, e não existe no projeto nenhum dado de resultado médio.
 *
 * Aqui os mesmos números são preservados (não inventamos nem escondemos), mas
 * rotulados pelo que são: "bônus de qualificação ao atingir a meta". O tom de
 * urgência artificial foi removido. O que convence aqui é a mecânica ser clara.
 */

/* ══════════════════════════════════════════════════════════════
   Plano de carreira — valores literais da página original
   ══════════════════════════════════════════════════════════════ */

export interface NivelCarreira {
  ordem: number;
  nome: string;
  /** Meta de kWh acumulado para qualificar. */
  meta: string;
  /** Bônus de qualificação declarado no plano (não é renda garantida). */
  bonus: string;
  /** Reconhecimento adicional do nível, quando houver. */
  extra?: string;
  /** Acréscimo de comissão por produto ao atingir o nível. */
  acrescimos: string[];
}

export const NIVEIS_CARREIRA: NivelCarreira[] = [
  {
    ordem: 1,
    nome: "Sênior",
    meta: "10.000 kWh",
    bonus: "R$ 500/mês",
    acrescimos: [
      "Conexão Green +0,2%",
      "Conexão Livre +0,1%",
      "Conexão Placas +0,2%",
      "Conexão Club +2%",
      "Conexão Club PJ +1,3%",
      "Conexão Telecom +R$ 1,00",
      "Expansão +R$ 70 por licenciado direto",
    ],
  },
  {
    ordem: 2,
    nome: "Gestor",
    meta: "50.000 kWh",
    bonus: "R$ 2.000/mês",
    extra: "iGreen Experience",
    acrescimos: [
      "Conexão Green +0,5%",
      "Conexão Livre +0,25%",
      "Conexão Placas +0,5%",
      "Conexão Club +5%",
      "Conexão Club PJ +3,3%",
      "Conexão Telecom +R$ 2,00",
      "Expansão +R$ 130 por licenciado direto",
    ],
  },
  {
    ordem: 3,
    nome: "Executivo",
    meta: "150.000 kWh",
    bonus: "R$ 5.000/mês",
    extra: "Viagem de cruzeiro",
    acrescimos: [
      "Conexão Green +0,8%",
      "Conexão Livre +0,4%",
      "Conexão Placas +0,8%",
      "Conexão Club +8%",
      "Conexão Club PJ +5,3%",
      "Conexão Telecom +R$ 3,00",
      "Expansão +R$ 190 por licenciado direto",
    ],
  },
  {
    ordem: 4,
    nome: "Diretor",
    meta: "500.000 kWh",
    bonus: "R$ 25.000/mês",
    extra: "Viagem internacional",
    acrescimos: [
      "Conexão Green +1,4%",
      "Conexão Livre +0,6%",
      "Conexão Placas +1,2%",
      "Conexão Club +12%",
      "Conexão Club PJ +8%",
      "Conexão Telecom +R$ 5,00",
      "Expansão +R$ 250 por licenciado direto",
    ],
  },
  {
    ordem: 5,
    nome: "Acionista",
    meta: "1.000.000 kWh",
    bonus: "R$ 50.000/mês",
    extra: "Viagem internacional",
    acrescimos: [
      "Conexão Green +1,8%",
      "Conexão Livre +0,75%",
      "Conexão Placas +1,5%",
      "Conexão Club +15%",
      "Conexão Club PJ +10%",
      "Conexão Telecom +R$ 6,00",
      "Expansão +R$ 300 por licenciado direto",
    ],
  },
];

/* ══════════════════════════════════════════════════════════════
   Os 9 produtos que o licenciado passa a vender
   ══════════════════════════════════════════════════════════════ */

export const PRODUTOS_PARA_VENDER = [
  {
    nome: "Conexão Green",
    resumo: "Desconto na conta de luz sem instalar placas. O produto de entrada mais fácil de explicar.",
    comissao: "Comissão recorrente sobre o consumo do cliente",
  },
  {
    nome: "Conexão Solar",
    resumo: "Energia de fazendas solares por assinatura, para casas e empresas.",
    comissao: "Comissão recorrente",
  },
  {
    nome: "Conexão Livre",
    resumo: "Mercado Livre de Energia para empresas e grandes consumidores.",
    comissao: "Comissão recorrente sobre contratos maiores",
  },
  {
    nome: "Conexão Placas",
    resumo: "Sistema fotovoltaico instalado no imóvel do cliente.",
    comissao: "Royalties sobre o projeto",
  },
  {
    nome: "Conexão Telecom",
    resumo: "Planos de celular 5G a partir de R$ 39,90, sem fidelidade.",
    comissao: "Valor fixo por linha e por ativação de chip",
  },
  {
    nome: "Conexão Seguros",
    resumo: "Proteção veicular a partir de R$ 99/mês, sem análise de perfil.",
    comissao: "Comissão por apólice",
  },
  {
    nome: "Conexão Club",
    resumo: "Clube de descontos em mais de 30 mil lojas no Brasil.",
    comissao: "Percentual que cresce com o nível de carreira",
  },
  {
    nome: "Conexão Club PJ",
    resumo: "O mesmo clube em formato de benefício corporativo para empresas.",
    comissao: "Percentual que cresce com o nível de carreira",
  },
  {
    nome: "Conexão Expansão",
    resumo: "Formação da sua própria equipe de licenciados.",
    comissao: "Bônus por licenciado e percentual sobre a equipe",
  },
] as const;

/* ══════════════════════════════════════════════════════════════
   Mecânica da Expansão (equipe)
   ══════════════════════════════════════════════════════════════ */

export const MECANICA_EQUIPE = {
  primeiroNivel: [
    "R$ 300,00 de bônus por licenciado direto que você cadastrar",
    "Percentual de comissão sobre o trabalho que esse licenciado desenvolver",
    "30% de todo o kWh que ele acumular conta para a sua própria progressão de carreira",
  ],
  segundoNivel: [
    "R$ 100,00 de bônus quando o seu licenciado direto cadastra outro licenciado",
    "Percentual de comissão sobre o trabalho desse licenciado",
    "A mecânica segue até o 5º nível da sua estrutura",
  ],
  qualificacao: [
    "S-Expansão: 2 licenciados diretos ativos",
    "G-Expansão: 5 licenciados diretos ativos, sendo 2 S-Expansão",
    "E-Expansão: 7 licenciados diretos ativos, sendo 2 G-Expansão",
    "D-Expansão: 10 licenciados diretos ativos, sendo 2 G-Expansão e 2 E-Expansão",
  ],
} as const;

/* ══════════════════════════════════════════════════════════════
   O que a licença inclui (LicLicenseSection)
   ══════════════════════════════════════════════════════════════ */

export const LICENCA_INCLUI = [
  {
    t: "Kit de material físico",
    b: "Crachá, folders iGreen Energy e iGreen Telecom, adesivos de casa, empresa e condomínio sustentável, além de chips físicos e digitais.",
    icone: "store",
  },
  {
    t: "Aplicativo iGreen completo",
    b: "Acesso a todas as funções: registrar conexões, acompanhar status dos cadastros e gerir a sua carteira.",
    icone: "smartphone",
  },
  {
    t: "iGreen Academy",
    b: "Treinamentos online. Você não precisa saber vender energia antes de começar — o método é ensinado.",
    icone: "users",
  },
  {
    t: "Suporte para você e para o cliente",
    b: "Atendimento personalizado tanto para licenciados quanto para os clientes que você cadastrar.",
    icone: "message",
  },
  {
    t: "Material de apoio",
    b: "Conteúdo impresso e digital para apresentar os produtos sem ter que criar nada do zero.",
    icone: "clock",
  },
  {
    t: "iGreen Club",
    b: "Benefícios com descontos em mais de 30 mil estabelecimentos em todo o Brasil.",
    icone: "percent",
  },
] as const;

/* ══════════════════════════════════════════════════════════════
   Perfil, passos, objeções
   ══════════════════════════════════════════════════════════════ */

export const PARA_QUEM = [
  {
    t: "Quem já vende alguma coisa",
    b: "Corretor, consultor, representante. Você adiciona 9 produtos à sua carteira sem trocar de profissão.",
  },
  {
    t: "Quem tem rede e não monetiza",
    b: "Condomínio, comércio local, igreja, grupo de bairro. Todo mundo dessa rede paga conta de luz.",
  },
  {
    t: "Quem quer renda recorrente",
    b: "A comissão da energia é sobre o consumo do cliente. O cliente cadastrado uma vez continua consumindo.",
  },
  {
    t: "Quem quer começar em paralelo",
    b: "Não exige dedicação exclusiva. Dá para começar atendendo pelo celular no tempo que você tem.",
  },
] as const;

export const PASSOS_EXPANSAO = [
  {
    n: "01",
    t: "Converse com quem já é licenciado",
    b: "O consultor desta página explica o modelo, os produtos e como funciona a remuneração. Sem compromisso.",
    meta: "Conversa no WhatsApp",
  },
  {
    n: "02",
    t: "Ative sua licença e receba o kit",
    b: "Você recebe o material, o acesso ao aplicativo iGreen e o acesso aos treinamentos do iGreen Academy.",
    meta: "Estrutura pronta",
  },
  {
    n: "03",
    t: "Comece pelos produtos mais simples",
    b: "A Conexão Green é a porta de entrada: desconto na conta de luz, sem custo para o cliente. Os outros produtos entram depois.",
    meta: "Do fácil para o complexo",
  },
  {
    n: "04",
    t: "Cresça na carreira e, se quiser, forme equipe",
    b: "O kWh acumulado destrava níveis com percentuais maiores. Formar equipe é opcional e acelera a progressão.",
    meta: "No seu ritmo",
  },
] as const;

export const OBJECOES_EXPANSAO = [
  {
    q: "Preciso entender de energia?",
    a: "Não. O iGreen Academy tem os treinamentos online e existe material de apoio impresso e digital para você apresentar os produtos.",
  },
  {
    q: "Quanto custa a licença?",
    a: "O valor e as condições de ativação são informados pelo consultor, porque podem variar conforme a campanha vigente. Nesta página não divulgamos preço para não passar informação desatualizada.",
  },
  {
    q: "Preciso largar meu trabalho?",
    a: "Não. O modelo não exige dedicação exclusiva. Muitos licenciados começam em paralelo, atendendo pelo celular.",
  },
  {
    q: "Preciso formar equipe para ganhar?",
    a: "Não. A Expansão é uma das nove frentes, não a única. Você pode operar só com venda direta e progredir na carreira pelo kWh que acumular.",
  },
  {
    q: "Como funciona a comissão da energia?",
    a: "É recorrente: calculada sobre o consumo do cliente que você cadastrou, enquanto ele permanecer cliente. O percentual aumenta conforme o seu nível de carreira.",
  },
  {
    q: "O que acontece depois que eu ativo?",
    a: "Você recebe o kit, o acesso ao app e aos treinamentos, e passa a contar com suporte personalizado para você e para os seus clientes.",
  },
  {
    q: "Existe garantia de ganho?",
    a: "Não. Os valores do plano de carreira são bônus de qualificação atrelados a metas de kWh acumulado. O resultado depende do seu trabalho, e nenhum número aqui é promessa de renda.",
  },
  {
    q: "Em quais estados posso atuar?",
    a: "A iGreen atende 27 estados. O consultor confirma a cobertura e as particularidades da sua região.",
  },
] as const;

/** Aviso legal — obrigatório numa página de oportunidade de negócio. */
export const LEGAL_EXPANSAO =
  "Os valores de bônus e os percentuais apresentados são os do plano de carreira vigente da iGreen Energy e estão atrelados a metas de kWh acumulado e a critérios de qualificação. Não constituem promessa, garantia ou projeção de renda: o resultado de cada licenciado depende do seu próprio trabalho, da sua região e do mercado. Condições, valores e regras podem ser alterados pela iGreen. Confirme tudo com o consultor antes de decidir.";

/** Vídeo institucional da página original (Supabase Storage). */
export const VIDEO_EXPANSAO =
  "https://zlzasfhcxcznaprrragl.supabase.co/storage/v1/object/public/video%20igreen/imagine-licenciado.mp4";

/** Imagens reais usadas pela página original. */
export const IMAGENS_EXPANSAO = {
  qualificacoes: "/images/qualificacoes-igreen.png",
  kit: "/images/kit-licenciado-igreen.png",
  expansao: "/images/conexao-expansao.webp",
} as const;

export const ANCORAS_EXPANSAO = [
  { label: "Produtos", href: "#produtos" },
  { label: "Carreira", href: "#carreira" },
  { label: "A licença", href: "#licenca" },
  { label: "Dúvidas", href: "#objecoes" },
];
