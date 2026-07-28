/**
 * Conteúdo da LP premium do Conexão Green.
 *
 * REGRA: só entram aqui fatos que já existem no projeto (componentes da LP
 * atual). Nada de número inventado, depoimento fictício ou escassez falsa.
 * Se um dado não existe, a estrutura visual fica pronta mas o texto é neutro.
 *
 * Fontes dentro do repo:
 * - AboutSection / TestimonialsSection: fundada 2021 em Uberlândia (MG),
 *   selo RA1000 do Reclame Aqui.
 * - HeroSection: 27 estados.
 * - Volume de clientes e fazendas solares: números informados pela operação
 *   (ver PROVA_SOCIAL abaixo). Os componentes originais têm valores antigos
 *   (600 mil no hero, 170 mil no About) e não são alterados por esta pasta.
 * - HowItWorksSection: Lei Federal 14.300 de 06/01/2022, energia solar mais
 *   barata que a hidrelétrica, sem obras / sem alteração na instalação.
 * - AdvantagesSection: até 20% de desconto, cashback até 2%, 60 mil lojas.
 * - ClubSection: 600 mil produtos e 60 mil lojas parceiras.
 * - ReferralSection: mecânica do Cashback Sustentável (até 2% por indicação).
 */

/** Percentual máximo de desconto divulgado pela iGreen. Usado no simulador. */
export const DESCONTO_MAX_PCT = 20;

/** Percentual máximo de cashback por indicação. */
export const CASHBACK_MAX_PCT = 2;

export const TRUST_ITEMS = [
  { label: "Selo RA1000", detail: "Reclame Aqui" },
  { label: "27 estados", detail: "cobertura nacional" },
  { label: "Lei 14.300/2022", detail: "atividade regulamentada" },
  { label: "Sem fidelidade", detail: "cancele quando quiser" },
] as const;

/**
 * Prova social oficial — fonte única para TODAS as páginas premium.
 *
 * Centralizado de propósito: antes o número de clientes aparecia com valores
 * diferentes em cada componente (600 mil no hero, 170 mil no "quem somos").
 * Aqui existe um lugar só para atualizar.
 *
 * Valores confirmados pela operação em julho de 2026.
 */
export const PROVA_SOCIAL = {
  clientes: { valor: 700, sufixo: " mil+", rotulo: "clientes ativos" },
  fazendas: { valor: 500, sufixo: "+", rotulo: "fazendas solares" },
  estados: { valor: 27, sufixo: "", rotulo: "estados atendidos" },
} as const;

/** Texto corrido reaproveitado em parágrafos e FAQ. */
export const PROVA_SOCIAL_TEXTO = {
  clientes: "mais de 700 mil clientes ativos",
  fazendas: "mais de 500 fazendas solares",
  estados: "27 estados",
} as const;

export const HERO_STATS = [
  {
    value: PROVA_SOCIAL.clientes.valor,
    suffix: PROVA_SOCIAL.clientes.sufixo,
    label: PROVA_SOCIAL.clientes.rotulo,
  },
  {
    value: PROVA_SOCIAL.fazendas.valor,
    suffix: PROVA_SOCIAL.fazendas.sufixo,
    label: PROVA_SOCIAL.fazendas.rotulo,
  },
  {
    value: PROVA_SOCIAL.estados.valor,
    suffix: PROVA_SOCIAL.estados.sufixo,
    label: PROVA_SOCIAL.estados.rotulo,
  },
] as const;

/** Seção de identificação com o problema. Nada de drama artificial. */
export const PROBLEMS = [
  {
    icon: "trending-up",
    title: "Você paga pela energia mais cara da rede",
    body: "A energia que chega na sua casa normalmente vem de hidrelétrica, que custa mais do que a solar. Você paga a tarifa cheia mesmo existindo uma opção mais barata e regulamentada.",
  },
  {
    icon: "hourglass",
    title: "Cada mês que passa é desconto perdido",
    body: "O desconto não é retroativo. O boleto que já venceu não volta. Quanto mais tempo sem migrar, mais dinheiro fica na distribuidora em vez de ficar com você.",
  },
  {
    icon: "wallet",
    title: "Instalar placas exige investimento e obra",
    body: "Comprar um sistema próprio significa dinheiro na frente, telhado ocupado, manutenção e tempo de retorno. Boa parte das famílias e dos comércios simplesmente não tem esse caixa.",
  },
  {
    icon: "file-question",
    title: "Ninguém quer trocar economia por burocracia",
    body: "Contrato longo, multa por saída, taxa de adesão, técnico na sua casa. Se a economia vem com dor de cabeça, a maioria desiste antes de começar.",
  },
] as const;

