/**
 * Configuração dos 7 produtos "Conexão" da iGreen.
 * Cada consultor terá sua versão da landing page via slug dinâmico.
 */

export interface ConexaoProduct {
  slug: string;
  name: string;
  brandName: string;
  heroTitle: string;
  heroSubtitle: string;
  heroVideoId: string;
  heroAutoplay: boolean;
  gradient: string;
  whatsappMessage: string;
  ctaLabel: string;
  sections: ConexaoSection[];
}

export interface ConexaoSection {
  type: "about" | "video" | "plans" | "benefits" | "gallery" | "faq" | "advantages";
  title: string;
  subtitle?: string;
  videoId?: string;
  items?: string[];
  images?: string[];
  faq?: { question: string; answer: string }[];
}

export const conexaoProducts: ConexaoProduct[] = [
  // ─────────────────────────────────────────────
  // 1. CONEXÃO TELECOM
  // ─────────────────────────────────────────────
  {
    slug: "conexao-telecom",
    name: "Conexão Telecom",
    brandName: "iGreen Telecom",
    heroTitle: "DESCUBRA COMO UTILIZAR A INTERNET MAIS RÁPIDA DO BRASIL COM A MAIOR COBERTURA NACIONAL",
    heroSubtitle: "Conheça agora a oportunidade da iGreen Telecom e como você pode ter acesso à conexão 5G de maior velocidade do Brasil com os melhores preços do mercado",
    heroVideoId: "073a2de8-4096-4096-b499-5b0fb1e0de3e",
    heroAutoplay: true,
    gradient: "linear-gradient(rgb(14, 128, 40) 0%, rgb(8, 28, 3) 100%)",
    ctaLabel: "QUERO ATIVAR AGORA",
    whatsappMessage: "Olá, gostaria de mais informações sobre os planos de internet oferecidos pela iGreen Telecom",
    sections: [
      {
        type: "about",
        title: "Somos a iGreen Telecom",
        subtitle: "A operadora de internet móvel que combina tecnologia de ponta com sustentabilidade",
        items: [
          "📶 Operadora 100% digital com a maior cobertura 5G do Brasil",
          "💰 Planos a partir de R$ 39,90 com internet de alta velocidade",
          "🌱 Cada plano gera cashback sustentável para o meio ambiente",
          "📱 Gestão completa do seu plano pelo aplicativo iGreen",
          "🔄 Sem fidelidade — cancele quando quiser sem multa",
          "🎁 Acesso gratuito ao iGreen Club com + de 30 mil descontos",
          "🤝 Suporte humanizado via WhatsApp 24 horas por dia",
        ],
      },
      {
        type: "video",
        title: "Conheça os Benefícios",
        subtitle: "Veja por que milhares de pessoas já escolheram a iGreen Telecom",
        videoId: "b65f52d4-e4f7-48c3-9c53-bdcb3b5c291a",
      },
      {
        type: "gallery",
        title: "Conheça Nossos Planos",
        subtitle: "Veja os planos disponíveis e escolha o ideal para você",
        images: [
          "screenshot-20250106-120022-708.webp",
          "screenshot-20250106-134730-377.webp",
          "screenshot-20250106-134810-820.webp",
          "screenshot-20250106-134842-846.webp",
          "screenshot-20250106-134920-090.webp",
          "screenshot-20250106-140026-291.webp",
        ],
      },
      {
        type: "benefits",
        title: "Cashback Sustentável",
        subtitle: "Cada plano gera retorno para você e para o planeta",
        items: [
          "🌍 Parte do valor do plano é investido em projetos de energia limpa",
          "💵 Cashback direto na sua conta todo mês",
          "🌳 Plantio de árvores a cada ativação de plano",
          "♻️ Compensação de carbono inclusa em todos os planos",
          "📊 Acompanhe seu impacto sustentável pelo app",
          "🏆 Programa de fidelidade com recompensas verdes",
        ],
      },
      {
        type: "video",
        title: "iGreen Club — Seu Clube de Descontos",
        subtitle: "Economize em mais de 30 mil lojas parceiras em todo o Brasil",
        videoId: "5a250f12-19a2-4d1c-a1ab-f35f563963dd",
      },
      {
        type: "video",
        title: "Como Funciona o iGreen Club",
        videoId: "9696eaf6-bdea-473f-9e9d-2d868b16b042",
      },
      {
        type: "advantages",
        title: "Vantagens Exclusivas",
        subtitle: "Tudo o que você ganha ao ser cliente iGreen Telecom",
        items: [
          "📋 Planos flexíveis para cada necessidade",
          "⚡ 5G ultra veloz com cobertura nacional",
          "💬 WhatsApp ilimitado em todos os planos",
          "📞 Ligações ilimitadas para qualquer operadora",
          "📦 Internet acumulada — o que não usar, leva pro próximo mês",
          "🎁 iGreen Club grátis com descontos em 30 mil lojas",
          "🏷️ Descontos exclusivos em mais de 30 mil lojas",
          "🔓 Sem fidelidade — liberdade total",
          "📱 100% digital — ative pelo app em minutos",
          "🤝 Suporte via WhatsApp 24h por dia",
        ],
      },
      {
        type: "faq",
        title: "Perguntas Frequentes",
        subtitle: "Tire suas dúvidas sobre a iGreen Telecom",
        faq: [
          {
            question: "Como adquirir um plano iGreen Telecom?",
            answer: "Basta entrar em contato pelo WhatsApp do consultor ou baixar o aplicativo iGreen Telecom e escolher o plano ideal para você. A ativação é 100% digital.",
          },
          {
            question: "Existe fidelidade nos planos?",
            answer: "Não! Todos os planos são sem fidelidade. Você pode cancelar a qualquer momento sem multa.",
          },
          {
            question: "Há diferença entre os planos para clientes PJ e PF?",
            answer: "Os planos são os mesmos para pessoa física e jurídica. A diferença está na forma de faturamento e nota fiscal.",
          },
          {
            question: "O cliente iGreen Telecom tem direito aos benefícios do iGreen Club?",
            answer: "Sim! Todo cliente iGreen Telecom recebe acesso gratuito ao iGreen Club com descontos em mais de 30 mil estabelecimentos.",
          },
          {
            question: "Existe diferença entre os planos com portabilidade e sem portabilidade?",
            answer: "Os benefícios são os mesmos. A portabilidade permite manter seu número atual ao migrar para a iGreen Telecom.",
          },
          {
            question: "Como falar no suporte ao cliente?",
            answer: "Nosso suporte funciona 24h pelo WhatsApp. Basta enviar uma mensagem e nossa equipe responde rapidamente.",
          },
          {
            question: "Qual aplicativo baixar para gerenciar o plano?",
            answer: "Baixe o app 'iGreen Telecom' disponível na Google Play Store e Apple App Store para gerenciar seu plano.",
          },
          {
            question: "O cliente pode ativar o pagamento automático e recorrente no cartão de crédito?",
            answer: "Sim! Você pode configurar o pagamento automático pelo aplicativo e nunca se preocupar com vencimento.",
          },
          {
            question: "O cliente pode cancelar a qualquer momento com a iGreen Telecom?",
            answer: "Sim, sem fidelidade e sem multa. O cancelamento pode ser feito pelo app ou pelo suporte via WhatsApp.",
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // 2. CONEXÃO SEGUROS
  // ─────────────────────────────────────────────
  {
    slug: "conexao-seguros",
    name: "Conexão Seguros",
    brandName: "iGreen Seguros",
    heroTitle: "DESCUBRA COMO PROTEGER SEU VEÍCULO COM PLANOS DE SEGUROS ACESSÍVEIS, COMPLETOS E MODERNOS",
    heroSubtitle: "Conheça agora a oportunidade da iGreen Seguros e como você pode proteger seu carro com os planos mais completos do mercado",
    heroVideoId: "d812a2d3-6e3c-4eb7-b2f3-2778df2c1f1b",
    heroAutoplay: true,
    gradient: "linear-gradient(rgb(14, 128, 40) 0%, rgb(8, 28, 3) 100%)",
    ctaLabel: "QUERO CONTRATAR AGORA",
    whatsappMessage: "Olá, gostaria de mais informações sobre os planos de seguros oferecidos pela iGreen Seguros",
    sections: [
      {
        type: "about",
        title: "Somos a iGreen Seguros",
        subtitle: "Proteção veicular completa com tecnologia e preço justo",
        items: [
          "🚗 Planos de proteção veicular a partir de R$ 99/mês",
          "🛡️ Cobertura completa contra roubo, furto e colisão",
          "🚑 Assistência 24h em todo o território nacional",
          "📱 Gestão da apólice 100% digital pelo aplicativo",
          "💰 Preços até 60% mais acessíveis que seguradoras tradicionais",
          "🔧 Rede credenciada com mais de 5.000 oficinas parceiras",
          "🌱 Parte do valor é investido em sustentabilidade",
          "🤝 Sem burocracia — ativação rápida e sem análise de perfil",
        ],
      },
      {
        type: "plans",
        title: "Nossos Planos",
        subtitle: "Escolha a proteção ideal para o seu veículo",
        items: [
          "🥉 Basic — Cobertura contra roubo e furto, assistência 24h, guincho até 200km, carro reserva por 7 dias",
          "🥇 Premium — Tudo do Basic + cobertura contra colisão, incêndio, vidros e retrovisores, guincho ilimitado",
          "💎 Infinite — Tudo do Premium + cobertura para terceiros, proteção de acessórios, carro reserva por 30 dias, desconto em estacionamentos",
        ],
      },
      {
        type: "gallery",
        title: "Conheça os Planos e Coberturas",
        subtitle: "Veja em detalhes tudo o que cada plano oferece",
        images: [
          "COPIA-DE-4.webp",
          "COPIA-DE-5.webp",
          "COPIA-DE-6.webp",
          "COPIA-DE-7.webp",
          "COPIA-DE-8.webp",
          "COPIA-DE-9.webp",
        ],
      },
      {
        type: "video",
        title: "iGreen Club — Seu Clube de Descontos",
        subtitle: "Economize em mais de 30 mil lojas parceiras em todo o Brasil",
        videoId: "5a250f12-19a2-4d1c-a1ab-f35f563963dd",
      },
      {
        type: "video",
        title: "Como Funciona o iGreen Club",
        videoId: "9696eaf6-bdea-473f-9e9d-2d868b16b042",
      },
      {
        type: "advantages",
        title: "Vantagens Exclusivas",
        subtitle: "Por que escolher a iGreen Seguros",
        items: [
          "💰 Preços até 60% mais acessíveis",
          "🚗 Cobertura completa para qualquer veículo",
          "🚑 Assistência 24h em todo o Brasil",
          "📱 100% digital — sem papelada",
          "🔧 Rede com mais de 5.000 oficinas",
          "🚙 Carro reserva incluso nos planos",
          "🛡️ Sem análise de perfil para contratar",
          "🌱 Parte do investimento vai para o meio ambiente",
          "🎁 Acesso gratuito ao iGreen Club",
          "🤝 Atendimento humanizado pelo WhatsApp",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // 3. CONEXÃO SOLAR
  // ─────────────────────────────────────────────
  {
    slug: "conexao-solar",
    name: "Conexão Solar",
    brandName: "iGreen Energy",
    heroTitle: "DESCUBRA COMO RECEBER DESCONTOS NA SUA CONTA DE LUZ TODOS OS MESES COM PLACAS SOLARES",
    heroSubtitle: "Conheça agora a oportunidade da Conexão Solar da iGreen Energy e como você pode economizar na conta de luz sem investimento",
    heroVideoId: "e71c0378-9980-40f0-9110-6e41ea908a15",
    heroAutoplay: true,
    gradient: "linear-gradient(rgb(14, 128, 40) 0%, rgb(8, 28, 3) 100%)",
    ctaLabel: "QUERO ECONOMIZAR AGORA",
    whatsappMessage: "Olá, gostaria de mais informações sobre a Conexão Solar da iGreen Energy",
    sections: [
      {
        type: "about",
        title: "Somos a iGreen Energy",
        subtitle: "Energia solar por assinatura sem investimento em equipamentos",
        items: [
          "☀️ Desconto na conta de luz sem instalar placas na sua casa",
          "💡 Energia limpa gerada em fazendas solares compartilhadas",
          "💰 Economia imediata de até 20% na conta de energia",
          "📋 Sem investimento inicial — comece a economizar do dia 1",
          "🔄 Sem fidelidade — cancele quando quiser",
          "📱 Acompanhe sua economia pelo aplicativo",
          "🌱 100% sustentável e renovável",
          "🏠 Disponível para residências e empresas",
        ],
      },
      {
        type: "video",
        title: "Como Funciona",
        subtitle: "Entenda como você economiza na conta de luz com a Conexão Solar",
        videoId: "91f62204-aec7-4247-a46a-f1935580f477",
      },
      {
        type: "gallery",
        title: "Veja na Prática",
        subtitle: "Confira como a energia solar por assinatura funciona no seu dia a dia",
        images: [
          "IMAGEM-1.webp",
          "IMAGEM-2.webp",
          "imagem-2.webp",
          "imagem-5.webp",
          "feed-10.webp",
        ],
      },
      {
        type: "video",
        title: "iGreen Club — Seu Clube de Descontos",
        subtitle: "Economize em mais de 30 mil lojas parceiras",
        videoId: "5a250f12-19a2-4d1c-a1ab-f35f563963dd",
      },
      {
        type: "video",
        title: "Como Funciona o iGreen Club",
        videoId: "9696eaf6-bdea-473f-9e9d-2d868b16b042",
      },
      {
        type: "advantages",
        title: "Vantagens Exclusivas",
        subtitle: "Tudo o que você ganha com a Conexão Solar",
        items: [
          "☀️ Energia 100% solar e renovável",
          "💰 Economia de até 20% na conta de luz",
          "📋 Sem investimento em equipamentos",
          "🏠 Sem obras ou instalação na sua casa",
          "🔄 Sem fidelidade — liberdade total",
          "📱 Acompanhamento digital da economia",
          "🌱 Contribua com o meio ambiente",
          "🎁 Acesso gratuito ao iGreen Club",
          "🤝 Suporte dedicado via WhatsApp",
          "⚡ Ativação rápida em poucos dias",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // 4. CONEXÃO PLACAS
  // ─────────────────────────────────────────────
  {
    slug: "conexao-placas",
    name: "Conexão Placas",
    brandName: "iGreen Energy",
    heroTitle: "DESCUBRA COMO ECONOMIZAR ATÉ 95% NA SUA CONTA DE LUZ TODOS OS MESES ATRAVÉS DA ENERGIA SOLAR",
    heroSubtitle: "Conheça agora a oportunidade da iGreen Energy e como você pode economizar na conta de luz com placas solares",
    heroVideoId: "ad9ddfd6-3505-49ee-bbd1-2e44a2cb6d7c",
    heroAutoplay: true,
    gradient: "linear-gradient(rgb(14, 128, 40) 0%, rgb(8, 28, 3) 100%)",
    ctaLabel: "QUERO ECONOMIZAR AGORA",
    whatsappMessage: "Olá, gostaria de mais informações sobre energia solar com placas da iGreen Energy",
    sections: [
      {
        type: "about",
        title: "Somos a iGreen Energy",
        subtitle: "Soluções completas em energia solar fotovoltaica para sua casa ou empresa",
        items: [
          "☀️ Instalação de placas solares com até 95% de economia",
          "🏗️ Projeto personalizado para o seu consumo",
          "💰 Financiamento facilitado em até 120x",
          "🔧 Instalação profissional com garantia de 25 anos",
          "📊 Retorno do investimento em até 4 anos",
          "🏠 Para residências, comércios e indústrias",
          "🌱 Energia limpa e valorização do imóvel",
          "📱 Monitoramento em tempo real da geração",
        ],
      },
      {
        type: "video",
        title: "Motivos Para Instalar Energia Solar",
        subtitle: "Veja por que milhares de famílias já escolheram a energia solar",
        videoId: "30706e15-262f-451c-8350-4b3103f45197",
      },
      {
        type: "gallery",
        title: "Nossos Clientes",
        subtitle: "Veja os projetos realizados pela iGreen Energy",
        images: [
          "cliente-1.webp",
          "cliente-2.webp",
          "cliente-3.webp",
          "cliente-4.webp",
          "cliente-5.webp",
          "cliente-6.webp",
          "cliente-7.webp",
          "cliente-8.webp",
          "cliente-9.webp",
          "cliente-10.webp",
          "cliente-11.webp",
          "cliente-12.webp",
        ],
      },
      {
        type: "video",
        title: "iGreen Club — Seu Clube de Descontos",
        subtitle: "Economize em mais de 30 mil lojas parceiras",
        videoId: "5a250f12-19a2-4d1c-a1ab-f35f563963dd",
      },
      {
        type: "video",
        title: "Como Funciona o iGreen Club",
        videoId: "9696eaf6-bdea-473f-9e9d-2d868b16b042",
      },
      {
        type: "advantages",
        title: "Vantagens Exclusivas",
        subtitle: "Tudo o que você ganha com a iGreen Energy",
        items: [
          "☀️ Economia de até 95% na conta de luz",
          "🏗️ Projeto sob medida para seu imóvel",
          "💰 Financiamento em até 120x facilitado",
          "🔧 Garantia de 25 anos nos equipamentos",
          "📊 Retorno do investimento em até 4 anos",
          "🏠 Valorização do imóvel em até 8%",
          "🌱 Energia 100% limpa e renovável",
          "📱 Monitoramento em tempo real pelo app",
          "🎁 Acesso gratuito ao iGreen Club",
          "🤝 Suporte técnico especializado",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // 5. CONEXÃO LIVRE
  // ─────────────────────────────────────────────
  {
    slug: "conexao-livre",
    name: "Conexão Livre",
    brandName: "iGreen Energy",
    heroTitle: "DESCUBRA COMO RECEBER ATÉ 30% DE DESCONTO NA SUA CONTA DE LUZ TODOS OS MESES GRATUITAMENTE",
    heroSubtitle: "Conheça agora a oportunidade da iGreen Energy e como você pode economizar na conta de luz no Mercado Livre de Energia",
    heroVideoId: "9b67408c-8b26-4b3e-834b-c02908f21324",
    heroAutoplay: true,
    gradient: "linear-gradient(rgb(14, 128, 40) 0%, rgb(8, 28, 3) 100%)",
    ctaLabel: "QUERO ECONOMIZAR AGORA",
    whatsappMessage: "Olá, gostaria de mais informações sobre o Mercado Livre de Energia da iGreen",
    sections: [
      {
        type: "about",
        title: "Mercado Livre de Energia",
        subtitle: "Liberdade para escolher de quem comprar sua energia com até 30% de desconto",
        items: [
          "⚡ Desconto de até 30% na conta de luz todo mês",
          "🆓 Migração 100% gratuita — sem custos para você",
          "📋 Sem investimento e sem obras na sua propriedade",
          "🔄 Sem fidelidade — flexibilidade total",
          "🏭 Disponível para empresas e grandes consumidores",
          "🌱 Energia de fontes renováveis certificadas",
          "📊 Previsibilidade de custos com contratos transparentes",
          "🤝 Consultoria especializada durante todo o processo",
        ],
      },
      {
        type: "gallery",
        title: "Mercado Livre na Prática",
        subtitle: "Veja como funciona a migração e a economia no Mercado Livre de Energia",
        images: [
          "conexao-livre-1.webp",
          "conexao-livre-4.webp",
          "conexao-livre-5.webp",
          "conexao-livre-6.webp",
          "conexao-livre-7.webp",
          "conexao-livre-8.webp",
          "conexao-livre-9.webp",
        ],
      },
      {
        type: "gallery",
        title: "Nossa Aliança e Missão",
        subtitle: "Conheça a parceria iGreen e Comerc e nossa missão pela energia limpa",
        images: [
          "imagem-3-alianca-igreen-e-comerc.webp",
          "imagem-4-missao.webp",
          "imagem-7-gestao-da-energia-na-palma.webp",
        ],
      },
      {
        type: "video",
        title: "Como Funciona",
        subtitle: "Entenda o Mercado Livre de Energia de forma simples",
        videoId: "743b84c6-c1ca-440a-a605-20bae557e4ae",
      },
      {
        type: "video",
        title: "Aliança Estratégica",
        subtitle: "Conheça nossos parceiros que garantem sua economia",
        videoId: "025e9bea-6d25-49ac-881c-718c4920e49d",
      },
      {
        type: "video",
        title: "Usinas Fotovoltaicas",
        subtitle: "A estrutura que gera sua energia limpa",
        videoId: "38a9c9b1-600b-4f39-a872-3eb0f3f897e9",
      },
      {
        type: "video",
        title: "iGreen Club — Seu Clube de Descontos",
        subtitle: "Economize em mais de 30 mil lojas parceiras",
        videoId: "5a250f12-19a2-4d1c-a1ab-f35f563963dd",
      },
      {
        type: "video",
        title: "Como Funciona o iGreen Club",
        videoId: "9696eaf6-bdea-473f-9e9d-2d868b16b042",
      },
      {
        type: "advantages",
        title: "Vantagens Exclusivas",
        subtitle: "Tudo o que você ganha no Mercado Livre de Energia",
        items: [
          "⚡ Desconto de até 30% na conta de luz",
          "🆓 Migração 100% gratuita",
          "📋 Sem investimento inicial",
          "🏠 Sem obras ou instalações",
          "🔄 Sem fidelidade contratual",
          "🌱 Energia de fontes renováveis",
          "📊 Previsibilidade nos custos",
          "🎁 Acesso gratuito ao iGreen Club",
          "🤝 Consultoria dedicada",
          "📱 Gestão digital simplificada",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // 6. CONEXÃO CLUB
  // ─────────────────────────────────────────────
  {
    slug: "conexao-club",
    name: "Conexão Club",
    brandName: "iGreen Club",
    heroTitle: "DESCUBRA COMO ECONOMIZAR EM 30 MIL LOJAS DE TODO O BRASIL COM NOSSO CLUBE DE DESCONTOS",
    heroSubtitle: "Conheça agora a oportunidade do iGreen Club e como você pode ter acesso a descontos em mais de 600 mil produtos",
    heroVideoId: "7e8eaf73-2013-47a8-8ed6-2bbcf189326d",
    heroAutoplay: true,
    gradient: "linear-gradient(rgb(14, 128, 40) 0%, rgb(8, 28, 3) 100%)",
    ctaLabel: "QUERO APROVEITAR AGORA",
    whatsappMessage: "Olá, gostaria de mais informações sobre o iGreen Club",
    sections: [
      {
        type: "about",
        title: "Somos o iGreen Club",
        subtitle: "O maior clube de descontos sustentável do Brasil",
        items: [
          "🏪 Descontos em mais de 30 mil lojas parceiras",
          "🛍️ Mais de 600 mil produtos com preços exclusivos",
          "💳 Cashback em todas as compras realizadas",
          "📱 Aplicativo intuitivo e fácil de usar",
          "🎬 Descontos em cinemas, restaurantes e lazer",
          "💊 Economia em farmácias e drogarias",
          "👕 Ofertas em moda, eletrônicos e muito mais",
          "🌱 Parte do valor gera impacto ambiental positivo",
        ],
      },
      {
        type: "video",
        title: "Como Funciona",
        subtitle: "Veja como é fácil economizar com o iGreen Club",
        videoId: "5a250f12-19a2-4d1c-a1ab-f35f563963dd",
      },
      {
        type: "gallery",
        title: "Marcas Parceiras",
        subtitle: "Algumas das mais de 30 mil lojas com descontos exclusivos",
        images: [
          "/conexao/shared/club/imagem-3-cinemark.webp",
          "/conexao/shared/club/imagem-4-pague-menos.webp",
          "/conexao/shared/club/imagem-5-dominos-pizza.webp",
          "/conexao/shared/club/imagem-6-vivara.webp",
          "/conexao/shared/club/imagem-7-casas-bahia.webp",
          "/conexao/shared/club/imagem-8-burguer-king.webp",
          "/conexao/shared/club/imagem-9-drogasil.webp",
        ],
      },
      {
        type: "advantages",
        title: "Vantagens Exclusivas",
        subtitle: "Tudo o que você ganha com o iGreen Club",
        items: [
          "🏪 Descontos em mais de 30 mil lojas",
          "🛍️ Mais de 600 mil produtos com preço especial",
          "💳 Cashback em todas as compras",
          "🎬 Cinema, restaurantes e lazer com desconto",
          "💊 Economia em farmácias parceiras",
          "👕 Moda e eletrônicos com preço exclusivo",
          "📱 App fácil de usar no dia a dia",
          "🌱 Impacto ambiental positivo",
          "🔄 Novas ofertas todos os dias",
          "🤝 Suporte dedicado pelo WhatsApp",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // 7. CONEXÃO CLUB PJ
  // ─────────────────────────────────────────────
  {
    slug: "conexao-club-pj",
    name: "Conexão Club PJ",
    brandName: "iGreen Club Empresas",
    heroTitle: "DESCUBRA COMO SUA EMPRESA PODE SE DESTACAR NO MERCADO ADOTANDO O IGREEN CLUB PARA EMPRESAS",
    heroSubtitle: "Conheça agora a oportunidade do iGreen Club e como sua empresa pode oferecer benefícios exclusivos",
    heroVideoId: "7e8eaf73-2013-47a8-8ed6-2bbcf189326d",
    heroAutoplay: true,
    gradient: "linear-gradient(rgb(14, 128, 40) 0%, rgb(8, 28, 3) 100%)",
    ctaLabel: "QUERO SABER MAIS",
    whatsappMessage: "Olá, gostaria de mais informações sobre o iGreen Club para empresas",
    sections: [
      {
        type: "about",
        title: "Economia Sustentável para sua Empresa",
        subtitle: "Ofereça benefícios exclusivos para seus colaboradores e clientes com o iGreen Club Empresas",
        items: [
          "🏢 Benefício corporativo sem custo para a empresa",
          "👥 Engajamento dos colaboradores com economia real",
          "🏪 Acesso a descontos em mais de 30 mil lojas",
          "💰 Redução de custos operacionais com energia e telecom",
          "🌱 Posicione sua empresa como sustentável e inovadora",
          "📊 Relatórios de impacto e economia para o RH",
          "🎁 Programa de recompensas personalizável",
          "🤝 Consultoria dedicada para implantação",
        ],
      },
      {
        type: "video",
        title: "Como Funciona",
        subtitle: "Veja como o iGreen Club funciona para empresas",
        videoId: "5a250f12-19a2-4d1c-a1ab-f35f563963dd",
      },
      {
        type: "gallery",
        title: "Marcas Parceiras",
        subtitle: "Algumas das mais de 30 mil lojas com descontos exclusivos para sua empresa",
        images: [
          "/conexao/shared/club/imagem-3-cinemark.webp",
          "/conexao/shared/club/imagem-4-pague-menos.webp",
          "/conexao/shared/club/imagem-5-dominos-pizza.webp",
          "/conexao/shared/club/imagem-6-vivara.webp",
          "/conexao/shared/club/imagem-7-casas-bahia.webp",
          "/conexao/shared/club/imagem-8-burguer-king.webp",
          "/conexao/shared/club/imagem-9-drogasil.webp",
        ],
      },
      {
        type: "benefits",
        title: "Benefícios Para Sua Empresa",
        subtitle: "Vantagens reais que impactam o dia a dia corporativo",
        items: [
          "👥 Aumente a satisfação e retenção de talentos",
          "💰 Benefício sem custo — economia real para colaboradores",
          "🏷️ Descontos corporativos em produtos e serviços",
          "🌱 Selo de empresa sustentável e ESG",
          "📱 Plataforma white-label personalizável com sua marca",
          "📊 Dashboard de acompanhamento e métricas de uso",
        ],
      },
      {
        type: "advantages",
        title: "Vantagens Exclusivas",
        subtitle: "Por que escolher o iGreen Club para sua empresa",
        items: [
          "🏢 Sem custo de implantação para a empresa",
          "👥 Benefício real para todos os colaboradores",
          "🏪 Mais de 30 mil lojas parceiras",
          "💰 Economia comprovada no dia a dia",
          "🌱 Posicionamento ESG e sustentabilidade",
          "📊 Relatórios gerenciais completos",
          "📱 App intuitivo e fácil de usar",
          "🎁 Programa de recompensas customizável",
          "🤝 Suporte corporativo dedicado",
          "⚡ Ativação rápida para toda a equipe",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // 8. CONEXÃO GREEN (Cliente — desconto na conta de luz)
  // ─────────────────────────────────────────────
  {
    slug: "conexao-green",
    name: "Conexão Green",
    brandName: "iGreen Energy",
    heroTitle: "DESCUBRA COMO RECEBER ATÉ 20% DE DESCONTO NA SUA CONTA DE LUZ TODOS OS MESES DE FORMA GRATUITA",
    heroSubtitle: "Conheça a Conexão Green da iGreen Energy: energia solar por assinatura sem instalar placas, sem obras e sem custos. Cadastro 100% online e em minutos.",
    heroVideoId: "073a2de8-4096-4096-b499-5b0fb1e0de3e",
    heroAutoplay: true,
    gradient: "linear-gradient(rgb(14, 128, 40) 0%, rgb(8, 28, 3) 100%)",
    ctaLabel: "QUERO MEU DESCONTO",
    whatsappMessage: "Olá, gostaria de mais informações sobre o desconto na conta de luz oferecido pela iGreen Energy",
    sections: [
      {
        type: "about",
        title: "Somos a iGreen Energy",
        subtitle: "A maior empresa de energia solar por assinatura do Brasil, com mais de 600 mil clientes ativos",
        items: [
          "☀️ Nossas usinas produzem energia solar e a injetam na rede da distribuidora",
          "💡 A distribuidora entrega a energia na sua casa ou empresa",
          "💰 Você recebe até 20% de desconto na conta de luz todo mês",
          "🚫 Sem instalar placas solares, sem obras, sem taxa de adesão",
          "📋 Sem mensalidade, sem fidelidade — cancele quando quiser",
          "📱 Cadastro 100% online e gratuito em poucos minutos",
          "🏠 Atendemos casas, apartamentos, condomínios, comércios e empresas",
          "⚖️ Regulamentado pela Lei Federal 14.300 de Janeiro de 2022",
        ],
      },
      {
        type: "video",
        title: "Como Funciona",
        subtitle: "Entenda como sua economia funciona com a energia solar por assinatura",
        videoId: "b65f52d4-e4f7-48c3-9c53-bdcb3b5c291a",
      },
      {
        type: "benefits",
        title: "Cashback Sustentável",
        subtitle: "Indique amigos e pode até zerar sua conta de luz",
        items: [
          "🔄 Programa de indicações com cashback mensal recorrente",
          "💰 Até 2% de cashback por indicação aprovada",
          "📊 Cashback calculado com base no boleto pago pelo cliente indicado",
          "💡 Exemplo: indique um cliente com conta de R$500, ganhe até R$10/mês",
          "🚀 Quanto mais indicar, maior o cashback acumulado",
          "🎯 Possibilidade real de zerar sua conta de luz",
        ],
      },
      {
        type: "video",
        title: "iGreen Club — Seu Clube de Descontos",
        subtitle: "Além da economia na luz, descontos em mais de 30 mil lojas",
        videoId: "5a250f12-19a2-4d1c-a1ab-f35f563963dd",
      },
      {
        type: "video",
        title: "Como Funciona o iGreen Club",
        videoId: "9696eaf6-bdea-473f-9e9d-2d868b16b042",
      },
      {
        type: "advantages",
        title: "Vantagens de Ser iGreen Energy",
        subtitle: "Tudo o que você ganha ao se cadastrar",
        items: [
          "💰 Economia de até 20% na conta de luz todo mês",
          "🔄 Cashback sustentável por indicações",
          "🛒 Descontos em mais de 60 mil lojas com iGreen Club",
          "🎁 Benefícios gratuitos sem custos adicionais",
          "📋 Sem burocracia e sem riscos",
          "🔓 Sem fidelidade — cancele quando quiser",
          "🚫 Sem necessidade de comprar placas solares",
          "📱 100% digital — cadastro rápido e online",
          "🏆 Empresa com selo RA1000 do Reclame Aqui",
          "🌱 Contribua para um futuro sustentável",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  // 9. CONEXÃO EXPANSÃO (Oportunidade para Consultores)
  // ─────────────────────────────────────────────
  {
    slug: "conexao-expansao",
    name: "Conexão Expansão",
    brandName: "iGreen Energy",
    heroTitle: "DESCUBRA COMO CONSTRUIR UMA RENDA RECORRENTE E CRESCENTE COM A MAIOR EMPRESA DE ENERGIA SOLAR DO BRASIL",
    heroSubtitle: "Torne-se um Licenciado iGreen Energy e receba comissões sobre 9 produtos diferentes, formando uma equipe e construindo renda passiva",
    heroVideoId: "9b67408c-8b26-4b3e-834b-c02908f21324",
    heroAutoplay: true,
    gradient: "linear-gradient(rgb(14, 128, 40) 0%, rgb(8, 28, 3) 100%)",
    ctaLabel: "QUERO SER LICENCIADO",
    whatsappMessage: "Olá, gostaria de mais informações sobre a oportunidade de Licenciado iGreen Energy",
    sections: [
      {
        type: "about",
        title: "Oportunidade iGreen Energy",
        subtitle: "Ganhe comissões recorrentes formando uma equipe comercial de Licenciados",
        items: [
          "💼 Receba R$300 de bônus por cada Licenciado Direto cadastrado",
          "💰 Comissões recorrentes sobre todo o trabalho da sua equipe",
          "📊 30% do kWh acumulado pelos seus Licenciados conta para sua progressão",
          "🏆 Plano de Carreira com 8 níveis e comissões crescentes",
          "🔄 Renda passiva — continue ganhando mesmo sem trabalhar diariamente",
          "📱 Trabalhe de onde quiser, 100% digital",
          "🎯 9 produtos para oferecer: Energia, Telecom, Seguros, Club e mais",
          "🤝 Treinamento e suporte completo do seu Líder",
        ],
      },
      {
        type: "benefits",
        title: "Como Você é Remunerado",
        subtitle: "Bônus e comissões em múltiplos níveis",
        items: [
          "🥇 1º Nível (Licenciado Direto): R$300 de bônus + comissões recorrentes",
          "🥈 2º Nível: R$100 de bônus + comissões sobre o trabalho do Licenciado",
          "🥉 Até o 5º nível: comissões sobre toda a equipe que se forma abaixo de você",
          "📈 Quanto maior seu nível no Plano de Carreira, maiores as porcentagens",
          "💵 Comissão sobre Conexão Green (CP): até 4% recorrente sobre conta de luz",
          "💵 Comissão Indireta (CI): até 1% recorrente sobre a equipe",
        ],
      },
      {
        type: "plans",
        title: "Plano de Carreira",
        subtitle: "Cresça na iGreen e aumente suas comissões progressivamente",
        items: [
          "🌱 Licenciado — Início da jornada, já recebe comissões",
          "⭐ S-Expansão — 2 Licenciados Diretos Ativos (+0,2%)",
          "🌟 G-Expansão — 5 Licenciados sendo 2 S-Expansão (+0,3%)",
          "💫 Gestor — Equipe sólida formada (+0,5%)",
          "🔥 E-Expansão — 7 Licenciados sendo 2 G-Expansão (+0,6%)",
          "🚀 Executivo — Liderança consolidada (+0,8%)",
          "💎 D-Expansão — 10 Licenciados sendo 2 G + 2 E (+1%)",
          "👑 Diretor — Top da carreira (+1,4%)",
          "🏆 Acionista — Máximo nível (+1,8%)",
        ],
      },
      {
        type: "advantages",
        title: "Vantagens de Ser Licenciado",
        subtitle: "Por que milhares de pessoas já escolheram a iGreen Energy",
        items: [
          "💼 Negócio próprio sem investimento alto",
          "💰 Renda recorrente que cresce todo mês",
          "📱 100% digital — trabalhe de qualquer lugar",
          "🎯 9 produtos diferentes para oferecer",
          "🏆 Plano de Carreira com bônus progressivos",
          "🤝 Suporte e treinamento completo",
          "🔄 Comissões sobre equipe até o 5º nível",
          "🌱 Empresa sólida com 600 mil+ clientes",
          "📊 Dashboard completo para acompanhar ganhos",
          "⏰ Quanto antes começar, mais rápido cresce",
        ],
      },
    ],
  },
];
