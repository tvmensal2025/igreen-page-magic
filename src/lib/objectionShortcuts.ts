// Atalhos de objeção / FAQ do fluxo (iGreen Energy)
//
// Estrutura profissional:
//   - Texto: explica a dúvida (sem link, rua, print ou pedido de foto).
//   - Fechamento por etapa: runtime (`qa-step-close.ts`), não fixo no banco.
//   - Mídia: cada atalho tem lacunas vazias de áudio + vídeo para o consultor
//     preencher se quiser enriquecer a resposta.
//
// Gatilhos: frases específicas, sem duplicata entre atalhos.

export type QaMediaSlotKind = "audio" | "video";

/** Lacunas padrão: 1 áudio + 1 vídeo (vazios até preencher na UI). */
export const DEFAULT_QA_MEDIA_SLOTS: QaMediaSlotKind[] = ["audio", "video"];

export type ObjectionShortcut = {
  category: ObjectionCategory;
  name: string;
  triggers: string[];
  text: string;
  isHandoff?: boolean;
  /** Lacunas de mídia. Default: áudio + vídeo. */
  mediaSlots?: QaMediaSlotKind[];
};

export type ObjectionCategory =
  | "Confiança"
  | "Preço"
  | "Cobrança"
  | "Técnico"
  | "Cancelamento"
  | "Cadastro"
  | "Elegibilidade";

export const OBJECTION_CATEGORIES: ObjectionCategory[] = [
  "Confiança",
  "Preço",
  "Cobrança",
  "Técnico",
  "Cancelamento",
  "Cadastro",
  "Elegibilidade",
];

export const CATEGORY_EMOJI: Record<ObjectionCategory, string> = {
  Confiança: "🛡️",
  Preço: "💰",
  Cobrança: "🧾",
  Técnico: "⚙️",
  Cancelamento: "⏱️",
  Cadastro: "📋",
  Elegibilidade: "✅",
};

/** Fechamento por etapa é aplicado em runtime — ver `qa-step-close.ts`. */
export const SHORTCUT_RETURN_TO_CADASTRO =
  "Se estiver tudo certo, é só me dizer *pode seguir* que a gente continua seu cadastro. 😊⚡🌱";

/** CNPJ oficial alinhado à base de conhecimento / Reclame Aqui. */
export const IGREEN_CNPJ = "44.159.238/0001-30";

/**
 * Padrões únicos e completos — vários atalhos (gatilhos diferentes) compartilham
 * o mesmo texto/áudio pra não repetir quase a mesma fala com pequena variação.
 */
export const FAQ_PADRAO = {
  confianca: qaPadrao(
    "{{nome}}, entendo a desconfiança — é sua conta de luz e tem que ser sério. 😊\n\n" +
      "A *iGreen* é *100% legal*: regulamentada pela *ANEEL* (geração compartilhada, Lei 14.300/2022), " +
      "*CNPJ* " +
      IGREEN_CNPJ +
      ", no mercado desde *2017*, com escritório físico e mais de *700 mil clientes*. 🌱\n\n" +
      "Você assina *energia limpa* por assinatura e recebe *desconto* previsto no contrato — " +
      "*sem instalar nada* em casa, *sem fidelidade* e *sem multa*. ⚡",
  ),
  preco: qaPadrao(
    "{{nome}}, sobre custo: *zero adesão*, *zero taxa escondida*, *zero mensalidade extra*. 😊\n\n" +
      "Você *não paga pra entrar* e *não paga a mais* no fim do mês. A fatura *iGreen* " +
      "*substitui* parte da conta da concessionária (já com *desconto* contratualizado) — *não soma*. ⚡\n\n" +
      "O percentual fica *claro no contrato antes de assinar*. Se não vier como combinado, a *iGreen* corrige. " +
      "Sem pegadinha, sem letra miúda. 🌱",
  ),
  cancelamento: qaPadrao(
    "{{nome}}, pode ficar tranquilo: *zero fidelidade* e *zero multa*. 😊\n\n" +
      "Cancela quando quiser pelo *app* da iGreen ou pelo *WhatsApp* do atendimento — " +
      "o encerramento leva de *30 a 90 dias*, *sem taxa*. 🌱\n\n" +
      "Não fica amarrado: o contrato deixa isso explícito desde o início. ⚡",
  ),
  tecnico: qaPadrao(
    "{{nome}}, funciona assim: você *não troca de concessionária* e *não tem obra* em casa. 😊\n\n" +
      "A energia continua chegando pela mesma empresa da sua cidade. A *iGreen* só injeta " +
      "*energia limpa* na rede e aplica o *desconto* na fatura — *sem placa* no telhado. ⚡\n\n" +
      "Serve pra *apartamento*, casa ou comércio, desde que a *conta de luz* esteja no seu nome. 🌱",
  ),
  cadastro: qaPadrao(
    "{{nome}}, sem pressa com o documento. 😊\n\n" +
      "RG/CNH (e os dados do cadastro) são exigência da *ANEEL* pra te cadastrar como *titular*. " +
      "Vão direto pra plataforma segura da *iGreen* — *não ficam comigo* — e são protegidos pela *LGPD*. 🌱\n\n" +
      "É o mesmo tipo de segurança de qualquer contratação de energia séria. ⚡",
  ),
} as const;

