// Templates V2 — fallbacks determinísticos + validador estrutural.
import type { Etapa } from "./types.ts";

export const TRAVA_POR_ETAPA: Record<Etapa, string> = {
  interesse: "Faça a ABERTURA: apresentação curta + benefício (pagar menos sem obra) + pergunte 'posso te chamar como?'. PROIBIDO pedir valor/foto/doc/e-mail.",
  nome: "Pergunte o NOME do lead. 1 pergunta. PROIBIDO pedir outra coisa.",
  valor: "Pergunte o VALOR MÉDIO DA CONTA EM R$. PROIBIDO pedir foto/doc/e-mail nem dar simulação ainda.",
  simulacao: "Apresente faixa *8% a 20%* + número (valor × 0,20) + pergunta consultiva tipo 'faz sentido?'. PROIBIDO pedir foto/doc/e-mail.",
  consideracao: "O lead JÁ viu a simulação. RESPONDA DIRETAMENTE a dúvida/objeção específica que ele acabou de fazer (use a FAQ/contexto), em 1-2 linhas, com informação concreta — NÃO responda de forma genérica nem repita a mesma frase do turno anterior. Feche com ponte NEUTRA (ex.: 'Qualquer outra dúvida, é só perguntar.'). PROIBIDO pedir cadastro/ativar em toda resposta. PROIBIDO pedir foto/conta/doc/e-mail — só peça quando o lead disser claramente que quer cadastrar/fechar.",
  foto_conta: "Peça a foto da conta de luz 📷. PROIBIDO pedir doc/e-mail.",
  doc: "Peça a foto da frente do RG ou CNH 📄. PROIBIDO pedir e-mail.",
  email: "Peça o e-mail do lead 📧. PROIBIDO pedir outras coisas.",
  finalizando: "Confirme os dados de forma curta e diga que vai finalizar.",
  pos_cadastro: "Agradeça e diga que vai mandar os próximos passos. PROIBIDO pedir mais dados.",
};

// Variantes por etapa — usadas quando a vendedora reperguntar a mesma coisa,
// pra não soar robótica repetindo a frase exata. `tentativa` é state.tentativas_etapa.
const VARIANTES_NOME = [
  "Pra eu te atender direitinho, qual o seu nome?",
  "Antes da gente seguir, *como posso te chamar*?",
  "Me diz só o seu *nome completo* que eu já adianto aqui 😊",
  "Pra personalizar o atendimento: qual seu nome?",
];
const VARIANTES_VALOR = [
  "Qual o *valor médio* da sua conta de luz?",
  "Mais ou menos quanto vem a sua conta de luz por mês? (em R$)",
  "Quanto você costuma pagar de energia mensalmente?",
];
const VARIANTES_FOTO_CONTA = [
  "Me manda a *foto da sua conta de luz* 📷",
  "Pra eu avançar, *envia uma foto da sua conta de luz* (qualquer página serve) 📷",
  "Só preciso da *foto da sua conta de luz* pra confirmar os dados 📷",
];
const VARIANTES_DOC = [
  "Agora preciso da foto da *frente do seu RG ou CNH* 📄",
  "Pra continuar: *foto da frente do seu documento* (RG ou CNH) 📄",
  "Me envia a *frente do RG ou CNH* pra eu validar 📄",
];
const VARIANTES_EMAIL = [
  "Pra finalizar, qual o seu melhor *e-mail* 📧?",
  "Só falta o *e-mail* pra fechar — qual você usa? 📧",
  "Me passa o seu *e-mail* que eu já termino aqui 📧",
];

function pick<T>(arr: T[], i: number): T {
  return arr[Math.max(0, i | 0) % arr.length];
}

