/**
 * Detector de auto-resposta corporativa no INBOUND (robô de outra empresa).
 *
 * Por que existe (auditoria 2026-08-05): 20 das 151 conversas dos últimos 7
 * dias (13%) não eram leads — eram URAs de outras empresas (imobiliárias,
 * despachantes, barbearia, pet shop, academia, clínica, contadora, corretoras).
 * O nosso bot respondia a elas, entrava no funil, gravava o nome da empresa
 * como nome do cliente e chegou a escalar um robô para atendimento humano.
 *
 * Caso extremo real (Conexão Corretora De Seguros, 2026-08-04):
 *   robô deles "selecione uma das opções" → nosso bot "informe seu primeiro nome"
 *   → robô deles "Não entendi, escolha uma das opções" → nosso bot "Sem pressa 🙂"
 *   → robô deles pediu nota de NPS → nosso bot mandou a abertura pela 3ª vez.
 *
 * Custo: queima cota anti-ban (o recurso mais escasso — cap global 200/dia),
 * polui a pizza do CRM e consome tempo do consultor.
 *
 * Regra de ouro deste módulo: preferir DEIXAR PASSAR a errar contra um lead
 * real. Só marcamos como robô com sinal corporativo inequívoco.
 */

/** Sinais inequívocos de auto-resposta corporativa. */
const SIGNALS: Array<{ id: string; re: RegExp }> = [
  // "A Farnese Seguros agradece seu contato", "LS DESPACHANTE agradece seu contato"
  // "agradece o seu contato" / "agradecemos pelo o seu contato" (typo comum em URA)
  { id: "agradece_contato", re: /agradec\w*\s+((o|pelo(\s+o)?)\s+)?seu\s+contato/i },
  // "Agradecemos sua mensagem. Não estamos disponíveis no momento"
  { id: "agradece_mensagem", re: /agradecemos\s+(a\s+)?sua\s+mensagem/i },
  { id: "indisponivel", re: /n[ãa]o\s+estamos\s+dispon[íi]ve/i },
  { id: "excesso_demanda", re: /n[ãa]o\s+podemos\s+atend[êe]?-?l[oa]/i },
  // Menus de URA
  { id: "menu_opcoes", re: /(selecione|escolha|digite)\s+(uma\s+)?d[ao]s?\s+op[çc][õo]es/i },
  { id: "menu_nao_entendi", re: /n[ãa]o\s+entendi,\s*escolha/i },
  { id: "menu_digite_n", re: /digite\s+[1-9]\s+(para|ou|-)/i },
  { id: "menu_opcao_n", re: /op[çc][ãa]o\s*[1-9]\b/i },
  // Pesquisa de satisfação (o robô deles avaliando o nosso bot)
  { id: "nps", re: /de\s+0\s+a\s+10\s+como\s+voc[êe]\s+avalia/i },
  { id: "nps_nota", re: /digite\s+uma\s+nota\s+v[áa]lida/i },
  // Boas-vindas de empresa: "Seja bem vindo a Prime Investimentos Imobiliários"
  { id: "boas_vindas_empresa", re: /seja\s+(muito\s+)?bem[-\s]?vind[oa](\s*\(\s*a\s*\))?\s+(a|ao|à|à\s+recep[çc][ãa]o\s+d[ae])\s+\S/i },
  // "bem vindo(a)" / "Bem-vindo (a)" — marca de texto automatizado
  { id: "bem_vindo_parenteses", re: /bem[-\s]?vind[oa]\s*\(\s*a\s*\)/i },
  // "Sou Leandro Nunes, corretor de imóveis" / "Sou a Kelly, consultora" —
  // apresentação profissional em auto-reply. Também evita que o extrator de
  // nome grave isso como `self_introduced` do lead.
  {
    id: "apresentacao_profissional",
    re: /\bsou\s+(a\s+|o\s+)?[A-ZÁ-Ú][^,.!?]{1,40},?\s*(corretor|corretora|despachante|contador|contadora|advogad|consultor|consultora|atendente|recepcionista)/i,
  },
  { id: "horario_atendimento", re: /hor[áa]rio\s+de\s+atendimento/i },
  { id: "fora_horario", re: /fora\s+do\s+(nosso\s+)?hor[áa]rio/i },
  { id: "retornaremos", re: /retornaremos\s+(o\s+)?seu\s+contato/i },
  { id: "aguarde_atendimento", re: /aguarde\s+que\s+j[áa]\s+(vou|ir[ei])\s+l?h?e?\s*atend/i },
  { id: "responderemos_breve", re: /responderemos\s+(o\s+)?(sua|seu|em)\s+/i },
  { id: "msg_automatica", re: /(esta|essa)\s+[ée]\s+uma\s+mensagem\s+autom[áa]tica|mensagem\s+autom[áa]tica/i },

  // ─── 2ª rodada (varredura de 4.184 mensagens, 2026-08-05) ────────────────
  // 27 auto-respostas do histórico escapavam das assinaturas acima. Uma delas
  // era o robô da PRÓPRIA Velip ("Eu sou a Vel") conversando com o nosso bot.

  // "Obrigado pelo contato. Caso necessite, estarei à disposição."
  // CUIDADO: um lead educado também escreve "obrigado pelo contato" e não pode
  // ser marcado como robô. Por isso exigimos companhia corporativa na mesma
  // mensagem (à disposição / caso necessite / nossa equipe / horário).
  {
    id: "obrigado_pelo_contato",
    re: /obrigad[oa]\s+pel[oa]s?\s+(contato|mensagem|retorno)[\s\S]{0,80}(à\s+disposi[çc][ãa]o|a\s+disposi[çc][ãa]o|caso\s+necessite|caso\s+precise|nossa\s+equipe|nosso\s+time|hor[áa]rio)/i,
  },
  // "Eu sou a Vel, assistente virtual da Velip" / "Sou assistente virtual da DM"
  { id: "assistente_virtual", re: /assistente\s+(virtual|digital)/i },
  // "Deixe sua nota de 1 a 5 para o atendimento" (pesquisa deles, não nossa)
  { id: "pesquisa_nota", re: /(nota|avalia[çc][ãa]o)\s+de\s+\d\s+a\s+\d/i },
  { id: "opiniao_atendimento", re: /(queremos|gostar[íi]amos\s+de)\s+saber\s+(a\s+)?sua\s+opini[ãa]o/i },
  // "Espere um instante, vou chamar um consultor para falar com você"
  { id: "vai_chamar_atendente", re: /(vou|irei)\s+(chamar|transferir|acionar)\s+(um|uma|o|a)\s+(consultor|atendente|especialista|respons[áa]vel)/i },
  { id: "transferir_atendimento", re: /posso\s+te\s+transferir|transferir\s+(agora\s+)?(mesmo\s+)?para/i },
  // "Seu atendimento será encerrado por inatividade nos próximos minutos"
  { id: "encerrado_inatividade", re: /encerrad[oa]\s+por\s+inatividade|por\s+inatividade\s+nos?\s+pr[óo]xim/i },

  // ─── 3ª rodada (replay de 3.485 mensagens, 2026-08-05) ───────────────────
  // Divulgação ativa de OUTRA empresa caindo no nosso número: não é URA de
  // ausência, é oferta comercial. O bot respondia normalmente e queimava cota.
  // Todos exigem marca que um lead de energia nunca escreve.

  // "Para efetuar seu pedido clique no link abaixo"
  { id: "pedido_link", re: /para\s+(efetuar|finalizar|concluir|fazer)\s+(o\s+)?seu\s+pedido/i },
  { id: "clique_link_abaixo", re: /clique\s+n[oa]\s+link\s+abaixo/i },
  // "Somos a MP Empréstimos Pouso Alegre. Trabalhamos com Empréstimos no Cartão…"
  {
    id: "divulgacao_empresa",
    re: /\bsomos\s+(a|o)\s+\S[^,.!?\n]{2,50}[\s\S]{0,150}\btrabalhamos\s+com\b/i,
  },
  // Oferta de crédito/consórcio — o lead pede desconto na luz, não oferece crédito.
  {
    id: "oferta_credito",
    re: /\btrabalhamos\s+com\b[\s\S]{0,100}(empr[ée]stimo|consignado|fgts|cart[ãa]o\s+de\s+cr[ée]dito|cons[óo]rcio|financiamento)/i,
  },
];

export type AutoResponderVerdict =
  | { isAutoResponder: false }
  | { isAutoResponder: true; signal: string };

/**
 * Classifica um texto de INBOUND. Só usar em mensagem recebida — o nosso
 * próprio outbound tem frases parecidas de boas-vindas.
 */
export function detectAutoResponder(text: string | null | undefined): AutoResponderVerdict {
  const t = String(text ?? "").trim();
  if (t.length < 12) return { isAutoResponder: false };
  for (const s of SIGNALS) {
    if (s.re.test(t)) return { isAutoResponder: true, signal: s.id };
  }
  return { isAutoResponder: false };
}

/** Atalho booleano para gates. */
export function isAutoResponderText(text: string | null | undefined): boolean {
  return detectAutoResponder(text).isAutoResponder;
}

/** Razão canônica de pausa — use sempre esta string para dar para rastrear. */
export const AUTO_RESPONDER_PAUSE_REASON = "auto_responder_detected";