function qaPadrao(body: string): string {
  return body.trim();
}

function qa(body: string): string {
  return body.trim();
}

export function getMediaSlots(s: ObjectionShortcut): QaMediaSlotKind[] {
  return s.mediaSlots?.length ? s.mediaSlots : DEFAULT_QA_MEDIA_SLOTS;
}

export const OBJECTION_SHORTCUTS: ObjectionShortcut[] = [
  // ── Confiança ──────────────────────────────────────────────────────────
  {
    category: "Confiança",
    name: "É golpe / furada",
    triggers: ["é golpe", "isso é golpe", "parece golpe", "parece furada", "é furada", "é enganação", "é fraude", "é picaretagem"],
    text: FAQ_PADRAO.confianca,
  },
  {
    category: "Confiança",
    name: "Não confio nessa empresa",
    triggers: ["não confio", "nao confio", "desconfio de vocês", "desconfio de voce", "não confio nisso", "suspeito de vocês"],
    text: FAQ_PADRAO.confianca,
  },
  {
    category: "Confiança",
    name: "Nunca ouvi falar",
    triggers: ["nunca ouvi falar", "não conheço a igreen", "nao conheco a igreen", "primeira vez que ouço", "quem é a igreen"],
    text: FAQ_PADRAO.confianca,
  },
  {
    category: "Confiança",
    name: "Reclame Aqui",
    triggers: [
      "reclame aqui",
      "no reclame aqui",
      "tem reclamação",
      "mal falaram de vocês",
      "vi reclamação",
      "vi no reclame aqui",
      "reputação no reclame",
    ],
    text: qa(
      "Boa pergunta, {{nome}} 😊\n\nNo *Reclame Aqui* a *iGreen* aparece como empresa *verificada*, com reputação *Boa* e alto índice de *solução* das reclamações. 🌱\n\nToda empresa grande recebe reclamação — o que importa é *responder* e *resolver*. ⚡\n\nAntes de assinar, o contrato deixa claro: *sem fidelidade*, *sem multa* e cancelamento pelo app ou WhatsApp.",
    ),
  },
  {
    category: "Confiança",
    name: "CNPJ / regulamentação",
    triggers: ["qual o cnpj", "cnpj da igreen", "é regulamentado", "regulamentado pela aneel", "autorizado pela aneel", "empresa legal"],
    text: FAQ_PADRAO.confianca,
  },
  {
    category: "Confiança",
    name: "Há quanto tempo existe",
    triggers: ["há quanto tempo existe", "quantos anos de mercado", "quando foi fundada", "quando começou", "quanto tempo no mercado"],
    text: FAQ_PADRAO.confianca,
  },
  {
    category: "Confiança",
    name: "Onde fica a sede",
    triggers: ["onde fica a sede", "endereço da empresa", "qual o endereço", "onde fica o escritório", "localização da sede"],
    text: qa(
      "A sede administrativa fica em *Cuiabá-MT*, {{nome}} 😊\n\nA *iGreen* tem presença nacional e atendimento digital em todo o Brasil. 🌱\n\nVocê resolve tudo por aqui, no *WhatsApp* — *sem precisar ir a lugar nenhum*. ⚡",
    ),
  },
  {
    category: "Confiança",
    name: "Quem é o dono",
    triggers: ["quem é o dono", "quem é o fundador", "quem é o ceo", "quem é o proprietário", "quem são os sócios"],
    text: qa(
      "A *iGreen* é fundada e dirigida pelo empresário *Beto Bahia*, {{nome}} 😊\n\nEmpresa privada, *100% brasileira*, focada em *energia limpa* acessível. 🌱⚡",
    ),
  },
  {
    category: "Confiança",
    name: "É pirâmide / multinível",
    triggers: [
      "é pirâmide",
      "é piramide",
      "é multinível",
      "marketing multinível",
      "esquema de pirâmide",
      "parece pirâmide",
    ],
    text: qa(
      "Não, {{nome}} 😊\n\nPirâmide *não entrega produto real*. Aqui o produto é *energia limpa* na sua conta, com contrato e *CNPJ* (" +
        IGREEN_CNPJ +
        "). 🌱\n\nHá consultores parceiros, mas *você* só contrata o *desconto* na luz — sem obrigação de indicar ninguém. ⚡",
    ),
  },

  // ── Preço ──────────────────────────────────────────────────────────────
  {
    category: "Preço",
    name: "É caro / não tenho dinheiro",
    triggers: ["tô sem dinheiro", "to sem dinheiro", "muito caro", "estou apertado", "sem grana", "tô quebrado"],
    text: FAQ_PADRAO.preco,
  },
  {
    category: "Preço",
    name: "Quanto economizo de verdade",
    triggers: ["quanto vou economizar", "quanto economizo", "qual a economia real", "quanto vou poupar", "comprovar a economia"],
    text: qa(
      "Em média *12% a 20% de desconto* sobre a parte de *energia* da sua conta, {{nome}} 😊⚡\n\nO percentual exato depende da distribuidora e do consumo — no cadastro eu já calculo o valor real pra você. 🌱\n\nTudo fica *previsto no contrato* antes de assinar.",
    ),
  },
  {
    category: "Preço",
    name: "Desconto é falso",
    triggers: ["desconto falso", "desconto é mentira", "propaganda enganosa", "isso não é verdade", "mentira esse desconto"],
    text: FAQ_PADRAO.preco,
  },
  {
    category: "Preço",
    name: "Tem taxa escondida",
    triggers: ["taxa escondida", "tem custo extra", "tem pegadinha", "letra miúda", "custo oculto", "tem surpresa na conta"],
    text: FAQ_PADRAO.preco,
  },
  {
    category: "Preço",
    name: "Vou pagar a mais no fim",
    triggers: ["vou pagar mais", "vai sair mais caro", "conta vai dobrar", "vai somar mais", "conta vai crescer"],
    text: FAQ_PADRAO.preco,
  },
  {
    category: "Preço",
    name: "Tarifa subir",
    triggers: ["se a tarifa subir", "tarifa vai subir", "bandeira vermelha", "reajuste da tarifa", "se aumentar a conta"],
    text: qa(
      "Boa, {{nome}}! 😊\n\nSe a tarifa da concessionária subir, sua *economia em reais aumenta* — porque o *desconto* é percentual sobre o valor da energia. ⚡\n\nVocê se protege do aumento. 🌱",
    ),
  },
  {
    category: "Preço",
    name: "Pagar pra entrar",
    triggers: ["pagar pra entrar", "tem adesão", "custo de adesão", "taxa de entrada", "tem mensalidade"],
    text: FAQ_PADRAO.preco,
  },

  // ── Cobrança ───────────────────────────────────────────────────────────
  {
    category: "Cobrança",
    name: "Cobrar duas vezes",
    triggers: ["cobrar duas vezes", "vão cobrar duas vezes", "conta dobrada", "duas faturas", "pagar em dobro"],
    text: qa(
      "Não é dobrado, {{nome}} 😊\n\nA conta da concessionária vem com *valor menor* (taxa de disponibilidade / impostos) e a fatura *iGreen* vem com a energia. ⚡\n\nSomando as duas, dá *menos* que antes. 🌱",
    ),
  },
  {
    category: "Cobrança",
    name: "Conta da concessionária",
    triggers: ["conta da concessionária", "conta da enel", "conta da cemig", "conta da light", "conta equatorial", "conta coelba", "conta neoenergia"],
    text: qa(
      "Continua chegando, {{nome}} 😊\n\nMas com *valor bem menor* (taxa de disponibilidade da rede e itens que não abatem). ⚡\n\nA energia em si passa a vir da *iGreen*, mais barata. 🌱",
    ),
  },
  {
    category: "Cobrança",
    name: "O que não abate na conta",
    triggers: [
      "o que não abate",
      "taxa de disponibilidade",
      "iluminação pública",
      "taxa cosip",
      "taxa de cosip",
      "desconto na conta toda",
      "abate na conta toda",
    ],
    text: qa(
      "Boa observação, {{nome}} 😊\n\nO *desconto* vale sobre a *energia consumida*. Itens como *taxa de disponibilidade* e *iluminação pública (COSIP)* continuam na fatura da concessionária. ⚡\n\nMesmo assim, no total do mês você paga *menos* — e o percentual fica claro no contrato. 🌱",
    ),
  },
  {
    category: "Cobrança",
    name: "Vencimento do boleto",
    triggers: ["quando vence o boleto", "data de vencimento", "qual o vencimento", "dia do vencimento"],
    text: qa(
      "Você escolhe o melhor dia, {{nome}}! 😊\n\nDia *5, 10, 15, 20 ou 25*. ⚡\n\nO boleto chega por *WhatsApp* e *e-mail* — simples e organizado. 🌱",
    ),
  },
  {
    category: "Cobrança",
    name: "Forma de pagamento",
    triggers: ["como posso pagar", "forma de pagamento", "aceita pix", "débito automático", "paga no cartão"],
    text: qa(
      "*Boleto*, *Pix* ou *débito automático*, {{nome}}! 😊\n\nVocê escolhe o que for melhor no cadastro. ⚡🌱",
    ),
  },
  {
    category: "Cobrança",
    name: "E se eu atrasar",
    triggers: ["e se eu atrasar", "se atrasar o pagamento", "multa por atraso", "juros por atraso"],
    text: qa(
      "Se atrasar, é como qualquer boleto: pequena multa de *2%* + juros de mora, {{nome}} 😊\n\nVocê recebe *lembretes* antes do vencimento pra não esquecer. ⚡🌱",
    ),
  },
  {
    category: "Cobrança",
    name: "Vão me negativar",
    triggers: ["vão me negativar", "vai pro serasa", "nome no spc", "nome sujo"],
    text: qa(
      "Só em caso de inadimplência prolongada (*90+ dias*), igual qualquer fatura, {{nome}} 😊\n\nPagando normal, *zero risco*. ⚡🌱",
    ),
  },
  {
    category: "Cobrança",
    name: "Cobrança após cancelar",
    triggers: [
      "cobrança após cancelar",
      "continuam cobrando",
      "cobraram depois de cancelar",
      "boleto depois do cancelamento",
      "fatura após cancelamento",
    ],
    text: qa(
      "Entendo a preocupação, {{nome}} 😊\n\nApós o cancelamento, o ciclo da fatura em andamento pode ainda gerar *um boleto do período* — depois encerra. ⚡\n\nSe aparecer cobrança indevida, o atendimento ajusta. Por isso o contrato deixa o cancelamento *sem multa* e *sem fidelidade*. 🌱",
    ),
  },

  // ── Técnico ────────────────────────────────────────────────────────────
  {
    category: "Técnico",
    name: "Trocar de empresa",
    triggers: ["trocar de empresa", "mudar de concessionária", "sair da enel", "trocar fornecedor"],
    text: FAQ_PADRAO.tecnico,
  },
  {
    category: "Técnico",
    name: "Mexer na fiação",
    triggers: ["mexer na fiação", "técnico em casa", "obra na minha casa", "instalação em casa", "vão instalar algo"],
    text: FAQ_PADRAO.tecnico,
  },
  {
    category: "Técnico",
    name: "E se faltar luz",
    triggers: ["se faltar luz", "e se faltar energia", "se tiver apagão", "ficar sem energia"],
    text: qa(
      "Faltou luz? Você liga pra *concessionária* igual antes, {{nome}} 😊\n\nA entrega da energia continua sendo dela. ⚡\n\nA *iGreen* só aplica o *desconto* na fatura. 🌱",
    ),
  },
  {
    category: "Técnico",
    name: "Placa solar / painel",
    triggers: ["placa solar", "painel no telhado", "instalar placa", "painel solar", "equipamento no telhado"],
    text: FAQ_PADRAO.tecnico,
  },
  {
    category: "Técnico",
    name: "Já tenho placa solar",
    triggers: [
      "já tenho placa",
      "já tenho painel",
      "já tenho solar",
      "já tenho energia solar",
      "tenho placa no telhado",
    ],
    text: qa(
      "Boa, {{nome}}! 😊\n\nSe você *já gera* com placa própria, o modelo de assinatura *pode não compensar* — depende do seu consumo e créditos. 🌱\n\nNo cadastro eu confiro se ainda faz sentido ou se é melhor manter só o seu sistema. ⚡",
    ),
  },
  {
    category: "Técnico",
    name: "E se eu mudar de casa",
    triggers: ["se eu mudar de casa", "mudança de endereço", "vou me mudar", "novo endereço"],
    text: qa(
      "Sem problema, {{nome}}! 😊\n\nSe ficar na mesma área de concessionária, a *iGreen* acompanha. 🌱\n\nSe mudar de estado, é só avisar — *sem multa*. ⚡",
    ),
  },
  {
    category: "Técnico",
    name: "Funciona pra apartamento",
    triggers: ["funciona em apartamento", "funciona no apartamento", "funciona em condomínio", "funciona no prédio"],
    text: FAQ_PADRAO.tecnico,
  },
  {
    category: "Técnico",
    name: "Funciona na minha cidade",
    triggers: [
      "atende na minha cidade",
      "atende minha região",
      "tem cobertura aqui",
      "tem cobertura na minha cidade",
      "funciona na minha cidade",
      "atendem na minha cidade",
      "moro em outra cidade",
      "sou de outra cidade",
      "cidade vizinha",
      "fora da cidade",
      "fora da região",
      "não atende minha cidade",
      "nao atende minha cidade",
      "não sou de uberlândia",
      "nao sou de uberlandia",
      "não moro em uberlândia",
      "nao moro em uberlandia",
      "só pra uberlândia",
      "so para uberlandia",
      "apenas uberlândia",
      "apenas uberlandia",
      "moro em araguari",
      "sou de araguari",
      "moro em uberaba",
      "sou de uberaba",
      "moro em patrocínio",
      "sou de patrocinio",
      "moro em ituiutaba",
      "sou de ituiutaba",
      "aqui em araguari",
      "aqui em uberaba",
      "aqui em uberlândia",
      "aqui em uberlandia",
    ],
    text: qa(
      "Tranquilo, {{nome}}! 😊\n\nO anúncio pode citar uma cidade, mas a *iGreen* atende pela *distribuidora* da sua conta (em Minas, por exemplo, *CEMIG*) — *cidade vizinha também entra*.\n\nNo cadastro a gente confirma na hora se sua região é elegível. É rapidinho 🌱⚡",
    ),
  },
  {
    category: "Técnico",
    name: "Mercado livre vs assinatura",
    triggers: [
      "mercado livre",
      "é mercado livre",
      "diferença mercado livre",
      "energia livre",
      "assinatura ou mercado livre",
    ],
    text: qa(
      "São coisas diferentes, {{nome}} 😊\n\n*Mercado livre* costuma ser para *empresas / alta demanda*. ⚡\n\nA *iGreen* (grupo residencial) é *energia por assinatura* / geração compartilhada: *sem obra*, *sem fidelidade*, desconto na conta de luz comum. 🌱",
    ),
  },

  // ── Cancelamento ───────────────────────────────────────────────────────
  {
    category: "Cancelamento",
    name: "Quanto demora pra começar",
    triggers: ["quando começa o desconto", "quanto demora pra começar", "prazo para começar", "demora pra ativar"],
    text: qa(
      "Em média, o *desconto* aparece entre *60 e 90 dias* após a ativação, {{nome}} — no ciclo seguinte da fatura. ⚡\n\nO cadastro em si leva uns *10 minutos* hoje. 😊🌱",
    ),
  },
  {
    category: "Cancelamento",
    name: "Fidelidade / multa",
    triggers: ["tem fidelidade", "contrato com multa", "fico amarrado", "prazo de contrato", "contrato preso", "pago multa para cancelar"],
    text: FAQ_PADRAO.cancelamento,
  },
  {
    category: "Cancelamento",
    name: "Posso cancelar quando quiser",
    triggers: ["posso cancelar quando quiser", "quero cancelar", "quero desistir", "quero encerrar"],
    text: FAQ_PADRAO.cancelamento,
  },
  {
    category: "Cancelamento",
    name: "Como faço pra cancelar",
    triggers: ["como faço pra cancelar", "como cancelar o contrato", "processo de cancelamento"],
    text: FAQ_PADRAO.cancelamento,
  },
  {
    category: "Cancelamento",
    name: "É difícil cancelar",
    triggers: [
      "é difícil cancelar",
      "não conseguem cancelar",
      "difícil de cancelar",
      "demora pra cancelar",
      "atendimento não responde",
    ],
    text: FAQ_PADRAO.cancelamento,
  },
  {
    category: "Cancelamento",
    name: "Quero desistir (7 dias)",
    triggers: ["direito de arrependimento", "arrependimento em 7 dias", "desistir em sete dias", "cancelar em 7 dias"],
    text: qa(
      "Tranquilo, {{nome}}! 😊\n\nVocê tem *7 dias de arrependimento* por lei (CDC). 🌱\n\nSó precisa avisar por escrito que cancela *sem nenhum custo*. ⚡",
    ),
  },
  {
    category: "Cancelamento",
    name: "Vou pensar / depois",
    triggers: ["vou pensar", "me fala depois", "te aviso depois", "vou ver com minha esposa", "vou ver com meu marido", "falo amanhã"],
    text: qa(
      "Claro, {{nome}}! 😊\n\nSem pressa — pensa com calma. 🌱\n\nQuando quiser retomar, é só me chamar aqui mesmo. ⚡\n\nSe já estiver decidido, dá pra continuar agora em poucos minutos.",
    ),
  },

  // ── Cadastro ───────────────────────────────────────────────────────────
  {
    category: "Cadastro",
    name: "Não vou mandar foto da conta",
    triggers: ["não vou mandar foto", "não mando foto da conta", "privacidade da conta", "não envio a conta"],
    text: FAQ_PADRAO.cadastro,
  },
  {
    category: "Cadastro",
    name: "Não vou mandar RG/CNH",
    triggers: ["não vou mandar documento", "não mando rg", "não mando cnh", "não envio identidade", "não mando doc"],
    text: FAQ_PADRAO.cadastro,
  },
  {
    category: "Cadastro",
    name: "Por que precisam do CPF",
    triggers: ["por que precisa do cpf", "por que pedem cpf", "dados pessoais meus", "privacidade dos dados"],
    text: FAQ_PADRAO.cadastro,
  },
  {
    category: "Cadastro",
    name: "E se vazarem meus dados",
    triggers: ["vão vazar meus dados", "medo de vazar dados", "segurança dos dados", "dados protegidos", "proteção lgpd"],
    text: FAQ_PADRAO.cadastro,
  },
  {
    category: "Cadastro",
    name: "Facial / OTP / assinatura",
    triggers: [
      "não consigo fazer a facial",
      "problema na facial",
      "código otp",
      "não recebi o otp",
      "assinatura digital",
      "biometria facial",
    ],
    text: qa(
      "Tranquilo, {{nome}} 😊\n\nA *validação facial* e o *código OTP* são etapas de segurança do portal — confirmam que é você o titular. ⚡\n\nSe travar, tente de novo em rede estável; se precisar, te guio no próximo passo. 🌱",
    ),
  },
  {
    category: "Cadastro",
    name: "Quero falar com humano",
    triggers: ["falar com humano", "quero um atendente", "falar com alguém", "quero uma pessoa", "falar com consultor", "falar com vendedor"],
    text:
      "Claro, {{nome}}! 😊\n\nVou chamar alguém do *time* pra te atender com calma. 🌱\n\nEm instantes te respondem por aqui 🙌\n\nSe preferir seguir pelo cadastro agora, é só dizer *pode seguir*. ⚡",
    isHandoff: true,
  },
  {
    category: "Cadastro",
    name: "Conhecer presencialmente",
    triggers: ["quero conhecer presencialmente", "posso ir no escritório", "reunião presencial", "ir até vocês", "atendimento presencial"],
    text: qa(
      "Tudo é *100% digital*, {{nome}}! 😊\n\nVocê resolve pelo *WhatsApp* — *sem sair de casa* e *sem ir a escritório*. 🌱\n\nExplico cada passo aqui e você acompanha tudo em tempo real. ⚡",
    ),
  },

  // ── Elegibilidade ──────────────────────────────────────────────────────
  {
    category: "Elegibilidade",
    name: "Conta mínima / valor mínimo",
    triggers: [
      "valor mínimo da conta",
      "conta mínima",
      "qual o valor mínimo",
      "conta muito baixa",
      "minha conta é baixa",
      "a partir de quanto",
    ],
    text: qa(
      "Em geral, a partir de cerca de *R$ 200/mês* já vale a pena analisar, {{nome}} 😊\n\nContas muito baixas têm mais custo fixo (disponibilidade / iluminação), então o *desconto* pesa menos. ⚡\n\nNo cadastro eu confirmo se sua conta encaixa. 🌱",
    ),
  },
  {
    category: "Elegibilidade",
    name: "Conta no nome de outro",
    triggers: [
      "conta no nome de outro",
      "outro titular",
      "conta no nome da minha mãe",
      "não sou o titular",
      "conta no nome do marido",
      "titular diferente",
    ],
    text: qa(
      "O cadastro precisa ser no *nome do titular* da conta de luz, {{nome}} 😊\n\nSe a conta estiver em outro nome, a ativação segue com os dados desse titular (CPF + documento). ⚡\n\nPosso te orientar no passo certo. 🌱",
    ),
  },
  {
    category: "Elegibilidade",
    name: "Casa alugada / não sou dono",
    triggers: [
      "casa alugada",
      "sou inquilino",
      "não sou dono",
      "moro de aluguel",
      "moro alugado",
      "imóvel alugado",
    ],
    text: qa(
      "Pode sim, {{nome}}! 😊\n\nComo *não tem obra* nem placa no telhado, funciona em casa alugada — desde que a *conta de luz* esteja no nome de quem vai assinar. 🌱⚡",
    ),
  },
];