/** O que é, para quem serve, como funciona. */
export const SOLUTION_POINTS = [
  {
    title: "O que é",
    body: "Energia solar por assinatura. Nossas fazendas solares injetam energia limpa na rede da distribuidora e você recebe o desconto direto no seu boleto — sem comprar equipamento nenhum.",
  },
  {
    title: "Para quem serve",
    body: "Casas, apartamentos, prédios, condomínios, fazendas, comércios e empresas. Se você recebe conta de luz, dá para avaliar.",
  },
  {
    title: "O que não muda",
    body: "A distribuidora continua a mesma, a fiação continua a mesma, a energia chega do mesmo jeito. Não tem obra, não tem placa no telhado, não tem técnico mexendo na sua instalação.",
  },
  {
    title: "O que muda",
    body: `Você passa a consumir energia solar mais barata e recebe até ${DESCONTO_MAX_PCT}% de desconto todos os meses, sem pagar nada por isso.`,
  },
] as const;

export const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Fale no WhatsApp e envie sua conta de luz",
    body: "Uma foto da fatura já é suficiente para conferir se o seu endereço tem cobertura e qual o desconto disponível.",
    meta: "Leva menos de 2 minutos",
  },
  {
    step: "02",
    title: "Faça o cadastro 100% online",
    body: "Sem papel, sem cartório, sem visita técnica. Você assina digitalmente e pronto — sem taxa de adesão e sem mensalidade.",
    meta: "Tudo pelo celular",
  },
  {
    step: "03",
    title: "Receba o desconto no boleto",
    body: `A partir da migração, o desconto de até ${DESCONTO_MAX_PCT}% aparece no seu boleto iGreen todos os meses. Sem fidelidade: se quiser sair, sai.`,
    meta: "Todo mês, automático",
  },
] as const;

/** Funcionalidade → benefício concreto (o "por que isso importa"). */
export const BENEFITS = [
  {
    icon: "percent",
    title: `Até ${DESCONTO_MAX_PCT}% de desconto todo mês`,
    body: "Recorrente, não é promoção de primeiro mês. O valor volta para o seu orçamento todos os meses, sem você fazer nada depois do cadastro.",
  },
  {
    icon: "repeat",
    title: `Cashback Sustentável de até ${CASHBACK_MAX_PCT}%`,
    body: "Cada cliente aprovado que você indica gera cashback mensal abatido no seu próprio boleto. Com indicações suficientes, é possível zerar sua conta.",
  },
  {
    icon: "store",
    title: "iGreen Club liberado, sem custo",
    body: "Descontos em mais de 600 mil produtos e serviços em 60 mil lojas parceiras no Brasil. Farmácia, supermercado, moda, pet, óculos, cinema.",
  },
  {
    icon: "zap-off",
    title: "Zero investimento em equipamento",
    body: "Você não compra placa, não financia nada, não usa o telhado. O ativo é nosso; o desconto é seu.",
  },
  {
    icon: "unlock",
    title: "Sem fidelidade e sem multa",
    body: "Contrato sem prisão. Isso muda a conversa: o risco de experimentar é praticamente zero.",
  },
  {
    icon: "smartphone",
    title: "Adesão 100% digital",
    body: "Do primeiro contato ao contrato assinado, tudo pelo celular. Sem fila, sem loja física, sem esperar técnico.",
  },
  {
    icon: "shield-check",
    title: "Atividade regulamentada",
    body: "A migração é amparada pela Lei Federal 14.300, de 6 de janeiro de 2022, que permite ao consumidor escolher a fonte da energia que consome.",
  },
  {
    icon: "award",
    title: "Selo RA1000 no Reclame Aqui",
    body: "O nível mais alto de reputação de atendimento da plataforma. Você tem para onde recorrer, e isso está público.",
  },
  {
    icon: "leaf",
    title: "Energia limpa de verdade",
    body: "Sua casa ou empresa passa a ser abastecida por geração solar. Economia e impacto ambiental na mesma decisão.",
  },
] as const;

/** Comparação honesta: continuar como está × Conexão Green. */
export const COMPARISON = {
  before: {
    title: "Continuando como está",
    items: [
      "Tarifa cheia da distribuidora todo mês",
      "Nenhuma escolha sobre a fonte da energia",
      "Zero cashback sobre indicações",
      "Sem clube de benefícios",
      "Economia depende de comprar placas",
    ],
  },
  after: {
    title: "Com o Conexão Green",
    items: [
      `Até ${DESCONTO_MAX_PCT}% de desconto no boleto, todo mês`,
      "Energia solar, mais barata e renovável",
      `Até ${CASHBACK_MAX_PCT}% de cashback por indicação aprovada`,
      "iGreen Club incluído, sem custo",
      "Nenhum investimento em equipamento",
    ],
  },
} as const;

