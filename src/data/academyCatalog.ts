// =====================================================================
// iGreen Academy — Catálogo de treinamentos, provas e níveis.
// GERADO a partir de "PAGINA TREINAMENTO/data.js" e "quizzes.js".
// Hierarquia: TRILHA (conexão) -> MÓDULO -> AULA (vídeo do YouTube).
// Não editar à mão sem necessidade — preferir regenerar pelo script.
// =====================================================================

export interface AcademyLesson {
  title: string;
  /** ID do vídeo no YouTube */
  yt: string;
}

export interface AcademyModule {
  title: string;
  lessons: AcademyLesson[];
  /** Módulo que concede certificado ao concluir */
  certificate?: boolean;
}

export interface AcademyTrack {
  id: string;
  title: string;
  tagline: string;
  /** Cor de destaque da trilha (origem do conteúdo) */
  color: string;
  /** Conteúdo externo/complementar (canais que ensinam vendas) */
  extra?: boolean;
  modules: AcademyModule[];
}

export interface QuizQuestion {
  q: string;
  options: string[];
  /** Índice (0-based) da alternativa correta */
  answer: number;
}

export interface Quiz {
  questions: QuizQuestion[];
}

export interface KnowledgeLevel {
  /** Nº mínimo de provas aprovadas para alcançar o nível */
  min: number;
  key: string;
  name: string;
  icon: string;
  desc: string;
}