export function formatIntentName(s: ObjectionShortcut): string {
  return `${s.category} · ${s.name}`;
}

export function parseIntentName(intentName: string): { category: ObjectionCategory | null; name: string } {
  const sep = " · ";
  const idx = intentName.indexOf(sep);
  if (idx < 0) return { category: null, name: intentName };
  const cat = intentName.slice(0, idx) as ObjectionCategory;
  return {
    category: OBJECTION_CATEGORIES.includes(cat) ? cat : null,
    name: intentName.slice(idx + sep.length),
  };
}

export function normalizeTriggerPhrase(phrase: string): string {
  return String(phrase || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function assertNoDuplicateTriggers(shortcuts: ObjectionShortcut[] = OBJECTION_SHORTCUTS): void {
  const seen = new Map<string, string>();
  for (const s of shortcuts) {
    for (const raw of s.triggers) {
      const key = normalizeTriggerPhrase(raw);
      if (!key) continue;
      const owner = formatIntentName(s);
      const prev = seen.get(key);
      if (prev && prev !== owner) {
        throw new Error(`Gatilho duplicado "${raw}" em "${prev}" e "${owner}"`);
      }
      seen.set(key, owner);
    }
  }
}

export const RESERVED_FLOW_KEYWORDS = [
  "sim", "não", "nao", "ok", "certo", "beleza", "vamos", "valor",
  "r$", "foto", "documento", "doc", "rg", "cnh", "cpf",
  // Genéricos que casam contexto errado se usados sozinhos no FAQ
  "fidelidade", "multa", "golpe", "furada", "depois", "sair", "data", "ap",
  "cobertura", "obra", "ativar", "link", "conta", "taxa", "solar", "pagar",
  "seguro", "prazo", "cancelar", "pix", "ceo", "dono", "aqui", "moro",
  "cidade", "ligar", "explica", "humano", "mentira", "scam", "aneel",
  "cnpj", "lgpd", "anos", "placa", "juros", "caro", "sede", "sócio",
  "enel", "cemig", "light", "spc", "cosip", "apagão", "piramide",
];

assertNoDuplicateTriggers();
