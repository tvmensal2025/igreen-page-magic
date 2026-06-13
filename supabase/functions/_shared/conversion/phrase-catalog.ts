/**
 * Catálogo de frases prontas para classificação/reaquecimento (zero tokens).
 * Espelha o seed em `conversion_phrase_catalog`. Fallback quando DB indisponível.
 */

export type PhraseCategory =
  | "followup"
  | "objection"
  | "step"
  | "rescue"
  | "hot"
  | "welcome";

export type LeadTemperature = "hot" | "warm" | "cold" | "dead" | "objection" | "rescue";

export interface PhraseEntry {
  shortcut: string;
  category: PhraseCategory;
  conversation_step?: string | null;
  temperature?: LeadTemperature | null;
  trigger_keywords?: string[];
  message_text: string;
  next_action: string;
  conversion_chance: number;
}

export interface RenderCustomer {
  name: string | null;
  electricity_bill_value: number | null;
}

/** Substitui {{nome}}, {{first_name}}, {{valor_conta}}, {{representante}}. */
export function renderPhraseText(
  template: string,
  customer: RenderCustomer,
  consultantName = "",
): string {
  if (!template) return "";
  const firstName = String(customer.name ?? "").trim().split(/\s+/)[0] || "";
  const valor = customer.electricity_bill_value != null
    ? Number(customer.electricity_bill_value).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    : "";
  return template
    .replaceAll("{{nome}}", firstName)
    .replaceAll("{{first_name}}", firstName)
    .replaceAll("{{valor_conta}}", valor)
    .replaceAll("{{representante}}", consultantName)
    .replaceAll(/\{\{[a-zA-Z_]+\}\}/g, "");
}