export const CATALOG: AcademyTrack[] = [
  {
    id: "intro",
    title: "Comece Por Aqui",
    tagline: "O ponto de partida da sua jornada",
    color: "#1db954",
    modules: [
      {
        title: "Módulo 1: Boas-vindas",
        lessons: [
          { title: "Primeiros Passos — O início da sua jornada iGreen Energy", yt: "ZQT7mXZmY-8" },
        ],
      },
    ],
  },
  {
    id: "livre",
    title: "Conexão Livre",
    tagline: "Energia por assinatura, sem obras e sem fidelidade",
    color: "#2ecc71",
    modules: [
      {
        title: "Módulo 1: Introdução Conexão Livre",
        certificate: true,
        lessons: [
          { title: "O que é a Conexão Livre? — Aula 1", yt: "6xXVPmx8Uko" },
          { title: "Benefícios da Conexão Livre para o cliente — Aula 2", yt: "mSPSSrpoFfQ" },
          { title: "Materiais e suporte ao licenciado — Aula 3", yt: "ykf6rMwWJYA" },
          { title: "Como conectar um cliente na Conexão Livre — Aula 4", yt: "zjXiBUJy7fE" },
          { title: "Formas de ganho com a Conexão Livre — Aula 5", yt: "0v-HlLrFGKA" },
          { title: "Carreiras e estratégia de crescimento — Aula 6", yt: "N25-jdpppfk" },
        ],
      },
    ],
  },
  {
    id: "green",
    title: "Conexão Green",
    tagline: "Desconto na conta de luz com energia limpa",
    color: "#27ae60",
    modules: [
      {
        title: "Módulo 1: Introdução Conexão Green",
        certificate: true,
        lessons: [
          { title: "O que é a Conexão Green — Aula 1", yt: "7uTXNeWV8nI" },
          { title: "Benefícios da Conexão Green para o Cliente — Aula 2", yt: "HKe8-B-nXPI" },
          { title: "Materiais e Suporte ao Licenciado — Aula 3", yt: "uxQ8ehEB7yE" },
          { title: "Como Conectar um cliente na Conexão Green — Aula 4", yt: "sj2plyZnMI4" },
          { title: "Formas de Ganhos com a Conexão Green — Aula 5", yt: "_kV-KtqNUdQ" },
          { title: "Carreira e Estratégias de Crescimento — Aula 6", yt: "QcoqX6W7kQw" },
        ],
      },
      {
        title: "Tutoriais",
        lessons: [
          { title: "Tutorial Conexão Green", yt: "9sxMIHEmg4E" },
          { title: "Tutorial Autoconexão Green", yt: "GVU0XT0MHj0" },
          { title: "Tutorial Cashback", yt: "ICG3gzmEBgs" },
        ],
      },
    ],
  },
  {
    id: "placas",
    title: "Conexão Placas",
    tagline: "Energia solar fotovoltaica do início ao fim",
    color: "#f1c40f",
    modules: [
      {
        title: "Módulo 1: Introdução Conexão Placas",
        lessons: [
          { title: "O que é a Conexão Placas? — Aula 01", yt: "G-W2KQFsQsI" },
          { title: "Benefícios da Conexão Placas — Aula 02", yt: "TIkpM8_jKok" },
        ],
      },
      {
        title: "Módulo 2: Formas de Pagamento",
        lessons: [
          { title: "Formas de Pagamento — Aula 01", yt: "sN0F4rLqrQM" },
          { title: "Financiamento com bancos parceiros — Aula 02", yt: "5r8D190tbDM" },
          { title: "Financiamento com bancos dos clientes — Aula 03", yt: "GOggjC6IANc" },
        ],
      },
      {
        title: "Módulo 3: Proposta",
        lessons: [
          { title: "Como gerar a proposta — Aula 01", yt: "ZjG-LwFAv4w" },
          { title: "Proposta Comercial — Aula 02", yt: "eFHlgPjtMQQ" },
        ],
      },
      {
        title: "Módulo 4: Vistoria",
        lessons: [
          { title: "Introdução à vistoria — Aula 01", yt: "hgy0vGq01eo" },
          { title: "Vistoria na prática — Aula 02", yt: "-YxiyNeRZcs" },
        ],
      },
      {
        title: "Módulo 5: Fechamento",
        lessons: [
          { title: "Envio e Assinatura — Aula 01", yt: "vXGeRe4A8PY" },
          { title: "Pagamento e Bonificação — Aula 02", yt: "Lvbqju_1kp0" },
        ],
      },
    ],
  },
  {
    id: "solar",
    title: "Conexão Solar",
    tagline: "A nova fronteira da geração própria",
    color: "#e67e22",
    modules: [
      {
        title: "Módulo 1: Introdução Conexão Solar",
        lessons: [
          { title: "Introdução Conexão Solar — Aula 1", yt: "yFzEqnlEWAA" },
        ],
      },
    ],
  },
  {
    id: "telecom",
    title: "Conexão Telecom",
    tagline: "Telefonia móvel com a iGreen Telecom",
    color: "#3498db",
    modules: [
      {
        title: "Módulo 1: O que é a Conexão Telecom?",
        lessons: [
          { title: "Introdução à Conexão Telecom — Aula 1", yt: "1rW6u5MPwGc" },
          { title: "Diferenciais e Benefícios da iGreen Telecom — Aula 2", yt: "eV4zqEZXA3E" },
          { title: "Como funcionam as promoções da Conexão Telecom? — Aula 3", yt: "YKvM_iy5il0" },
          { title: "Vantagens Estratégicas da iGreen Telecom — Aula 4", yt: "je2HmbnS6K8" },
        ],
      },
      {
        title: "Módulo 2: Passo a passo para cadastrar um cliente Telecom",
        lessons: [
          { title: "Introdução ao módulo de operação — Aula 1", yt: "76bvaCKWFn8" },
          { title: "Como cadastrar uma nova linha — Aula 2", yt: "BO0jgyfORUs" },
          { title: "Como ativar o cliente pelo App iGreen Club — Aula 3", yt: "UHvRcWrNi2c" },
          { title: "Como realizar a Portabilidade — Aula 4", yt: "drl2LSFQJgQ" },
          { title: "Como configurar o eSIM — Aula 5", yt: "B8HOVwZIDDo" },
          { title: "Visualizando sua carteira de clientes — Aula 6", yt: "IYGvbLrFCf0" },
        ],
      },
      {
        title: "Módulo 3: Expansão Internacional",
        lessons: [
          { title: "Explicando a Expansão Internacional — Aula 1", yt: "rtTGx2nDc5k" },
          { title: "Rentabilização — Aula 2", yt: "RkmYdJgY1w8" },
          { title: "Qualificação na Operação Internacional — Aula 3", yt: "Jq_npCCMAhI" },
        ],
      },
    ],
  },
  {
    id: "expansao",
    title: "Conexão Expansão",
    tagline: "Construa e multiplique a sua rede",
    color: "#9b59b6",
    modules: [
      {
        title: "Módulo 1: Introdução Conexão Expansão",
        certificate: true,
        lessons: [
          { title: "O que é Conexão Expansão? — Aula 1", yt: "JufZvfet2FM" },
          { title: "Dicas para expandir o seu negócio — Aula 2", yt: "H2fXKseS-E0" },
        ],
      },
      {
        title: "Tutoriais",
        lessons: [
          { title: "Tutorial Voucher", yt: "r3g8vUK_CE0" },
          { title: "Tutorial Auto Expansão", yt: "EpTClhDFW5k" },
        ],
      },
    ],
  },
  {
    id: "entenda",
    title: "Entenda as Conexões na Prática",
    tagline: "Vídeos oficiais que explicam cada solução iGreen",
    color: "#16a085",
    extra: true,
    modules: [
      {
        title: "Vídeos Explicativos",
        lessons: [
          { title: "Entenda como funciona a Conexão Livre", yt: "R_3dZ9r4yww" },
          { title: "Como funciona a Conexão Green?", yt: "NYS6r0Nk4GI" },
          { title: "iGreen Energy — Como funciona a Conexão Green?", yt: "Ma8QN7x_d-E" },
          { title: "Conexão Green — Até 15% de desconto", yt: "qNlJevw_S5Y" },
          { title: "Reportagem iGreen Energy — Conexão Green", yt: "fQTie2mMtFA" },
          { title: "É desconto real na conta de luz, sem investimento!", yt: "sZkuF0h_pe4" },
          { title: "O segredo para ZERAR sua conta de energia", yt: "0LpWBUcZ8D4" },
          { title: "Quais as vantagens de ser iGreen Telecom?", yt: "LS5QMg5IeT8" },
          { title: "Conheça a iGreen Telecom", yt: "FObD20WJnu0" },
          { title: "Por que milhares já escolheram ser clientes iGreen?", yt: "ZYk43x89eBY" },
        ],
      },
    ],
  },
  {
    id: "cast",
    title: "iGreen Cast — Estratégia e Crescimento",
    tagline: "Conversas com líderes para evoluir no negócio",
    color: "#e84393",
    extra: true,
    modules: [
      {
        title: "Episódios",
        lessons: [
          { title: "Oportunidade, escolhas e crescimento — Carlos Shekinah e Márcio Garcia", yt: "h4aMHjuko60" },
          { title: "Resultados reais na Conexão Green — Guilherme e Márcio Garcia", yt: "-ZQMGI6GDUg" },
          { title: "Visão e liderança que criam experiências — Márcio Garcia e Thiago Alexander", yt: "6UFGLSlupo8" },
          { title: "O que a iGreen Telecom está fazendo para revolucionar o mercado?", yt: "bf7xcIH5A-k" },
          { title: "Como alavancar seus ganhos com o Cashback do Cliente — Thiago Alexander", yt: "aaNNRP3wyio" },
          { title: "O caminho para alavancar resultados até 5x mais — Thiago Alexander e Eduardo Martins", yt: "zmUFbj3GSok" },
          { title: "O que a Bárbara Rubim pensa da iGreen — com a CEO Amanda Durante", yt: "3f9Q2ZjQGAk" },
          { title: "Bate-papo com o acionista Anderson Gessler — EP.4", yt: "-HUw6hcGGfw" },
          { title: "Por que a COMERC? Entenda a parceria — Chandley Reis", yt: "iHXZJhGk9Y0" },
        ],
      },
    ],
  },
  {
    id: "igreen-treinamentos",
    title: "Treinamentos iGreen na Prática",
    tagline: "Aulas de licenciados e líderes para acelerar seus resultados",
    color: "#16a085",
    extra: true,
    modules: [
      {
        title: "Primeiros Passos e Apresentação",
        lessons: [
          { title: "Os primeiros passos do novo licenciado iGreen — Fillipe Souza", yt: "jvwcm8boePQ" },
          { title: "Apresentação completa e detalhada iGreen 2025 — Eduardo Martins", yt: "rkV1m3dPO5k" },
          { title: "Como apresentar a iGreen em 5 minutos — Eduardo Martins", yt: "wEVzBZCSdBI" },
          { title: "Entenda TUDO da iGreen em 8 minutos — Eduardo Martins", yt: "Heaa3Vmu6Vw" },
          { title: "10 passos para o sucesso na iGreen — Fellipe Morais", yt: "xMjA8MtgXco" },
        ],
      },
      {
        title: "Vendas e Captação de Clientes",
        lessons: [
          { title: "Como abordar um cliente para iGreen — iGreen Brasil", yt: "NwwH_zSI-_0" },
          { title: "Essa abordagem de cliente é genial (cortes) — iGreen Brasil", yt: "--BTl2PAXZQ" },
          { title: "112 clientes em 30 dias ou menos — iGreen 3616", yt: "syuiOFv4FhA" },
          { title: "Como fazer acima de 10 mil/mês com Conexão Livre — Eduardo Martins", yt: "czHbAy5RobA" },
          { title: "Estratégias práticas para explodir seus resultados — Eduardo Martins", yt: "7rL07zdUOWU" },
          { title: "Como conectar um cliente na iGreen (passo a passo) — Eduardo Martins", yt: "mnazHSgAA90" },
        ],
      },
    ],
  },
  {
    id: "igreen-placas",
    title: "iGreen Placas na Prática",
    tagline: "Conexão Placas do orçamento à vistoria",
    color: "#f1c40f",
    extra: true,
    modules: [
      {
        title: "Treinamentos Conexão Placas",
        lessons: [
          { title: "Passo a passo Conexão Placas — Jônatas Simão", yt: "xhiu-vBu5HM" },
          { title: "Treinamento Conexão Placas completo — JC Energia Renovável", yt: "Mb8AI8sB7DQ" },
          { title: "Macetes, dicas e segredos Conexão Placas — Jimmy Fenner", yt: "vDdxZrU15Pk" },
          { title: "Como gerar proposta de placa no app — Jônatas Simão", yt: "x0PYSDi5llg" },
          { title: "Tutorial: realizando conexão da placa no app — iGreen 3616", yt: "i3dWfURZhlM" },
          { title: "Vistoria Conexão Placas passo a passo — Débora Ferraz", yt: "s6A5vCmby6U" },
        ],
      },
    ],
  },
  {
    id: "igreen-telecom2",
    title: "iGreen Telecom na Prática",
    tagline: "Venda de telefonia móvel e portabilidade",
    color: "#3498db",
    extra: true,
    modules: [
      {
        title: "Treinamentos iGreen Telecom",
        lessons: [
          { title: "Treinamento iGreen Telecom — iGreen Energy", yt: "t8Vb-67Kn3s" },
          { title: "O segredo para vender iGreen Telecom e lucrar — Eduardo Martins", yt: "gMK0IIy128Y" },
          { title: "Cobertura, estratégia e lucro com a iGreen — Diretor Luiz Guilherme", yt: "WdaaQ0zcuQ0" },
          { title: "Diferenciais da iGreen Telecom — Eduardo Martins", yt: "Nv66UtHjYnA" },
          { title: "Como realizar a portabilidade passo a passo — Eduardo Martins", yt: "76vCioupyOE" },
          { title: "Renda recorrente com telefonia móvel — Leandro Gomes", yt: "E-sYG1peQ18" },
        ],
      },
    ],
  },
  {
    id: "igreen-seguros2",
    title: "iGreen Seguros na Prática",
    tagline: "Conexão Seguros: formação comercial e vendas",
    color: "#9b59b6",
    extra: true,
    modules: [
      {
        title: "Conexão Seguros",
        lessons: [
          { title: "Formação Comercial iGreen Seguros — Adenir Head Rodrigues", yt: "cmQ22Yqon4c" },
          { title: "Sala de Guerra: treinamento completo Conexão Seguro — Adenir Rodrigues", yt: "1H1dODOeuC0" },
          { title: "Como funciona a iGreen Seguros — Eduardo Martins", yt: "ByUJ-lIqXYU" },
          { title: "Treinamento completo de iGreen Seguros — J1.9", yt: "gmvY2qcSb5k" },
        ],
      },
    ],
  },
  {
    id: "igreen-lideranca",
    title: "Liderança e Expansão de Rede",
    tagline: "Para líderes: construir, multiplicar e liderar equipes",
    color: "#e84393",
    extra: true,
    modules: [
      {
        title: "Liderança e Mentalidade",
        lessons: [
          { title: "Liderança e mentalidade — Presidente Thiago Alexander", yt: "Q9pxFF4lwQc" },
          { title: "Visão e mentalidade de um líder — Fellipe Morais", yt: "Pprg2SvsKDU" },
          { title: "Os 5 pilares da liderança para networkers PRO — Felipe Moraes", yt: "f8l_hQRM1_c" },
          { title: "A verdade sobre trabalhar na iGreen (grandes líderes) — Eduardo Martins", yt: "zby-652s6yU" },
        ],
      },
      {
        title: "Construção e Expansão de Equipe",
        lessons: [
          { title: "Como crescer sua equipe com eficiência — Thiago Alexander", yt: "JjQ3i-qqxxA" },
          { title: "Treinamento Expansão Especial TURBO — Thiago Alexander", yt: "-LKTS0utNWw" },
          { title: "Tudo sobre a estratégia de Expansão Internacional — Thiago Alexander", yt: "R_wNm3HHHd4" },
          { title: "Treinamento completo: mutirões, expansão e royalties — Edson Tadashi", yt: "1iBnmZMf3fY" },
        ],
      },
    ],
  },
  {
    id: "igreen-carreira",
    title: "Plano de Carreira e Matemática iGreen",
    tagline: "Entenda bônus, recorrência e como calcular seus ganhos",
    color: "#27ae60",
    extra: true,
    modules: [
      {
        title: "Plano de Carreira",
        lessons: [
          { title: "Plano de carreira iGreen explicado de forma simples — Liberdade Financeira", yt: "nrYvl9k54Sk" },
          { title: "Como funciona o plano de carreira na iGreen — Alex e Manu", yt: "4xPFqLQAYdg" },
          { title: "Animação: plano de carreira e bônus da iGreen — Renda com Energia", yt: "_8l9YG9SFik" },
          { title: "Pré-qualificações da iGreen — Joel Pletsch", yt: "ylQe5vT_Wdw" },
        ],
      },
      {
        title: "Matemática dos Bônus",
        lessons: [
          { title: "Como calcular os bônus extra e recorrência — Renda com Energia", yt: "YCrfaWiTbIc" },
          { title: "Plano de negócio com Sênior Evandro Oliveira (APN) — Lei da Energia Solar", yt: "-88lCrgQMbs" },
          { title: "Meu primeiro ano: como gerei +R$6.000/mês — Rafael Goedert", yt: "z54gGshmIKA" },
        ],
      },
    ],
  },
  {
    id: "cap-solar",
    title: "Capacitação: Energia Solar",
    tagline: "Entenda a tecnologia fotovoltaica para vender com segurança",
    color: "#e67e22",
    extra: true,
    modules: [
      {
        title: "Como Funciona a Energia Solar",
        lessons: [
          { title: "Como funciona uma usina solar — Manual do Mundo", yt: "_W1nQT7az8c" },
          { title: "Como funcionam os painéis solares — Engenharia Detalhada", yt: "gi6xMlYK7Og" },
          { title: "How Solar Power Works (animação) — Animagraffs", yt: "nUDNYoQJx7k" },
          { title: "Como a energia solar é convertida em eletricidade — Ponto em Comum", yt: "TCQhdAHOSIk" },
          { title: "Como funciona uma usina solar — ANEEL", yt: "kt-CwkoeYD4" },
          { title: "Entenda a energia solar de forma simples — Getpower", yt: "hTkAztglhnU" },
        ],
      },
      {
        title: "Projeto e Instalação",
        lessons: [
          { title: "Como instalar energia solar passo a passo — Airton Santiago", yt: "wbQEvEv6ZWk" },
          { title: "Como ter um projeto solar aprovado — Engehall", yt: "FtcquS2mdnw" },
          { title: "Curso de energia solar: análise técnica (aula 1) — Elétrica e Cia", yt: "M78zXSHtK6g" },
          { title: "10 principais dúvidas sobre energia solar — Pedro Capriglione", yt: "uS9VnRYq5TM" },
        ],
      },
    ],
  },
  {
    id: "cap-venda-solar",
    title: "Capacitação: Venda de Energia Solar",
    tagline: "Abordagem, prospecção e fechamento no mercado solar",
    color: "#f39c12",
    extra: true,
    modules: [
      {
        title: "Abordagem e Prospecção",
        lessons: [
          { title: "Como abordar o cliente de energia solar — Lincon Beraldo", yt: "WZkA56xcXQI" },
          { title: "Tipos de abordagem para vender energia solar — Elvis Pestana", yt: "0QKzDrMf-qk" },
          { title: "Como prospectar centenas de clientes de solar — Instituto Solar", yt: "Yc7UKEjsqdw" },
          { title: "Como entrar no mercado de energia solar — Getpower", yt: "dkSDHx57r-8" },
        ],
      },
      {
        title: "Técnicas e Fechamento",
        lessons: [
          { title: "3 passos para ser o melhor vendedor de solar — Getpower", yt: "tzX3wwTVgO8" },
          { title: "3 coisas que todo vendedor fotovoltaico deve saber — Instituto Solar", yt: "zSo4pOXozwA" },
          { title: "Principais técnicas de venda de energia solar — Elvis Pestana", yt: "RC-XVUS8wpQ" },
          { title: "Técnicas e negociação de projetos solares (webinar) — Canal Solar", yt: "AqFke49TQQ4" },
          { title: "Como vender energia solar para empresas — Energia com Guilherme", yt: "idjwlUqTLfY" },
        ],
      },
    ],
  },
  {
    id: "cap-vendas",
    title: "Capacitação: Técnicas de Vendas",
    tagline: "Os melhores treinamentos de vendas do Brasil",
    color: "#1abc9c",
    extra: true,
    modules: [
      {
        title: "Fundamentos da Venda",
        lessons: [
          { title: "Essa técnica simples aumenta as vendas em 10x — Thiago Concer", yt: "sh1mn6u1vXA" },
          { title: "As melhores técnicas de vendas — Ciro Bottini", yt: "W7P4xxBp5Ww" },
          { title: "Todo vendedor deveria entender isso — Flávio Augusto (PrimoCast)", yt: "4XpoIWWaja4" },
          { title: "Como vender mais dominando a mente do cliente — Hotmart Cast", yt: "j8Np52XMyKI" },
        ],
      },
      {
        title: "Abordagem e Atendimento",
        lessons: [
          { title: "Como abordar clientes em 6 passos — André Ortiz", yt: "P82kY3ynZLE" },
          { title: "Como fazer a primeira abordagem com o cliente — Thiago Concer", yt: "w7gtrxyji00" },
          { title: "Atendimento que encanta: o segredo para vender mais — Carol Iasmim", yt: "O97F8N5JDdo" },
        ],
      },
      {
        title: "Persuasão e Fechamento",
        lessons: [
          { title: "5 técnicas de persuasão para fechar vendas — Thiago Concer", yt: "RAOppNOpNUI" },
          { title: "3 melhores técnicas de fechamento — Eduardo Tevah", yt: "gwuAOJcWauc" },
          { title: "Técnicas para fechar vendas em menos tempo — Carol Iasmim", yt: "fiqPPT-viHY" },
        ],
      },
    ],
  },
  {
    id: "cap-telecom",
    title: "Capacitação: Vendas Telecom",
    tagline: "Venda de planos de telefonia, internet e por telefone",
    color: "#2980b9",
    extra: true,
    modules: [
      {
        title: "Venda por Telefone e Script",
        lessons: [
          { title: "Como vender por telefone: 8 técnicas que funcionam — Thiago Reis", yt: "frATQxPRkjA" },
          { title: "Script de vendas pelo telefone: conexão nos primeiros segundos — Thiago Concer", yt: "xKlI_mbPfdI" },
          { title: "3 dicas para um bom atendimento por telefone — Clube da Fala", yt: "1M_F2A5X7zk" },
        ],
      },
      {
        title: "Planos de Internet e Telefonia",
        lessons: [
          { title: "Venda de planos de internet porta a porta — Palestra de Vendas", yt: "WBNG9MWbMzU" },
          { title: "Como chamar a atenção do cliente para seu plano — Reynaldo Garcia", yt: "w2v-KyTOFck" },
          { title: "Porta a porta: vender internet e contornar objeções — Diosemberg Marques", yt: "8LhBgtIvjHQ" },
          { title: "Como usar SVAs para valorizar planos de internet — Instituto Nicolas Bueno", yt: "gH4QPgx2-Kk" },
        ],
      },
    ],
  },
  {
    id: "cap-seguros",
    title: "Capacitação: Seguros",
    tagline: "Do início da carreira ao fechamento de apólices",
    color: "#9b59b6",
    extra: true,
    modules: [
      {
        title: "Começando na Carreira",
        lessons: [
          { title: "Como se tornar um corretor de seguros: guia completo — Rodrigo Rosa", yt: "YCyWZYe_kn0" },
          { title: "Como tirar a SUSEP: tudo que o corretor precisa saber — Léo Mendes", yt: "4U_9dME8D2U" },
          { title: "Entenda como um corretor de seguros ganha dinheiro — Mais Seguro", yt: "yoVSWwF6-jo" },
          { title: "Como ser um bom vendedor de seguros — Canal Corretor", yt: "6XZQFYi6pmM" },
        ],
      },
      {
        title: "Vendendo Seguros",
        lessons: [
          { title: "Técnicas para vender seguro auto, residencial e empresarial — SuperVendedores", yt: "LXVR7D8hF6I" },
          { title: "Como vender seguro residencial — Lojacorr", yt: "HC5i3tc2TQ0" },
          { title: "Como vender seguro de vida em 9 passos — Canal Corretor", yt: "KPVa54GKDOk" },
          { title: "Como vender seguros para empresas — Seguros na Prática", yt: "4LSVhjKM8nE" },
        ],
      },
    ],
  },
];

