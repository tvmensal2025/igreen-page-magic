// Dados de treinamento iGreen Energy
// Hierarquia: TRILHA (conexão) -> MÓDULO -> AULA (vídeo do YouTube)
// A divisão e os nomes dos módulos seguem EXATAMENTE a plataforma oficial (cademi).
// Trilhas extras (YouTube) foram mantidas ao final como material complementar.
const CATALOG = [
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