export const SYSTEM_PHRASE_CATALOG: PhraseEntry[] = [
  // Follow-ups
  { shortcut: "/fup1h", category: "followup", temperature: "warm", message_text: "{{nome}}, ainda dá pra continuar de onde paramos? 🙂", next_action: "Retomar conversa agora", conversion_chance: 45 },
  { shortcut: "/fup24h", category: "followup", temperature: "warm", message_text: "{{nome}}, ontem você perguntou sobre desconto na luz. Se quiser, te mando uma simulação rápida — só preciso do valor da conta 📊", next_action: "Pedir valor da conta", conversion_chance: 50 },
  { shortcut: "/fup72h", category: "followup", temperature: "cold", message_text: "{{nome}}, vou separar 5 min hoje pra te montar a simulação. Manda só o valor da conta que eu cuido do resto 💚", next_action: "Último empurrão suave", conversion_chance: 35 },
  { shortcut: "/fup7d", category: "followup", temperature: "dead", message_text: "{{nome}}, vou deixar essa porta aberta. Quando quiser, é só responder qualquer coisa que eu retomo.", next_action: "Porta aberta", conversion_chance: 15 },
  { shortcut: "/rescue_ghosted", category: "rescue", temperature: "rescue", message_text: "Oi {{nome}}! Vi sua mensagem e demorei pra responder — desculpa! Posso te ajudar agora?", next_action: "Responder lead urgente", conversion_chance: 75 },
  // Welcome
  { shortcut: "/oi1", category: "welcome", temperature: "cold", message_text: "Oi {{nome}}! Vi que você se interessou pelo desconto na conta 💡 Quanto vem sua conta de luz hoje (média)?", next_action: "Pedir valor da conta", conversion_chance: 30 },
  { shortcut: "/oi2", category: "welcome", temperature: "cold", message_text: "Oi {{nome}}, na maioria dos casos reduzimos 15–20% na conta, sem obra e sem custo. Me manda o valor médio que eu vejo se rola 👇", next_action: "Explicar benefício", conversion_chance: 35 },
  { shortcut: "/oi3", category: "welcome", temperature: "cold", message_text: "Oi {{nome}} 👋 Já são +500 mil pessoas economizando com a iGreen. Me passa o valor médio da sua conta?", next_action: "Prova social", conversion_chance: 35 },
  // Objections
  { shortcut: "/golpe", category: "objection", temperature: "objection", trigger_keywords: ["golpe", "fraude", "furada", "enganação", "scam", "picaretagem"], message_text: "Entendo sua preocupação, {{nome}}. A iGreen é regulamentada pela ANEEL (Lei 14.300), CNPJ ativo e +500 mil clientes. Você não paga nada extra — só sua conta, com desconto.", next_action: "Responder objeção golpe", conversion_chance: 45 },
  { shortcut: "/fidelidade", category: "objection", temperature: "objection", trigger_keywords: ["fidelidade", "multa", "preso", "amarrado"], message_text: "Sem fidelidade, {{nome}}. Cancela quando quiser, sem multa.", next_action: "Responder objeção fidelidade", conversion_chance: 50 },
  { shortcut: "/preco", category: "objection", temperature: "objection", trigger_keywords: ["caro", "preço", "preco", "grátis", "gratis", "pago", "custo"], message_text: "Cadastro 100% gratuito, {{nome}}. Você continua pagando sua conta, mas com 15–20% de desconto.", next_action: "Responder objeção preço", conversion_chance: 50 },
  { shortcut: "/comofunciona", category: "objection", temperature: "objection", trigger_keywords: ["como funciona", "explica", "funciona como"], message_text: "Simples: você continua com a mesma distribuidora, mas parte da energia vem limpa e mais barata. Sem obra, sem placa.", next_action: "Explicar como funciona", conversion_chance: 55 },
  { shortcut: "/problema", category: "objection", temperature: "objection", trigger_keywords: ["problema", "errado", "deu ruim", "não funciona"], message_text: "Se algo der errado, {{nome}}, cancela sem multa. Sua conta com a distribuidora segue normal.", next_action: "Acionar garantia/cancelamento", conversion_chance: 40 },
  { shortcut: "/depois", category: "objection", temperature: "objection", trigger_keywords: ["depois", "pensar", "amanhã", "semana que vem", "ver com"], message_text: "Tranquilo, {{nome}}! Prefere que eu te chame amanhã ou semana que vem? Qual horário é melhor?", next_action: "Agendar retorno", conversion_chance: 40 },
  { shortcut: "/jadesconto", category: "objection", temperature: "objection", trigger_keywords: ["já tenho desconto", "ja tenho desconto", "já tenho"], message_text: "Que ótimo! Posso simular se nossa proposta cobre o que você já tem? Sem compromisso — 2 minutos.", next_action: "Comparar proposta", conversion_chance: 45 },
  { shortcut: "/medo", category: "objection", temperature: "objection", trigger_keywords: ["medo", "mexer", "instalação", "instalacao", "obra"], message_text: "Você não mexe em nada da instalação, {{nome}}. Só muda quem fornece os créditos — tudo digital.", next_action: "Responder medo de obra", conversion_chance: 50 },
  { shortcut: "/quemsomos", category: "objection", temperature: "objection", trigger_keywords: ["quem são", "quem sao", "quem é vocês", "quem e voce"], message_text: "Somos parceiros oficiais iGreen Energy, {{nome}}. Te mando link com CNPJ e ANEEL se quiser confirmar.", next_action: "Enviar prova social", conversion_chance: 45 },
  { shortcut: "/dead_soft", category: "objection", temperature: "dead", trigger_keywords: ["não quero", "nao quero", "para de", "sair", "encerrar", "não me chama"], message_text: "Sem problemas, {{nome}}. Se mudar de ideia, estou por aqui 💚", next_action: "Encerrar com porta aberta", conversion_chance: 5 },
  // Step-based
  { shortcut: "/step_aguardando_conta", category: "step", conversation_step: "aguardando_conta", temperature: "warm", message_text: "{{nome}}, falta só a foto da conta de luz pra eu te mostrar quanto dá pra economizar. Pode mandar aqui? 📸", next_action: "Pedir foto da conta", conversion_chance: 55 },
  { shortcut: "/step_aguardando_foto_conta", category: "step", conversation_step: "aguardando_foto_conta", temperature: "warm", message_text: "{{nome}}, sem a foto da conta não consigo simular seu desconto. Tira uma foto legível e manda aqui?", next_action: "Reforçar foto da conta", conversion_chance: 55 },
  { shortcut: "/step_confirmando_dados", category: "step", conversation_step: "confirmando_dados", temperature: "warm", message_text: "{{nome}}, confirma se os dados da conta estão certinhos? Se sim, responde \"sim\" que seguimos 👍", next_action: "Confirmar dados OCR", conversion_chance: 65 },
  { shortcut: "/step_aguardando_doc", category: "step", conversation_step: "aguardando_doc", temperature: "warm", message_text: "{{nome}}, estamos quase! Falta só foto do RG ou CNH (frente e verso). Pode mandar?", next_action: "Pedir documento", conversion_chance: 60 },
  { shortcut: "/step_aguardando_facial", category: "step", conversation_step: "aguardando_facial", temperature: "hot", message_text: "{{nome}}, último passo: selfie do rosto pra validação. Pode mandar agora?", next_action: "Pedir selfie", conversion_chance: 70 },
  { shortcut: "/step_portal", category: "step", conversation_step: "portal_submitting", temperature: "hot", message_text: "{{nome}}, seu cadastro está no portal iGreen. Precisa de ajuda em alguma tela?", next_action: "Acompanhar portal", conversion_chance: 90 },
  { shortcut: "/step_aguardando_humano", category: "step", conversation_step: "aguardando_humano", temperature: "hot", message_text: "Oi {{nome}}! Sou {{representante}} e vou te acompanhar pessoalmente daqui. Como posso ajudar?", next_action: "Assumir manualmente", conversion_chance: 80 },
  { shortcut: "/hot_pedir_doc", category: "hot", temperature: "hot", message_text: "Perfeito, {{nome}}! Conta recebida ✅ Agora manda foto do RG/CNH que finalizamos rapidinho.", next_action: "Pedir documento", conversion_chance: 85 },
  { shortcut: "/warm_pedir_conta", category: "hot", temperature: "warm", message_text: "{{nome}}, com o valor da conta (ou foto) eu te mostro a economia exata em 1 minuto. Manda aí?", next_action: "Pedir valor/foto da conta", conversion_chance: 60 },
];