// Nota mínima (%) para aprovação numa prova.
export const PASS_SCORE = 70;

// Níveis de conhecimento — baseados em quantas provas a pessoa foi aprovada.
export const KNOWLEDGE_LEVELS: KnowledgeLevel[] = [
  { min: 0,  key: "faisca",      name: "Faísca",            icon: "⚡", desc: "Está começando a jornada. Faça as provas para evoluir." },
  { min: 1,  key: "conector",    name: "Conector",          icon: "🔌", desc: "Já entende as conexões iGreen." },
  { min: 4,  key: "consultor",   name: "Consultor",         icon: "💼", desc: "Sabe apresentar e conectar clientes." },
  { min: 8,  key: "especialista",name: "Especialista",      icon: "🎯", desc: "Domina a técnica de cada conexão." },
  { min: 13, key: "lider",       name: "Líder Solar",       icon: "🌟", desc: "Preparado para liderar e expandir equipes." },
  { min: 18, key: "mestre",      name: "Mestre iGreen",     icon: "☀️", desc: "Referência em conhecimento. Dominou a plataforma." },
];

// Provas por módulo. Chave: `${catId}-${moduleIndex}`.
export const QUIZZES: Record<string, Quiz> = {
  // ===================== INTRODUÇÃO =====================
  "intro-0": {
    questions: [
      { q: "Qual é o primeiro passo recomendado para um novo licenciado iGreen?", options: ["Comprar um carro novo", "Entender a empresa e iniciar sua jornada com os treinamentos", "Contratar funcionários", "Abrir uma loja física"], answer: 1 },
      { q: "A iGreen Energy atua principalmente em qual mercado?", options: ["Alimentação", "Energia, telecom e serviços por modelo de conexão", "Construção civil", "Turismo"], answer: 1 },
      { q: "Por que vale a pena assistir os treinamentos antes de começar a vender?", options: ["Para perder tempo", "Para se tornar um profissional e não ficar perdido", "Não é necessário", "Apenas para ganhar pontos"], answer: 1 },
      { q: "O que diferencia um licenciado profissional de um amador?", options: ["Ter sorte", "Conhecimento, preparo e consistência", "Falar mais alto", "Trabalhar sem treinar"], answer: 1 },
      { q: "O modelo de negócio da iGreen é baseado em:", options: ["Conectar clientes a serviços e ganhar de forma recorrente", "Vender produtos uma única vez", "Apenas indicar amigos", "Investir em ações"], answer: 0 },
    ],
  },

  // ===================== CONEXÃO LIVRE =====================
  "livre-0": {
    questions: [
      { q: "O que é a Conexão Livre?", options: ["Venda de painéis solares", "Energia por assinatura, sem obras e sem fidelidade", "Um plano de telefonia", "Um seguro de vida"], answer: 1 },
      { q: "Qual é o principal benefício da Conexão Livre para o cliente?", options: ["Precisa instalar equipamentos caros", "Economia na conta de energia sem investimento ou obras", "Fidelidade de 5 anos", "Aumento da conta de luz"], answer: 1 },
      { q: "Como o licenciado pode ganhar com a Conexão Livre?", options: ["Apenas com salário fixo", "Conectando clientes e recebendo de forma recorrente", "Somente vendendo placas", "Não há ganhos"], answer: 1 },
      { q: "O que NÃO é necessário para o cliente aderir à Conexão Livre?", options: ["Ter uma conta de energia", "Fazer obras ou instalar equipamentos", "Ser cliente da distribuidora", "Aceitar os termos"], answer: 1 },
      { q: "A Conexão Livre é indicada para qual perfil de cliente?", options: ["Apenas grandes indústrias", "Quem quer economizar na conta de luz de forma simples", "Somente quem tem telhado próprio", "Quem não usa energia"], answer: 1 },
    ],
  },

  // ===================== CONEXÃO GREEN =====================
  "green-0": {
    questions: [
      { q: "A Conexão Green oferece ao cliente principalmente o quê?", options: ["Internet grátis", "Desconto na conta de luz com energia limpa", "Um celular novo", "Seguro residencial"], answer: 1 },
      { q: "A energia da Conexão Green é proveniente de qual fonte?", options: ["Carvão", "Fontes limpas e renováveis", "Diesel", "Nuclear"], answer: 1 },
      { q: "Qual material é essencial para apoiar o licenciado na venda da Green?", options: ["Nenhum", "Materiais e suporte fornecidos pela iGreen", "Apenas folhetos impressos próprios", "Ferramentas de obra"], answer: 1 },
      { q: "Qual é uma forma de ganho na Conexão Green?", options: ["Ganho recorrente por cliente conectado", "Apenas comissão única", "Não há comissão", "Somente bônus de viagem"], answer: 0 },
      { q: "Para conectar um cliente na Conexão Green, o licenciado precisa:", options: ["Reformar a casa do cliente", "Seguir o passo a passo de cadastro no sistema", "Instalar placas no telhado", "Trocar o relógio de energia"], answer: 1 },
    ],
  },
  "green-1": {
    questions: [
      { q: "O que o tutorial de Autoconexão Green ensina?", options: ["A instalar placas", "O próprio cliente realizar a sua conexão", "A trocar de operadora", "A fazer vistoria"], answer: 1 },
      { q: "O que é o Cashback na Conexão Green?", options: ["Um empréstimo", "Retorno/benefício financeiro relacionado ao cliente", "Uma multa", "Um seguro"], answer: 1 },
      { q: "Os tutoriais práticos servem para quê?", options: ["Decoração", "Ensinar o passo a passo operacional da conexão", "Vender carros", "Nada"], answer: 1 },
      { q: "Dominar os tutoriais práticos ajuda o licenciado a:", options: ["Atender o cliente com agilidade e segurança", "Demorar mais na conexão", "Errar o cadastro", "Depender sempre de outra pessoa"], answer: 0 },
    ],
  },

  // ===================== CONEXÃO PLACAS =====================
  "placas-0": {
    questions: [
      { q: "A Conexão Placas trabalha com qual produto?", options: ["Telefonia", "Energia solar fotovoltaica (placas/painéis)", "Seguro auto", "Energia por assinatura"], answer: 1 },
      { q: "Um benefício da energia solar fotovoltaica para o cliente é:", options: ["Aumentar a conta de luz", "Geração da própria energia e economia a longo prazo", "Pagar mais impostos", "Depender 100% da distribuidora"], answer: 1 },
      { q: "A Conexão Placas é mais indicada para clientes que:", options: ["Não têm imóvel", "Possuem local para instalação e querem gerar a própria energia", "Querem só telefonia", "Não pagam energia"], answer: 1 },
      { q: "Diferente da Conexão Livre, a Conexão Placas envolve:", options: ["Instalação de um sistema físico de geração", "Nenhum equipamento", "Apenas um app", "Troca de operadora"], answer: 0 },
    ],
  },
  "placas-1": {
    questions: [
      { q: "Na Conexão Placas, quais opções existem para o cliente pagar?", options: ["Apenas à vista", "Formas de pagamento e financiamento com bancos parceiros", "Somente cartão de débito", "Não há pagamento"], answer: 1 },
      { q: "O financiamento pode ser feito com:", options: ["Apenas dinheiro vivo", "Bancos parceiros ou o banco do próprio cliente", "Somente boleto", "Não existe financiamento"], answer: 1 },
      { q: "Por que conhecer as formas de pagamento é importante para o vendedor?", options: ["Não é importante", "Para oferecer a melhor opção e facilitar o fechamento", "Apenas por curiosidade", "Para complicar a venda"], answer: 1 },
      { q: "Oferecer financiamento ao cliente ajuda a:", options: ["Viabilizar a compra de quem não pode pagar à vista", "Encarecer sempre o projeto", "Atrapalhar a venda", "Reduzir a comissão"], answer: 0 },
    ],
  },
  "placas-2": {
    questions: [
      { q: "O que é a proposta comercial na Conexão Placas?", options: ["Um contrato de telefonia", "O documento que apresenta o projeto e os valores ao cliente", "Uma fatura de energia", "Um seguro"], answer: 1 },
      { q: "Onde o licenciado gera a proposta de placas?", options: ["No app/sistema iGreen", "No banco", "No cartório", "Não precisa gerar"], answer: 0 },
      { q: "Uma boa proposta comercial deve ser:", options: ["Clara, com valores e benefícios bem explicados", "Confusa e cheia de termos técnicos", "Sem valores", "Verbal apenas"], answer: 0 },
    ],
  },
  "placas-3": {
    questions: [
      { q: "Qual é o objetivo da vistoria na Conexão Placas?", options: ["Vender telefonia", "Avaliar o local da instalação do sistema solar", "Fechar o contrato de energia por assinatura", "Cobrar o cliente"], answer: 1 },
      { q: "A vistoria acontece em qual etapa?", options: ["Antes da instalação, para validar o projeto", "Depois de anos", "Nunca", "Só se o cliente reclamar"], answer: 0 },
      { q: "Uma vistoria bem feita evita:", options: ["Problemas técnicos e retrabalho na instalação", "A venda", "O pagamento", "A proposta"], answer: 0 },
    ],
  },
  "placas-4": {
    questions: [
      { q: "O que ocorre na etapa de Envio e Assinatura?", options: ["O cliente formaliza o contrato", "A placa é fabricada", "Nada", "Começa a vistoria"], answer: 0 },
      { q: "Após o fechamento, o licenciado recebe:", options: ["Apenas elogios", "Pagamento e bonificação pela venda", "Uma multa", "Nada"], answer: 1 },
      { q: "A assinatura do contrato é importante porque:", options: ["Formaliza o acordo e dá segurança a ambas as partes", "É só burocracia inútil", "Atrapalha a venda", "Não tem valor"], answer: 0 },
    ],
  },

  // ===================== CONEXÃO SOLAR =====================
  "solar-0": {
    questions: [
      { q: "A Conexão Solar está ligada a qual conceito?", options: ["Geração própria de energia / nova fronteira solar", "Telefonia móvel", "Seguro de vida", "Streaming de vídeo"], answer: 0 },
      { q: "Energia solar é uma fonte:", options: ["Poluente e cara", "Limpa e renovável", "Fóssil", "Importada"], answer: 1 },
      { q: "Investir em energia solar tende a trazer ao cliente:", options: ["Economia e valorização do imóvel", "Aumento permanente de gastos", "Mais impostos", "Dependência total da distribuidora"], answer: 0 },
    ],
  },

  // ===================== CONEXÃO TELECOM =====================
  "telecom-0": {
    questions: [
      { q: "A Conexão Telecom oferece o quê?", options: ["Placas solares", "Telefonia móvel (iGreen Telecom)", "Seguro residencial", "Energia por assinatura"], answer: 1 },
      { q: "Um diferencial da iGreen Telecom é:", options: ["Ganho único apenas", "Renda recorrente com telefonia móvel", "Não ter cobertura", "Ser só para empresas"], answer: 1 },
      { q: "As promoções da Conexão Telecom servem para:", options: ["Confundir o cliente", "Atrair e reter clientes com vantagens", "Aumentar preços", "Nada"], answer: 1 },
      { q: "A vantagem estratégica da iGreen Telecom para o licenciado é:", options: ["Somar mais uma fonte de renda recorrente à carteira", "Substituir a energia", "Reduzir os ganhos", "Encerrar contratos"], answer: 0 },
      { q: "A iGreen Telecom trabalha com qual tipo de serviço?", options: ["Telefonia móvel e dados", "Apenas TV a cabo", "Somente telefone fixo", "Internet via rádio apenas"], answer: 0 },
    ],
  },
  "telecom-1": {
    questions: [
      { q: "Qual app é usado para ativar e gerenciar o cliente Telecom?", options: ["App iGreen Club", "App de banco", "App de delivery", "Nenhum"], answer: 0 },
      { q: "O que é portabilidade na Telecom?", options: ["Trocar de operadora mantendo o mesmo número", "Comprar um celular novo", "Cancelar a linha", "Aumentar a fatura"], answer: 0 },
      { q: "O que é o eSIM?", options: ["Um chip físico antigo", "Um chip virtual/digital ativado no aparelho", "Um carregador", "Um app de jogos"], answer: 1 },
      { q: "Onde o licenciado acompanha seus clientes Telecom?", options: ["Na carteira de clientes do sistema", "No caderno", "Não acompanha", "No banco"], answer: 0 },
      { q: "Para cadastrar uma nova linha, o licenciado deve:", options: ["Seguir o passo a passo de cadastro no aplicativo", "Ir até a operadora antiga", "Pedir ao cliente que faça sozinho sem ajuda", "Não é possível"], answer: 0 },
    ],
  },
  "telecom-2": {
    questions: [
      { q: "A Expansão Internacional da Telecom permite:", options: ["Atuar e rentabilizar além das fronteiras do Brasil", "Apenas vender no bairro", "Nada", "Só viajar"], answer: 0 },
      { q: "O que é necessário para atuar na operação internacional?", options: ["Nada", "Qualificação na operação internacional", "Ter passaporte apenas", "Falar 5 idiomas"], answer: 1 },
      { q: "A Expansão Internacional representa para o licenciado:", options: ["Uma nova oportunidade de ganho e crescimento", "Um risco proibido", "O fim da operação", "Algo sem importância"], answer: 0 },
    ],
  },

  // ===================== CONEXÃO EXPANSÃO =====================
  "expansao-0": {
    questions: [
      { q: "Qual é o foco da Conexão Expansão?", options: ["Construir e multiplicar a sua rede de licenciados", "Vender só placas", "Trocar de operadora", "Fazer vistoria"], answer: 0 },
      { q: "Uma dica para expandir o negócio é:", options: ["Trabalhar sozinho sempre", "Duplicar conhecimento e formar novos licenciados", "Não treinar ninguém", "Esconder informação"], answer: 1 },
      { q: "Expandir a rede contribui para:", options: ["Aumentar os ganhos por meio da equipe", "Reduzir resultados", "Diminuir a renda", "Nada"], answer: 0 },
      { q: "Um bom multiplicador de rede:", options: ["Ensina e apoia novos licenciados a crescerem", "Compete com a própria equipe", "Esconde o conhecimento", "Trabalha isolado"], answer: 0 },
    ],
  },
  "expansao-1": {
    questions: [
      { q: "O que o Tutorial Voucher ensina?", options: ["A usar vouchers para expansão/cadastro", "A instalar placas", "A fazer portabilidade", "A vender seguro"], answer: 0 },
      { q: "A Auto Expansão permite que:", options: ["O próprio interessado se cadastre/expanda", "Apenas a diretoria cadastre", "Ninguém entre na rede", "O cliente cancele"], answer: 0 },
      { q: "Os tutoriais de expansão têm como objetivo:", options: ["Facilitar e agilizar a entrada de novos licenciados", "Dificultar o cadastro", "Reduzir a rede", "Nada"], answer: 0 },
    ],
  },

  // ===================== iGREEN NA PRÁTICA =====================
  "igreen-treinamentos-0": {
    questions: [
      { q: "Para apresentar a iGreen rapidamente, o ideal é:", options: ["Falar por 2 horas", "Dominar uma apresentação objetiva (ex.: em 5 minutos)", "Não explicar nada", "Só mandar link"], answer: 1 },
      { q: "Os primeiros passos do novo licenciado incluem:", options: ["Entender o negócio, treinar e começar a conectar clientes", "Esperar a empresa ligar", "Comprar estoque", "Abrir CNPJ obrigatoriamente antes de tudo"], answer: 0 },
    ],
  },
  "igreen-treinamentos-1": {
    questions: [
      { q: "Uma boa abordagem de cliente deve ser:", options: ["Agressiva e longa", "Clara, objetiva e focada no benefício do cliente", "Confusa", "Sem escutar o cliente"], answer: 1 },
      { q: "O que ajuda a conectar muitos clientes em pouco tempo?", options: ["Consistência, abordagem e uso dos mutirões/estratégias", "Sorte apenas", "Não fazer nada", "Esperar indicações"], answer: 0 },
      { q: "Conectar um cliente na iGreen exige:", options: ["Seguir o passo a passo do app/sistema", "Adivinhar", "Pedir para outra pessoa", "Nada"], answer: 0 },
    ],
  },
  "igreen-placas-0": {
    questions: [
      { q: "Para gerar uma proposta de placas, o licenciado usa:", options: ["O app/sistema iGreen", "Uma planilha qualquer", "Papel e caneta apenas", "Não gera proposta"], answer: 0 },
      { q: "A vistoria na prática serve para:", options: ["Validar as condições do local antes da instalação", "Vender telecom", "Cobrar o cliente", "Nada"], answer: 0 },
    ],
  },
  "igreen-telecom2-0": {
    questions: [
      { q: "A portabilidade na iGreen Telecom permite ao cliente:", options: ["Manter o número e trocar para a iGreen", "Perder o número", "Comprar energia", "Instalar placa"], answer: 0 },
      { q: "Um diferencial citado da iGreen Telecom é:", options: ["Renda recorrente em vez de ganho único", "Não ter cobertura", "Ser mais cara", "Não ter app"], answer: 0 },
    ],
  },
  "igreen-seguros2-0": {
    questions: [
      { q: "A Conexão Seguros gera para o licenciado:", options: ["Renda recorrente com a venda de seguros", "Apenas um agradecimento", "Prejuízo", "Nada"], answer: 0 },
      { q: "A formação comercial em seguros ensina a:", options: ["Vender mais e atender bem o cliente", "Apenas teoria sem prática", "Desistir", "Trocar de empresa"], answer: 0 },
    ],
  },
  "igreen-lideranca-0": {
    questions: [
      { q: "Uma característica essencial de um líder iGreen é:", options: ["Visão e mentalidade de crescimento", "Trabalhar sozinho", "Não treinar a equipe", "Competir com o time"], answer: 0 },
      { q: "Os pilares da liderança para networkers servem para:", options: ["Formar e desenvolver equipes fortes", "Enganar pessoas", "Vender menos", "Nada"], answer: 0 },
    ],
  },
  "igreen-lideranca-1": {
    questions: [
      { q: "Para crescer uma equipe com eficiência é importante:", options: ["Duplicar conhecimento e acompanhar de perto", "Deixar cada um por conta própria", "Não fazer reuniões", "Esconder estratégias"], answer: 0 },
      { q: "O que são os mutirões na iGreen?", options: ["Ações coletivas para conectar muitos clientes/expandir", "Festas sem objetivo", "Reuniões de reclamação", "Não existem"], answer: 0 },
      { q: "A Expansão Internacional representa:", options: ["Oportunidade de crescer além do Brasil", "Um risco proibido", "Algo só para diretores", "Fim da operação"], answer: 0 },
    ],
  },
  "igreen-carreira-0": {
    questions: [
      { q: "O plano de carreira da iGreen é baseado em:", options: ["Níveis, bônus e recorrência conforme resultados", "Sorteio", "Tempo de casa apenas", "Indicação política"], answer: 0 },
      { q: "As pré-qualificações servem para:", options: ["Definir requisitos para avançar e receber bônus", "Eliminar pessoas", "Nada", "Aumentar a conta de luz"], answer: 0 },
    ],
  },
  "igreen-carreira-1": {
    questions: [
      { q: "A recorrência significa:", options: ["Receber de forma contínua pelos clientes ativos", "Receber só uma vez", "Pagar a empresa", "Não receber"], answer: 0 },
      { q: "Entender a matemática dos bônus ajuda a:", options: ["Planejar metas e prever ganhos", "Confundir o vendedor", "Nada", "Reduzir vendas"], answer: 0 },
    ],
  },

  // ===================== ENTENDA AS CONEXÕES (vídeos explicativos) =====================
  "entenda-0": {
    questions: [
      { q: "A Conexão Green oferece ao cliente, na prática:", options: ["Desconto na conta de luz com energia limpa", "Um carro novo", "Internet via satélite", "Um empréstimo"], answer: 0 },
      { q: "A energia por assinatura (Conexão Livre) exige investimento ou obra do cliente?", options: ["Não, é sem investimento e sem obras", "Sim, precisa instalar placas", "Sim, precisa reformar o telhado", "Sim, precisa comprar baterias"], answer: 0 },
      { q: "Um argumento forte para o cliente aderir à iGreen é:", options: ["Economia real na conta sem perder a distribuidora atual", "Aumentar a conta de luz", "Ficar sem energia", "Pagar taxa de adesão alta"], answer: 0 },
      { q: "A iGreen Telecom se diferencia por oferecer:", options: ["Telefonia móvel com renda recorrente ao licenciado", "Apenas telefone fixo", "Somente internet discada", "Nenhum benefício"], answer: 0 },
    ],
  },

  // ===================== iGREEN CAST (estratégia) =====================
  "cast-0": {
    questions: [
      { q: "O cashback do cliente, segundo o conteúdo, serve para:", options: ["Alavancar os ganhos e fidelizar o cliente", "Aumentar custos", "Reduzir vendas", "Nada"], answer: 0 },
      { q: "Visão e liderança, segundo os episódios, são importantes para:", options: ["Criar experiências e crescer de forma sustentável", "Trabalhar isolado", "Evitar treinar pessoas", "Reduzir a equipe"], answer: 0 },
      { q: "A parceria com a COMERC reforça qual aspecto da iGreen?", options: ["Solidez e credibilidade no mercado de energia", "Falta de estrutura", "Risco para o cliente", "Nada relevante"], answer: 0 },
    ],
  },

  // ===================== CAPACITAÇÃO: ENERGIA SOLAR =====================
  "cap-solar-0": {
    questions: [
      { q: "O efeito que transforma luz do sol em eletricidade nas placas é o:", options: ["Efeito fotovoltaico", "Efeito estufa", "Efeito Doppler", "Efeito Joule"], answer: 0 },
      { q: "Um sistema solar fotovoltaico gera energia a partir de:", options: ["Luz solar captada pelos painéis", "Queima de combustível", "Vento apenas", "Água da chuva"], answer: 0 },
      { q: "A energia solar fotovoltaica é considerada:", options: ["Renovável e limpa", "Poluente e finita", "Importada", "Radioativa"], answer: 0 },
      { q: "O componente que converte a energia das placas em corrente usável na casa é:", options: ["O inversor", "O disjuntor", "O chuveiro", "O relógio de luz"], answer: 0 },
      { q: "Mesmo em dias nublados, o sistema solar:", options: ["Ainda gera energia, porém em menor quantidade", "Para totalmente de funcionar", "Gera o dobro", "Desliga a casa"], answer: 0 },
    ],
  },
  "cap-solar-1": {
    questions: [
      { q: "Antes da instalação de um sistema solar, é importante:", options: ["Ter um projeto técnico aprovado", "Apenas comprar as placas", "Ignorar a estrutura do telhado", "Nada"], answer: 0 },
      { q: "A análise técnica de um projeto solar avalia, entre outros:", options: ["Consumo, local e dimensionamento do sistema", "A cor da casa", "O carro do cliente", "Nada disso"], answer: 0 },
      { q: "Uma dúvida comum dos clientes sobre energia solar é:", options: ["Retorno do investimento e funcionamento em dias nublados", "A marca do celular", "O time de futebol", "Nenhuma"], answer: 0 },
      { q: "O dimensionamento do sistema é feito principalmente com base:", options: ["No consumo de energia do cliente", "No tamanho do quintal", "Na cor do telhado", "No número de pessoas na rua"], answer: 0 },
    ],
  },

  // ===================== CAPACITAÇÃO: VENDA DE ENERGIA SOLAR =====================
  "cap-venda-solar-0": {
    questions: [
      { q: "Uma boa abordagem de venda de energia solar começa por:", options: ["Entender a necessidade e a conta de luz do cliente", "Falar só de preço", "Pressionar o cliente", "Ignorar o cliente"], answer: 0 },
      { q: "Prospectar clientes de energia solar significa:", options: ["Buscar e qualificar potenciais clientes ativamente", "Esperar o telefone tocar", "Vender só para amigos", "Não fazer nada"], answer: 0 },
      { q: "Para entrar no mercado de energia solar, é fundamental:", options: ["Conhecer o produto e técnicas de venda", "Apenas ter um carro", "Não estudar", "Copiar concorrentes"], answer: 0 },
      { q: "Ao analisar a conta de luz do cliente, o vendedor consegue:", options: ["Mostrar a economia possível com o sistema solar", "Saber o time do cliente", "Descobrir a senha do banco", "Nada útil"], answer: 0 },
    ],
  },
  "cap-venda-solar-1": {
    questions: [
      { q: "Uma técnica eficaz para vender mais energia solar é:", options: ["Mostrar a economia e o retorno do investimento", "Esconder os valores", "Prometer o impossível", "Falar mal do concorrente"], answer: 0 },
      { q: "No fechamento de uma venda de projeto solar, é importante:", options: ["Apresentar proposta clara e contornar objeções", "Sumir após a proposta", "Ignorar dúvidas", "Pressionar agressivamente"], answer: 0 },
      { q: "Vender energia solar para empresas exige destacar:", options: ["Redução de custos operacionais e previsibilidade", "Apenas estética", "Nada técnico", "Só o preço baixo"], answer: 0 },
      { q: "Ao contornar uma objeção, o vendedor deve:", options: ["Escutar, entender e responder com argumentos reais", "Discutir com o cliente", "Desistir da venda", "Ignorar a dúvida"], answer: 0 },
    ],
  },

  // ===================== CAPACITAÇÃO: TÉCNICAS DE VENDAS =====================
  "cap-vendas-0": {
    questions: [
      { q: "Um fundamento essencial da venda é:", options: ["Entender a necessidade do cliente antes de oferecer", "Empurrar o produto a qualquer custo", "Falar sem parar", "Não ouvir"], answer: 0 },
      { q: "Dominar a mente do cliente, em vendas, significa:", options: ["Entender suas dores, desejos e gatilhos de decisão", "Manipular de forma desonesta", "Ignorar o cliente", "Vender mais caro sempre"], answer: 0 },
      { q: "Um bom vendedor, segundo os especialistas, foca em:", options: ["Gerar valor e resolver o problema do cliente", "Apenas bater meta a qualquer custo", "Falar só de si", "Evitar contato"], answer: 0 },
      { q: "A escuta ativa em vendas serve para:", options: ["Entender o que o cliente realmente precisa", "Ganhar tempo sem propósito", "Interromper o cliente", "Falar mais"], answer: 0 },
    ],
  },
  "cap-vendas-1": {
    questions: [
      { q: "Na primeira abordagem ao cliente, o ideal é:", options: ["Criar conexão e gerar confiança", "Já falar preço imediatamente", "Ser invasivo", "Ignorar a pessoa"], answer: 0 },
      { q: "Um atendimento que encanta se baseia em:", options: ["Escuta, empatia e solução", "Pressa e desatenção", "Robôs apenas", "Ignorar reclamações"], answer: 0 },
      { q: "A abordagem em 6 passos visa:", options: ["Estruturar o atendimento para vender mais", "Confundir o cliente", "Encerrar rápido sem vender", "Nada"], answer: 0 },
      { q: "A primeira impressão na abordagem é importante porque:", options: ["Define o tom e a confiança da negociação", "Não tem efeito nenhum", "Atrapalha a venda", "Afasta o cliente sempre"], answer: 0 },
    ],
  },
  "cap-vendas-2": {
    questions: [
      { q: "Gatilhos de persuasão servem para:", options: ["Influenciar positivamente a decisão de compra", "Enganar o cliente", "Atrasar a venda", "Nada"], answer: 0 },
      { q: "Uma técnica de fechamento eficaz é:", options: ["Conduzir o cliente à decisão resolvendo objeções", "Sumir na hora de fechar", "Deixar o cliente confuso", "Desistir"], answer: 0 },
      { q: "Fechar vendas em menos tempo depende de:", options: ["Boa qualificação e processo claro", "Sorte apenas", "Preço sempre baixo", "Insistência agressiva"], answer: 0 },
      { q: "A persuasão ética se diferencia da manipulação porque:", options: ["Respeita o cliente e gera valor real", "Engana para vender", "Esconde informações", "Força a compra"], answer: 0 },
    ],
  },

  // ===================== CAPACITAÇÃO: VENDAS TELECOM =====================
  "cap-telecom-0": {
    questions: [
      { q: "Na venda por telefone, os primeiros segundos servem para:", options: ["Gerar conexão e prender a atenção", "Falar o preço só", "Desligar", "Ler um script sem emoção"], answer: 0 },
      { q: "Um bom script de vendas por telefone deve ser:", options: ["Natural, objetivo e focado no cliente", "Longo e cansativo", "Decorado e robótico", "Sem objetivo"], answer: 0 },
      { q: "Um bom atendimento por telefone exige:", options: ["Clareza, boa comunicação e escuta", "Falar rápido demais", "Ignorar o cliente", "Gritar"], answer: 0 },
      { q: "O tom de voz ao telefone é importante porque:", options: ["Transmite confiança e profissionalismo", "Não faz diferença", "Só atrapalha", "Cansa o cliente"], answer: 0 },
    ],
  },
  "cap-telecom-1": {
    questions: [
      { q: "Na venda porta a porta de planos de internet, é importante:", options: ["Abordar bem e contornar objeções", "Ser invasivo", "Não conhecer o produto", "Desistir na primeira recusa"], answer: 0 },
      { q: "SVAs (serviços de valor agregado) servem para:", options: ["Valorizar o plano e aumentar a percepção de valor", "Encarecer sem motivo", "Confundir", "Nada"], answer: 0 },
      { q: "Para chamar a atenção do cliente para o seu plano, deve-se:", options: ["Mostrar benefícios claros e diferenciais", "Falar só de preço", "Ignorar a necessidade", "Prometer o impossível"], answer: 0 },
      { q: "Conhecer bem o produto que vende permite ao vendedor:", options: ["Responder dúvidas e passar segurança ao cliente", "Inventar informações", "Evitar o cliente", "Vender errado"], answer: 0 },
    ],
  },

  // ===================== CAPACITAÇÃO: SEGUROS =====================
  "cap-seguros-0": {
    questions: [
      { q: "Para atuar formalmente como corretor de seguros é necessário:", options: ["Obter o registro/habilitação na SUSEP", "Apenas vontade", "Ter uma loja", "Nada"], answer: 0 },
      { q: "O corretor de seguros normalmente ganha por meio de:", options: ["Comissões sobre as apólices vendidas", "Salário fixo da seguradora apenas", "Doações", "Não ganha"], answer: 0 },
      { q: "Um bom começo na carreira de seguros envolve:", options: ["Estudar produtos e técnicas de venda", "Vender sem conhecer o produto", "Não se qualificar", "Copiar preços"], answer: 0 },
      { q: "A sigla SUSEP refere-se ao órgão que:", options: ["Regula e fiscaliza o mercado de seguros no Brasil", "Cuida da energia elétrica", "Controla a telefonia", "Fiscaliza supermercados"], answer: 0 },
      { q: "O que é uma apólice de seguro?", options: ["O contrato que formaliza a cobertura entre segurado e seguradora", "Uma conta de luz", "Um boleto bancário", "Um chip de celular"], answer: 0 },
    ],
  },
  "cap-seguros-1": {
    questions: [
      { q: "Ao vender seguro de vida, o foco deve ser:", options: ["Proteção financeira da família do cliente", "Assustar o cliente", "Esconder coberturas", "Vender o mais caro sempre"], answer: 0 },
      { q: "Vender seguros para empresas exige entender:", options: ["Os riscos e necessidades do negócio", "Apenas o nome da empresa", "Nada técnico", "Só o preço"], answer: 0 },
      { q: "Para vender seguro residencial, é importante destacar:", options: ["As coberturas e a tranquilidade que o seguro traz", "Apenas o valor", "Que nunca será usado", "Nada"], answer: 0 },
      { q: "Explicar bem as coberturas ao cliente serve para:", options: ["Evitar dúvidas e gerar confiança na contratação", "Confundir o cliente", "Esconder informação", "Encarecer a venda"], answer: 0 },
      { q: "Identificar o perfil de risco do cliente ajuda a:", options: ["Oferecer o seguro mais adequado à necessidade dele", "Vender qualquer coisa", "Aumentar a comissão sem critério", "Ignorar o cliente"], answer: 0 },
    ],
  },
};