export function fallbackPorEtapa(etapa: Etapa, nome?: string | null, valor?: number | null, tentativa = 0): string {
  const n = nome ? `, *${nome}*` : "";
  switch (etapa) {
    case "interesse": return `Olá! 😊 Aqui é da *iGreen Energy*. Você passa a pagar *menos* todo mês na conta de luz, sem obra e sem trocar de distribuidora ⚡\nPosso te chamar como?`;
    case "nome":      return pick(VARIANTES_NOME, tentativa);
    case "valor":     return `${nome ? `Show${n}! ` : ""}${pick(VARIANTES_VALOR, tentativa)}`;
    case "simulacao": {
      const eco = valor ? ` Daria cerca de *R$ ${(valor * 0.2).toFixed(0)}/mês* de economia.` : "";
      return `${nome ? `${nome}, com base no seu valor, ` : "Com base no seu valor, "}o desconto fica *entre 8% e 20%* ao mês ⚡${eco}\nFaz sentido pra você?`;
    }
    case "consideracao": {
      const eco = valor ? `*R$ ${(valor * 0.2).toFixed(0)}/mês*` : "uma boa economia";
      return `${nome ? `${nome}, ` : ""}é tudo *sem obra* e regulamentado pela *ANEEL* — a mesma conta, só com ${eco} a menos.\n\nQualquer outra dúvida, é só perguntar.`;
    }
    case "foto_conta":  return `${nome && tentativa === 0 ? `Perfeito${n}! ` : ""}${pick(VARIANTES_FOTO_CONTA, tentativa)}`;
    case "doc":         return pick(VARIANTES_DOC, tentativa);
    case "email":       return pick(VARIANTES_EMAIL, tentativa);
    case "finalizando": return `${nome ? `${nome}, ` : ""}tá tudo certo pra finalizar seu cadastro. Posso seguir?`;
    case "pos_cadastro":return `Cadastro feito${n}! Em breve te mando os próximos passos ✅`;
  }
}