const byShortcut = new Map(SYSTEM_PHRASE_CATALOG.map((p) => [p.shortcut, p]));

export const VALID_SHORTCUTS = SYSTEM_PHRASE_CATALOG.map((p) => p.shortcut);

export function getPhraseByShortcut(shortcut: string | null | undefined): PhraseEntry | null {
  if (!shortcut) return null;
  const key = shortcut.startsWith("/") ? shortcut : `/${shortcut}`;
  return byShortcut.get(key) ?? null;
}

export function resolveDraftFromShortcut(
  shortcut: string | null | undefined,
  customer: RenderCustomer,
  consultantName = "",
): { draft: string; entry: PhraseEntry | null } {
  const entry = getPhraseByShortcut(shortcut);
  if (!entry) return { draft: "", entry: null };
  return { draft: renderPhraseText(entry.message_text, customer, consultantName), entry };
}

/**
 * Mapa de overrides shortcut → texto, vindo do banco
 * (`conversion_phrase_catalog`). Consultor pode reescrever a frase de um
 * shortcut sem alterar o catálogo global embarcado.
 */
export type PhraseOverrides = Map<string, string>;

/**
 * Resolve o texto de um shortcut considerando overrides do banco antes do
 * catálogo embarcado. Mantém o fallback no TS quando o DB está indisponível
 * ou não tem o shortcut — então o runtime nunca quebra por falta de seed.
 */
export function resolveDraftWithOverrides(
  shortcut: string | null | undefined,
  customer: RenderCustomer,
  consultantName = "",
  overrides?: PhraseOverrides | null,
): { draft: string; entry: PhraseEntry | null } {
  if (!shortcut) return { draft: "", entry: null };
  const key = shortcut.startsWith("/") ? shortcut : `/${shortcut}`;
  const overrideText = overrides?.get(key);
  if (overrideText && overrideText.trim()) {
    return {
      draft: renderPhraseText(overrideText, customer, consultantName),
      entry: getPhraseByShortcut(key),
    };
  }
  return resolveDraftFromShortcut(key, customer, consultantName);
}