/** Quebra de objeções — respostas só com o que é verdade no projeto. */
export const OBJECTIONS = [
  {
    q: "Preciso instalar placas solares?",
    a: "Não. A geração acontece nas nossas fazendas solares e a energia é injetada na rede da distribuidora. Seu telhado e sua instalação não são tocados.",
  },
  {
    q: "Vai ter obra ou técnico na minha casa?",
    a: "Não. Nada muda na sua instalação elétrica. A troca é contratual, não física.",
  },
  {
    q: "Tem taxa de adesão ou mensalidade?",
    a: "Não. O cadastro é gratuito e não existe mensalidade pelo serviço. Você continua pagando energia — só passa a pagar menos.",
  },
  {
    q: "Fico preso em contrato?",
    a: "Não. Não há fidelidade. Se quiser cancelar, você cancela.",
  },
  {
    q: "Isso é permitido?",
    a: "Sim. A Lei Federal 14.300, de 6 de janeiro de 2022, garante ao consumidor o direito de escolher entre a energia hidrelétrica e a energia solar renovável.",
  },
  {
    q: "Serve para comércio e empresa?",
    a: "Sim. Atendemos casas, apartamentos, prédios, condomínios, fazendas, comércios e empresas.",
  },
  {
    q: "Quanto tempo leva para começar?",
    a: "O cadastro é feito no mesmo dia, online. O desconto passa a valer a partir da migração do seu ponto de consumo.",
  },
  {
    q: "Falo com quem depois do cadastro?",
    a: "Com o consultor desta página. Ele acompanha seu cadastro e continua disponível no WhatsApp depois da adesão.",
  },
] as const;

/** FAQ — perguntas que reduzem risco na hora de decidir. */
export const FAQ = [
  {
    q: "Como vocês conseguem dar desconto na conta de luz?",
    a: "A energia solar que produzimos custa menos do que a energia hidrelétrica normalmente comprada pelas distribuidoras. Repassamos parte dessa diferença para você em forma de desconto, de até 20% por mês.",
  },
  {
    q: "Minha energia pode faltar depois de migrar?",
    a: "A entrega física da energia continua sendo feita pela mesma distribuidora, pela mesma rede. Em caso de falta de luz na região, o atendimento segue sendo o da distribuidora, como sempre foi.",
  },
  {
    q: "O desconto é sobre o valor total da conta?",
    a: "O desconto incide sobre a parte de energia da sua fatura, que é a maior fatia do valor. Encargos e tributos cobrados pela distribuidora seguem as regras dela. O consultor mostra o cálculo exato a partir da sua conta.",
  },
  {
    q: "Preciso pagar duas contas?",
    a: "Você passa a receber o boleto da iGreen referente à energia solar consumida, no lugar de pagar aquela parte para a distribuidora. O consultor explica o formato aplicado ao seu caso ao analisar sua fatura.",
  },
  {
    q: "Como funciona o cashback por indicação?",
    a: "Ao indicar um cliente que seja aprovado, você recebe até 2% de cashback calculado sobre o boleto iGreen desse cliente, abatido automaticamente no seu próximo boleto. Com várias indicações, é possível zerar sua conta.",
  },
  {
    q: "Meus dados ficam seguros?",
    a: "Os dados enviados são usados para análise de viabilidade e para o seu cadastro na iGreen Energy. Você pode consultar a Política de Privacidade da plataforma a qualquer momento.",
  },
  {
    q: "A iGreen Energy é uma empresa nova?",
    a: `A iGreen Energy foi fundada em 2021, em Uberlândia (MG), e hoje tem ${PROVA_SOCIAL_TEXTO.clientes}, ${PROVA_SOCIAL_TEXTO.fazendas} e presença em ${PROVA_SOCIAL_TEXTO.estados}.`,
  },
  {
    q: "E se eu mudar de endereço?",
    a: "Fale com o seu consultor antes da mudança. Ele verifica a cobertura no novo endereço e orienta o próximo passo. Como não há fidelidade, você não fica preso a nada.",
  },
] as const;

/** Depoimentos em vídeo já existentes em /public/videos. */
export const TESTIMONIAL_VIDEOS = [
  "/videos/depoimento-1.mp4",
  "/videos/depoimento-2.mp4",
  "/videos/depoimento-3.mp4",
  "/videos/depoimento-4.mp4",
  "/videos/depoimento-5.mp4",
] as const;

export function posterFor(videoSrc: string): string {
  return videoSrc.replace("/videos/", "/videos/posters/").replace(/\.mp4$/, ".webp");
}

/** Vídeos institucionais hospedados no Storage (carregam só sob demanda). */
export const STORAGE_VIDEOS = {
  casaSustentavel:
    "https://zlzasfhcxcznaprrragl.supabase.co/storage/v1/object/public/video%20igreen/casasustentavel.mp4",
  cashback:
    "https://zlzasfhcxcznaprrragl.supabase.co/storage/v1/object/public/video%20igreen/cash-back-igreen.mp4",
  club: "https://zlzasfhcxcznaprrragl.supabase.co/storage/v1/object/public/video%20igreen/club-de-beneficios.mp4",
} as const;

/** Âncoras da navegação interna. */
export const NAV_ANCHORS = [
  { label: "Como funciona", href: "#como-funciona" },
  { label: "Simular", href: "#simulador" },
  { label: "Benefícios", href: "#beneficios" },
  { label: "Dúvidas", href: "#faq" },
] as const;