/** Validador estrutural barato — pega problemas óbvios sem chamar LLM. */
export function validarResposta(texto: string, etapa: Etapa, nomeLead: string | null): { ok: boolean; motivo?: string } {
  const t = String(texto || "").trim();
  if (!t) return { ok: false, motivo: "vazio" };
  if (t.length > 600) return { ok: false, motivo: "longo" };
  const linhas = t.split("\n").filter((l) => l.trim()).length;
  if (linhas > 4) return { ok: false, motivo: "muitas_linhas" };
  if (/\b(te ligo|te retorno|volto amanh|envio um v[ií]deo|mando o link|mando o pdf)\b/i.test(t)) {
    return { ok: false, motivo: "promessa_proibida" };
  }
  if (/como posso te ajudar|me conta mais|estou [aà] disposi/i.test(t)) {
    return { ok: false, motivo: "frase_proibida" };
  }

  // Travas por etapa — heurística simples mas eficaz
  if (etapa === "nome" && !/\?$|\?\s/m.test(t)) return { ok: false, motivo: "nome_sem_pergunta" };
  if (etapa === "valor" && !/valor|conta|r\$|quanto|paga/i.test(t)) return { ok: false, motivo: "valor_fora_de_tema" };
  if (etapa === "simulacao" && !/8\s*%|20\s*%|desconto|economia|r\$/i.test(t)) return { ok: false, motivo: "simulacao_sem_numero" };
  if (etapa === "consideracao" && /\b(foto|conta de luz|fatura|rg|cnh|documento)\b/i.test(t) && /(envi|mand|manda|me\s+pass)/i.test(t)) {
    return { ok: false, motivo: "consideracao_pediu_midia_cedo" };
  }
  if (etapa === "foto_conta" && !/foto|conta|📷|imagem/i.test(t)) return { ok: false, motivo: "foto_fora_de_tema" };
  if (etapa === "doc" && !/rg|cnh|documento|📄/i.test(t)) return { ok: false, motivo: "doc_fora_de_tema" };
  if (etapa === "email" && !/e-?mail|📧|@/i.test(t)) return { ok: false, motivo: "email_fora_de_tema" };

  // Usa nome se tem histórico
  if (nomeLead && etapa !== "interesse" && !new RegExp(nomeLead.split(/\s+/)[0], "i").test(t)) {
    // Não bloqueia — só penaliza, mas mantém ok=true (handler pode reescrever)
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Matcher de objeções/dúvidas para a etapa CONSIDERAÇÃO.
// Rede determinística: reconhece a pergunta específica do lead e devolve uma
// resposta CORRETA e ESPECÍFICA + convite ao cadastro. Usado como fallback
// robusto quando o LLM/RAG falha ou repete. Garante que cada dúvida tenha
// resposta de tema correto, sem repetir a frase anterior.

export type ObjecaoTipo =
  | "golpe" | "obra" | "fidelidade" | "solar" | "distribuidora" | "aluguel"
  | "outra_empresa" | "boleto" | "prazo" | "cobertura" | "cancelar"
  | "taxa_adesao" | "conta_baixa" | "como_ganham" | "pensar"
  | "como_funciona" | "foto_antes" | "desistencia"
  | "pedido_humano" | "titularidade" | "cnpj" | "homologacao_aneel" | "pedido_recap"
  | "generica";

export function classificarObjecao(texto: string): ObjecaoTipo {
  const t = String(texto || "").toLowerCase();
  // Ordem importa: padrões mais específicos primeiro.
  // Pedido de humano — top prioridade, sempre escala.
  if (/\b(humano|pessoa de verdade|gente de verdade|algu[ée]m de verdade|atendente|consultor(?:a)? humano|n[ãa]o (?:é )?bot|nao bot|n[ãa]o quero bot|falar com (?:algu[ée]m|gente|pessoa|humano|atendente)|quero (?:um|uma)?\s*humano|quero falar com algu[ée]m)\b/.test(t)) return "pedido_humano";
  // Desistência: SÓ intenções explícitas de sair. Frases interrogativas
  // (terminam com "?" ou começam com palavra-pergunta) NUNCA são desistência.
  // "não quero/precisa/tem X" onde X é palavra positiva (obra, multa,
  // fidelidade…) é OBJEÇÃO, não saída — não dispara desistência.
  const ehPergunta = t.includes("?") || /^(como|qual|quais|quando|quanto|onde|quem|por\s*qu[êe]|porque|tem|t[êe]m|vai|v[ãa]o|posso|preciso|precisa|d[áa]\s*pra|d[áa]\s*para|e\s+se|vem)\b/.test(t);
  const negacaoSeguidaDeBeneficio = /\bn[ãa]o (?:quero|tenho|preciso|vou|vai|tem|gosto)\b[^.?!\n]{0,40}\b(obra|placa|painel|instala|t[ée]cnico|equipamento|multa|fidelidade|car[êe]ncia|taxa|mensalidade|boleto|complica[çc]|enrolar?|risco|surpresa|pegadinha|nada disso|amarra)/.test(t);
  if (!ehPergunta && !negacaoSeguidaDeBeneficio) {
    if (/^(tchau|xau|chau|flw|falou|valeu por nada)\b/.test(t)
      || /\b(n[ãa]o tenho interesse|desisti|desisto|mudei de id[eé]ia|deixa pra l[áa]|deixa quieto|pode parar|chega disso|sai fora|esquece(?:r)?|melhor n[ãa]o|fica pra (?:outra|depois)|outra hora|n[ãa]o vai dar|n[ãa]o vou querer|n[ãa]o me interessa|valeu(?:,?\s*mas)?\s+(?:n[ãa]o|melhor)|n[ãa]o quero (?:n[ãa]o|mais|isso|saber)|n[ãa]o quero\s*$)\b/.test(t)) return "desistencia";
  }
  if (/(posso|d[áa] (?:pra|para))\s+(j[áa]\s+)?(mandar|enviar|passar|tirar)\s+(a\s+|uma\s+)?(foto|conta|fatura|imagem|print)/.test(t)
    || /(j[áa]\s+)?(te\s+)?mando\s+(j[áa]\s+)?(a\s+)?(foto|conta|fatura)/.test(t)
    || /(manda|envia)\s+(l[áa]\s+|j[áa]\s+|a[ií]\s+)?(a\s+|uma\s+)?(foto|conta|fatura)/.test(t)
    || /vou\s+(te\s+)?(mandar|enviar)\s+(a\s+|uma\s+)?(foto|conta|fatura)/.test(t)
    || /(posso|d[áa] (?:pra|para))\s+(j[áa]\s+)?mandar\s+a?gora/.test(t)) return "foto_antes";
  // Recap / pedido de re-explicação curto
  if (/\b(me explica (?:de novo|denovo|outra vez|melhor)|explica (?:de novo|denovo|outra vez|melhor|rapid)|de novo rapid|repete|repetir|recapitula|resume (?:pra mim|isso|de novo)|me lembra (?:como|de novo)|como funciona mesmo)\b/.test(t)) return "pedido_recap";
  if (/^e?\s*como funciona\??$|^como (?:que )?funciona\b|me explica (?:como|isso)|do que se trata|do que (?:que )?se trata|n[ãa]o entendi/.test(t)) return "como_funciona";
  // Titularidade do contrato (no nome de quem fica, dono x inquilino)
  if (/\b(nome de quem|no meu nome|no nome do (?:dono|propriet|titular)|titularidade|titular(?:idade)? (?:da )?conta|contrato (?:em|no) nome|do propriet[áa]rio|do dono|do inquilin|do locador|do locat)\b/.test(t)) return "titularidade";
  if (/aluguel|alugad|inquilin|mudar de casa|mudar de im[óo]vel|se eu mudar|quando eu mudar|quando mudar|se mudar|trocar de casa|n[ãa]o (?:é|eh) min(?:ha|h)a casa/.test(t)) return "aluguel";
  if (/conta (?:for |fica |é |eh )?baixa|conta baixa|conta pequena|conta de \w+ reais|conta (?:é |eh )?s[óo] (?:de )?\d|s[óo] (?:r\$\s*)?\d{2,3}(?!\d)|m[êe]s mais baixo|gasto pouco|consumo baixo|n[ãa]o vale a pena|vale a pena|d[áa] quase nada|pouca coisa|compensa(?:r)?(?:\s|$|\?)/.test(t)) return "conta_baixa";
  if (/taxa|ades[ãa]o|cobra(?:m|r)? (?:algo|alguma|taxa|pra)|pagar (?:pra|para) entrar|investiment|mensalidade|custo (?:pra|para|de) entrar|tem custo/.test(t)) return "taxa_adesao";
  if (/boleto|fatura|mesmo? (?:boleto|conta)|onde pago|como pago|dois boleto|vem.*\bboleto|vai vir.*\bboleto|chega(?:m|r).*\bboleto|atras(?:ar|o) o pagamento|pagar (?:a conta|onde)/.test(t)) return "boleto";
  if (/fidelidade|multa|car[êe]ncia|preso|amarrad|tempo de contrato|fica preso/.test(t)) return "fidelidade";
  if (/cancelar|sair (?:quando|a qualquer)|desistir|parar quando/.test(t)) return "cancelar";
  // CNPJ específico
  if (/\bcnpj\b|raz[ãa]o social|tem (?:um )?cadastro|registro (?:da )?empresa/.test(t)) return "cnpj";
  // Homologação ANEEL específica
  if (/homologa(?:[çc][ãa]o|d[oa]|r)\s*(?:n[oa])?\s*aneel|aneel.*homolog|registro (?:na )?aneel|lei 14\.?300|garantia escrit/.test(t)) return "homologacao_aneel";
  if (/golpe|pir[âa]mide|enganad|furad|confi[áa]vel|seguro|é verdade|pegadinha|bom demais|nunca ouvi|medo|receio|cilada|quebrar|falir|sair do mercado|fechar as portas/.test(t)) return "golpe";
  if (/\bobra\b|reforma|instala|placa|painel|t[ée]cnico|equipamento|mexer (?:na|em) (?:casa|telhado)|mexer.{0,20}(?:fia[çc]|fio)|fia[çc][ãa]o/.test(t)) return "obra";
  if (/solar|painel solar|energia do sol/.test(t)) return "solar";
  if (/distribuidora|trocar de (?:empresa|distribuidora)|mudar de (?:empresa|distribuidora|companhia)|enel|cemig|cpfl|light|equatorial|neoenergia/.test(t)) return "distribuidora";
  if (/outra empresa|[óo]rigo|sun mobi|energisol|j[áa] tenho desconto|concorr|diferen[çc]a de voc[êe]s|diferen[çc]a de vcs|qual a diferen/.test(t)) return "outra_empresa";
  if (/quanto tempo|prazo|demora|quando come[çc]|ativa[çr]|leva quanto/.test(t)) return "prazo";
  if (/atende (?:em|na|aqui|minha|meu)|cobertura|minha cidade|meu estado|funciona (?:em|na|aqui|na minha)|cobre (?:minha|aqui)/.test(t)) return "cobertura";
  if (/como (?:voc[êe]s|vcs) ganha|de onde vem|qual o lucro|o que (?:voc[êe]s|vcs) ganha|onde t[áa] o ganho/.test(t)) return "como_ganham";
  if (/pensar|depois|mais tarde|vou ver|talvez|n[ãa]o sei|deixa eu ver/.test(t)) return "pensar";
  return "generica";
}

/**
 * Detector: lead AFIRMA ter enviado mídia (foto/conta) — usado em foto_conta
 * quando `midia_recebida.conta` é false. Frases típicas: "mandei aí", "ja
 * mandei", "segue a foto", "vê se chegou", "tá na mão, mando agora".
 */
export function leadAfirmaEnvio(texto: string): boolean {
  const t = String(texto || "").toLowerCase().trim();
  if (!t) return false;
  if (/\b(mandei|enviei|j[áa] (?:te )?(?:mandei|enviei)|t[oô] mandando|estou mandando|segue (?:a |aí )?(?:foto|conta|fatura|imagem)|t[áa] (?:a[ií]|na m[ãa]o)|chegou (?:a[ií]|pra )?(?:foto|conta|voc[êe])?|olha (?:a[ií]|nas mensagens)|ve(?:r|ja)? se chegou|ve(?:r|ja)? se ficou|n[ãa]o (?:apareceu|chegou) (?:a[ií]|pra)|bugou|mandando (?:de novo|outra vez)|envio agora|tirei (?:a |uma )?foto)\b/.test(t)) {
    return true;
  }
  return false;
}

/** Capitaliza primeiro nome (e sobrenome curto se houver). "bruno" → "Bruno". */
export function prettyName(s: string | null | undefined): string | null {
  const raw = String(s || "").trim();
  if (!raw) return null;
  return raw
    .split(/\s+/)
    .slice(0, 3)
    .map((w) => (w.length <= 2 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

/** Resposta determinística pra quando o lead pede falar com humano. */
export function respostaPedidoHumano(nome: string | null): string {
  return `Claro${nome ? `, *${nome}*` : ""}! Vou chamar um(a) atendente humano(a) aqui pra continuar com você. Aguarda um instante 🙌`;
}

/**
 * Normaliza o nome do consultor pra abertura. Se vier um handle (username
 * com dígito ou sem espaço como "tvmensal22"), devolve null pra omitir a
 * apresentação "Sou a X" — fica só "Aqui é da iGreen Energy".
 */
export function sanitizeConsultantName(raw: string | null | undefined): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  // sem espaço E (com dígito ou tudo minúsculo) → parece handle
  if (!/\s/.test(s) && (/\d/.test(s) || /^[a-z_]+$/.test(s))) return null;
  // Caracteres não-humanos
  if (/[@._\-]/.test(s) && !/\s/.test(s)) return null;
  return s;
}

/**
 * Detector determinístico: o lead está fazendo uma PERGUNTA/objeção em vez
 * de responder o que a etapa pediu? Roda nas etapas mecânicas (nome, valor,
 * foto_conta, doc, email) — se for true, respondemos a dúvida antes de
 * reancorar a pergunta da etapa.
 */
export function leadFezPergunta(inbound: string, etapa: Etapa): { pergunta: boolean; tipo: ObjecaoTipo } {
  const t = String(inbound || "").trim();
  if (!t || t.length < 2) return { pergunta: false, tipo: "generica" };
  const low = t.toLowerCase();

  // Mídia recebida não conta como pergunta
  if (/^\[(envia|imagem|foto|m[íi]dia)/i.test(t)) return { pergunta: false, tipo: "generica" };

  // 1) Classificador já cobre desistência/foto_antes/como_funciona e objeções nominais
  const tipo = classificarObjecao(low);
  if (tipo !== "generica") return { pergunta: true, tipo };

  // 2) Heurística genérica: tem '?' ou começa com interrogativo
  const hasQM = t.includes("?");
  const interro = /^(como|quanto|quando|qual|quais|onde|quem|por\s*qu[êe]|porque|tem|t[êe]m|vai|v[ãa]o|posso|preciso|precisa|d[áa]\s*pra|d[áa]\s*para|e\s+se|vem|cobra|paga|funciona|serve)\b/i;
  if (hasQM || interro.test(low)) {
    return { pergunta: true, tipo: "generica" };
  }

  // 3) Em etapas onde a resposta esperada é estruturada (nome/valor/email),
  //    se a mensagem é frase longa fora-de-forma, tratamos como dúvida genérica
  //    em vez de só repetir o template. (mais conservador: só se >= 3 palavras)
  const palavras = low.split(/\s+/).filter(Boolean).length;
  if ((etapa === "valor" || etapa === "email") && palavras >= 4 && !/\d/.test(low) && !/@/.test(low)) {
    return { pergunta: true, tipo: "generica" };
  }

  return { pergunta: false, tipo: "generica" };
}

/**
 * Responde a dúvida do lead em 1 frase + reancora a pergunta da etapa.
 * Usado em etapas mecânicas quando o lead pergunta em vez de responder.
 */
export function respostaPerguntaCurta(
  tipo: ObjecaoTipo,
  nome: string | null,
  etapa: Etapa,
  valor: number | null,
  tentativa: number,
  objecoesTratadas: string[] = [],
): string {
  const variantes = RESP_OBJECAO_VARIANTES[tipo] || RESP_OBJECAO_VARIANTES.generica;
  // Quantas vezes essa MESMA dúvida já apareceu → escolhe variante diferente
  const jaVista = objecoesTratadas.filter((o) => o === tipo).length;
  let resp = variantes[jaVista % variantes.length];
  if (jaVista >= 1) {
    const prefixos = ["como te falei, ", "reforçando: ", "só pra deixar claro de novo: "];
    resp = prefixos[(jaVista - 1) % prefixos.length] + resp;
  }

  // Reancora com a pergunta da etapa — limpando saudação ("Show, X!") pra não
  // ficar "X, sem fidelidade. Show, X! Qual o valor..."
  const ask = fallbackPorEtapa(etapa, nome, valor, tentativa)
    .replace(/^(Show|Perfeito|Ótimo|Oi)[^!?\n]*[!]\s*/i, "");

  const corpo = nome ? `${nome}, ${resp}` : resp.charAt(0).toUpperCase() + resp.slice(1);
  return `${corpo}\n${ask}`;
}

/** Despedida educada quando o lead desiste em qualquer etapa. */
export function respostaDespedida(nome: string | null): string {
  return `Tudo bem${nome ? `, *${nome}*` : ""}! Qualquer hora que quiser economizar é só me chamar por aqui 😊⚡`;
}

// Cada objeção tem 2-3 variantes. Quando o lead repete a mesma dúvida, o
// sistema escolhe uma variante DIFERENTE (em vez de repetir o mesmo texto).
const RESP_OBJECAO_VARIANTES: Record<ObjecaoTipo, string[]> = {
  golpe: [
    "super justo perguntar! A *iGreen* é homologada pela *ANEEL* (Lei 14.300) — você continua com a mesma distribuidora, só com o desconto na fatura.",
    "pode ficar tranquilo: a iGreen tem *CNPJ ativo* e é fiscalizada pela *ANEEL*. Já são centenas de milhares de clientes economizando.",
    "nada de golpe — você *não paga nada a mais* e continua recebendo a conta da sua distribuidora normalmente, só com o abatimento.",
  ],
  obra: [
    "nada de obra! *Sem placa, sem técnico, sem mexer na sua casa*. O desconto entra direto na fatura ⚡",
    "não precisa instalar nada — *zero obra, zero equipamento*. É só um cadastro e o desconto passa a aparecer na conta.",
  ],
  fidelidade: [
    "fica tranquilo: *sem fidelidade e sem multa* — você pode sair quando quiser, sem pegadinha.",
    "não tem amarração: *sem contrato de permanência e sem multa*. Se quiser sair, é só avisar.",
  ],
  solar: [
    "é energia limpa de fazendas solares da iGreen, mas *sem instalar nada na sua casa*. O crédito vem direto pra sua conta.",
    "a energia vem das *usinas solares da iGreen* — você usa o crédito sem placa nenhuma no seu telhado.",
  ],
  distribuidora: [
    "você *não troca de distribuidora* nem de fiação. Tudo continua igual, só entra o desconto na fatura.",
    "sua distribuidora continua *exatamente a mesma* — a iGreen só aplica o desconto por cima da sua conta.",
  ],
  aluguel: [
    "funciona normal em imóvel alugado — *quem paga a conta é quem recebe o desconto*. Se mudar, a gente transfere.",
    "mesmo de aluguel dá certo: o desconto fica *no seu nome*, e se você mudar é só transferir o cadastro.",
  ],
  outra_empresa: [
    "o nosso é regulamentado pela *ANEEL*, sem obra e sem fidelidade. Dá pra comparar e ver se sobra mais economia pra você.",
    "vale comparar: muita gente troca pra iGreen por ser *sem fidelidade* e ter desconto direto na fatura.",
  ],
  boleto: [
    "continua *a mesma conta da sua distribuidora*, com o desconto já aplicado — sem boleto novo, sem confusão.",
    "você não recebe boleto extra: o desconto vem *na própria fatura* que você já paga hoje.",
  ],
  prazo: [
    "depois do cadastro aprovado, a economia começa a aparecer na fatura em torno de *30 a 60 dias*.",
    "em geral *1 a 2 ciclos de fatura* após a aprovação você já vê o desconto na conta.",
  ],
  cobertura: [
    "a iGreen atende em *21 estados*. Pelo seu cadastro eu já confirmo se cobre sua região, sem compromisso.",
    "a cobertura já passa de *21 estados* — fazendo o cadastro eu confirmo na hora se atende aí.",
  ],
  cancelar: [
    "pode cancelar *quando quiser, sem multa*. Você não fica preso a nada.",
    "o cancelamento é *livre e sem custo* — você decide a hora de sair, sem burocracia.",
  ],
  taxa_adesao: [
    "*não tem taxa de adesão nem mensalidade* — o cadastro é gratuito. Você só passa a pagar menos.",
    "é *100% gratuito* pra entrar — nenhuma taxa, nenhuma mensalidade. Você só economiza.",
  ],
  conta_baixa: [
    "pra contas a partir de *R$ 200* já compensa. Quanto maior a conta, maior a economia no fim do mês.",
    "mesmo em meses mais baixos vale: o desconto é *proporcional ao consumo*, então sempre sobra economia.",
  ],
  como_ganham: [
    "a iGreen ganha uma parte do que a fazenda solar gera — por isso consegue te dar desconto *sem te cobrar nada a mais*.",
    "o modelo é simples: a usina gera energia, você usa o crédito com desconto, e a iGreen ganha pela geração — *sem custo pra você*.",
  ],
  pensar: [
    "tranquilo pensar! Mas o cadastro é *gratuito e sem compromisso* — você só começa a economizar, sem risco.",
    "sem pressa! Como não tem custo nem fidelidade, dá pra começar *sem risco nenhum* e ver na prática.",
  ],
  generica: [
    "boa pergunta! É tudo *sem obra, sem fidelidade e regulamentado pela ANEEL* ⚡",
    "ótima dúvida — o resumo é: *economia na fatura, sem obra e sem amarração*. Posso te explicar qualquer ponto.",
  ],
  como_funciona: [
    "funciona assim: você continua com a mesma distribuidora, e a iGreen aplica um *desconto direto na sua fatura* — sem obra, sem instalar nada.",
    "é simples: a gente conecta sua conta a uma *usina solar parceira*, e o desconto cai todo mês na sua própria fatura.",
  ],
  foto_antes: [
    "pode mandar a foto sim! 📷",
    "claro, manda a foto que eu já confiro aqui 📷",
  ],
  desistencia: [
    "tudo bem! Sem pressão.",
  ],
  pedido_humano: [
    "vou te transferir pra um atendente humano agora mesmo.",
  ],
  titularidade: [
    "o contrato fica *no nome de quem paga a conta de luz hoje* — independente de ser dono ou inquilino. É o titular da fatura.",
    "vai no seu nome se for você quem paga a conta. Não precisa autorização do dono do imóvel.",
  ],
  cnpj: [
    "a iGreen Energy tem *CNPJ 35.704.770/0001-30*, empresa ativa e regularizada na Receita Federal.",
  ],
  homologacao_aneel: [
    "sim — a iGreen é *homologada pela ANEEL* dentro da Lei 14.300/2022, que regulamenta a geração distribuída no Brasil.",
    "tudo certinho com a ANEEL: operamos sob a *Lei 14.300/2022*, com registro ativo de geração compartilhada.",
  ],
  pedido_recap: [
    "rapidinho: você continua com a *mesma distribuidora* (Enel, Cemig, etc.), e a gente aplica um *desconto de 8% a 20%* direto na sua fatura. Sem obra, sem fidelidade.",
    "resumindo: *zero obra, zero mensalidade* — só um cadastro e o desconto passa a vir na própria conta que você já paga.",
  ],
};

// Fechamentos profissionais após tirar dúvida (anti-insistência).
// Padrão: ponte neutra. Só a partir da 3ª tentativa oferece convite leve
// ao próximo passo — nunca "quer cadastrar?" em toda resposta.
const FECHAMENTOS_NEUTROS = [
  "Qualquer outra dúvida, é só perguntar.",
  "Se quiser seguir, é só escolher uma das opções.",
  "Ficou claro? Quando quiser, seguimos no próximo passo.",
  "Posso esclarecer mais algum ponto.",
];

const CONVITES_LEVES = [
  "Se fizer sentido pra você, posso te guiar no próximo passo.",
  "Quando quiser avançar, é só me dizer.",
];

/**
 * Resposta determinística para a etapa CONSIDERAÇÃO. Responde a dúvida
 * específica + fechamento profissional. Anti-repetição em 2 níveis:
 *  - escolhe a VARIANTE da resposta conforme quantas vezes essa objeção já foi
 *    tratada (vira → 2ª/3ª forma de dizer)
 *  - varia o fechamento por `tentativa` (neutro nas primeiras; convite leve
 *    só depois — sem pressão de cadastro a cada turno)
 * Quando a objeção JÁ foi tratada antes, adiciona um reconhecimento curto
 * ("como te falei") pra soar humano e não robótico.
 *
 * Retorna { texto, tipo } pra o orquestrador registrar a objeção tratada.
 */
export function respostaConsideracao(
  inbound: string,
  nome: string | null,
  tentativa: number,
  objecoesTratadas: string[] = [],
): { texto: string; tipo: ObjecaoTipo } {
  const tipo = classificarObjecao(inbound);
  const variantes = RESP_OBJECAO_VARIANTES[tipo];
  // quantas vezes essa objeção já apareceu → escolhe variante diferente
  const jaVista = objecoesTratadas.filter((o) => o === tipo).length;
  let resp = variantes[jaVista % variantes.length];

  // Se já tratamos essa MESMA objeção antes, reconhece pra não soar repetido.
  if (jaVista >= 1) {
    const prefixos = ["como te falei, ", "reforçando: ", "de novo só pra deixar claro: "];
    resp = prefixos[(jaVista - 1) % prefixos.length] + resp;
  }

  const t = Math.max(0, tentativa);
  // Tentativas 0 e 1: só fechamento neutro. A partir da 3ª, convite leve (sem "cadastrar").
  const fechamento = t >= 2
    ? CONVITES_LEVES[t % CONVITES_LEVES.length]
    : FECHAMENTOS_NEUTROS[t % FECHAMENTOS_NEUTROS.length];
  let corpo: string;
  if (nome) {
    corpo = `${nome}, ${resp}`;
  } else {
    corpo = resp.charAt(0).toUpperCase() + resp.slice(1);
  }
  return { texto: `${corpo}\n\n${fechamento}`, tipo };
}

// Palavras-chave que comprovam que a resposta tocou no tema da dúvida.
const TEMA_KEYWORDS: Record<ObjecaoTipo, RegExp> = {
  golpe: /aneel|homologad|regulament|mesma distribuidora|lei|seguro|confi[áa]/i,
  obra: /sem (?:obra|placa|t[ée]cnico|instala)|nada (?:de obra|na sua casa)|direto na fatura/i,
  fidelidade: /sem fidelidade|sem multa|sair quando|sem pegadinha|sem car[êe]ncia/i,
  solar: /fazenda|solar|cr[ée]dito|sem instalar/i,
  distribuidora: /n[ãa]o troca|mesma (?:distribuidora|conta|fia[çc])|continua igual/i,
  aluguel: /alug|quem paga|transfer|mud(?:ar|ou)/i,
  outra_empresa: /aneel|comparar|sem obra|sem fidelidade|regulament/i,
  boleto: /mesma conta|desconto j[áa] aplicado|sem boleto|mesma fatura/i,
  prazo: /\b30\b|\b60\b|dias|fatura|aprovaç/i,
  cobertura: /21 estados|atende|regi[ãa]o|cobre/i,
  cancelar: /cancelar|quando quiser|sem multa|sem (?:ficar )?preso/i,
  taxa_adesao: /sem taxa|gratuit|sem mensalidade|n[ãa]o tem (?:taxa|custo|mensalidade)/i,
  conta_baixa: /\b200\b|compensa|maior a conta|quanto maior/i,
  como_ganham: /fazenda|gera|parte do que|comercializ/i,
  pensar: /sem compromisso|gratuit|sem risco|no seu tempo/i,
  generica: /aneel|sem obra|sem fidelidade|desconto/i,
  como_funciona: /mesma distribuidora|desconto.*fatura|usina|sem obra/i,
  foto_antes: /pode (?:mandar|enviar)|antes|claro/i,
  desistencia: /tudo bem|sem press[ãa]o|qualquer hora/i,
  pedido_humano: /atendente|humano|transferir|aguarda/i,
  titularidade: /no nome|titular|paga a conta|inquilino|dono/i,
  cnpj: /cnpj|35\.704|receita federal/i,
  homologacao_aneel: /aneel|14\.300|homolog|lei/i,
  pedido_recap: /distribuidora|8.*20|desconto|sem obra|cadastro/i,
};

/**
 * Verifica se a resposta proposta realmente aborda o tema da dúvida do lead.
 * Usado na consideração: se o LLM fugiu do assunto, trocamos pela resposta
 * determinística correta. Garante coerência pergunta→resposta.
 */
export function respostaTocaTema(inbound: string, resposta: string): boolean {
  const tipo = classificarObjecao(inbound);
  return TEMA_KEYWORDS[tipo].test(String(resposta || "").toLowerCase());
}
