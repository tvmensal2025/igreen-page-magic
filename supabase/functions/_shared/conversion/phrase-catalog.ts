/**
 * Catálogo de frases prontas de reaquecimento / classificação (zero tokens de IA).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GUIA RÁPIDO PARA QUEM QUER MUDAR UMA FRASE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Cada item da lista `SYSTEM_PHRASE_CATALOG` é uma frase pronta. Os campos
 * importantes são:
 *
 *   shortcut         → "atalho" da frase. Começa com "/" (ex.: "/fup24h").
 *                      É o identificador único e NÃO deve ter espaços.
 *   category         → tipo da frase:
 *                      • welcome   → primeira abordagem
 *                      • followup  → reaquecimento por tempo (1h, 24h, 72h…)
 *                      • objection → resposta a uma dúvida/objeção do lead
 *                      • step      → reaquecimento por etapa parada do fluxo
 *                      • rescue    → resgate de lead "abandonado por nós"
 *                      • hot       → empurrão final para lead quase fechando
 *   conversation_step→ (só para `step`) o nome da etapa do fluxo onde o lead
 *                      ficou parado. Ex.: "aguardando_foto_conta".
 *   message_text     → a frase em si. Pode usar:
 *                          {{valor_conta}}    → valor da conta de luz formatado
 *                          {{representante}}  → nome do consultor
 *                      ⚠️  NÃO use {{nome}} — em muitos leads o nome ainda não
 *                          foi capturado e a frase fica feia ("Oi , tudo bem?").
 *                          Escreva neutro: "Oi! …" ou "Tudo bem? …".
 *   next_action      → texto curto que aparece pro consultor explicando o
 *                      objetivo da frase.
 *   conversion_chance→ estimativa (%) de conversão depois desta frase.
 *
 * Para adicionar uma frase nova: copie um item parecido, mude o `shortcut`
 * (único!), escreva a mensagem nova (curta, profissional, com 1 pergunta no
 * final) e salve. Não precisa migrar banco.
 * ─────────────────────────────────────────────────────────────────────────────
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

/**
 * Limpa sobras feias quando uma variável foi substituída por vazio.
 * Exemplos:
 *   "Oi , tudo bem?"     → "Oi! Tudo bem?"
 *   ", confirma os…"     → "Confirma os…"
 *   "Olá   mundo"        → "Olá mundo"
 */
function cleanOrphans(text: string): string {
  let out = text;
  // "Oi ," / "Olá ," / "Oi !" no começo
  out = out.replace(/^(Oi|Olá|Ei|E aí)\s*[,!\.]\s*/i, (m) => {
    const verb = m.trim().replace(/[,!\.]/g, "");
    return `${verb}! `;
  });
  // ", " logo no começo da string
  out = out.replace(/^\s*,\s*/, "");
  // Vírgulas duplicadas / espaço-vírgula-espaço repetido
  out = out.replace(/\s+,/g, ",");
  out = out.replace(/,\s*,/g, ",");
  // Espaços múltiplos
  out = out.replace(/[ \t]{2,}/g, " ");
  // Primeira letra maiúscula
  out = out.replace(/^([a-zà-ú])/, (c) => c.toUpperCase());
  return out.trim();
}

/**
 * Substitui {{nome}}, {{first_name}}, {{valor_conta}}, {{representante}}.
 * Quando o nome está vazio (frequente!), remove a variável SEM deixar vírgula
 * ou espaço sobrando.
 */
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

  let out = template;

  // Se nome está vazio, neutraliza padrões comuns ANTES de substituir.
  if (!firstName) {
    out = out
      .replace(/\{\{nome\}\}\s*,\s*/g, "")
      .replace(/\{\{first_name\}\}\s*,\s*/g, "")
      .replace(/,\s*\{\{nome\}\}/g, "")
      .replace(/,\s*\{\{first_name\}\}/g, "")
      .replace(/\s+\{\{nome\}\}/g, "")
      .replace(/\s+\{\{first_name\}\}/g, "");
  }

  out = out
    .replaceAll("{{nome}}", firstName)
    .replaceAll("{{first_name}}", firstName)
    .replaceAll("{{valor_conta}}", valor)
    .replaceAll("{{representante}}", consultantName)
    .replace(/\{\{[a-zA-Z_]+\}\}/g, "");

  return cleanOrphans(out);
}

/**
 * Catálogo do sistema — frases neutras e profissionais, SEM `{{nome}}`.
 * Cobre todas as etapas do fluxo visíveis no editor (boas-vindas → portal).
 */
export const SYSTEM_PHRASE_CATALOG: PhraseEntry[] = [
  // ─── Follow-ups por tempo ──────────────────────────────────────────────────
  { shortcut: "/fup1h", category: "followup", temperature: "warm",
    message_text: "Oi! Ainda dá pra continuar de onde paramos? 🙂",
    next_action: "Retomar conversa agora", conversion_chance: 45 },
  { shortcut: "/fup24h", category: "followup", temperature: "warm",
    message_text: "Ontem conversamos sobre o desconto na conta de luz. Posso te enviar a simulação agora — só preciso do valor médio da sua conta 📊",
    next_action: "Pedir valor da conta", conversion_chance: 50 },
  { shortcut: "/fup72h", category: "followup", temperature: "cold",
    message_text: "Vou separar 5 minutos hoje pra montar sua simulação. Me manda o valor da conta de luz que eu cuido do resto 💚",
    next_action: "Último empurrão suave", conversion_chance: 35 },
  { shortcut: "/fup7d", category: "followup", temperature: "dead",
    message_text: "Vou deixar essa porta aberta por aqui. Quando quiser retomar, é só responder qualquer coisa que eu continuo de onde paramos.",
    next_action: "Porta aberta", conversion_chance: 15 },
  { shortcut: "/rescue_ghosted", category: "rescue", temperature: "rescue",
    message_text: "Oi! Vi sua mensagem e demorei pra responder — me desculpe. Posso te ajudar agora?",
    next_action: "Responder lead urgente", conversion_chance: 75 },

  // ─── Boas-vindas (primeira abordagem) ──────────────────────────────────────
  { shortcut: "/oi1", category: "welcome", temperature: "cold",
    message_text: "Oi! Vi que você se interessou pelo desconto na conta de luz 💡 Quanto vem sua conta em média por mês?",
    next_action: "Pedir valor da conta", conversion_chance: 30 },
  { shortcut: "/oi2", category: "welcome", temperature: "cold",
    message_text: "Olá! Na maioria dos casos reduzimos de 15% a 20% da conta de luz, sem obra e sem custo. Me manda o valor médio que eu verifico se rola pra você 👇",
    next_action: "Explicar benefício", conversion_chance: 35 },
  { shortcut: "/oi3", category: "welcome", temperature: "cold",
    message_text: "Oi! Já são mais de 500 mil pessoas economizando com a iGreen 👋 Me passa o valor médio da sua conta de luz?",
    next_action: "Prova social", conversion_chance: 35 },

  // ─── Objeções ─────────────────────────────────────────────────────────────
  { shortcut: "/golpe", category: "objection", temperature: "objection",
    trigger_keywords: ["golpe", "fraude", "furada", "enganação", "scam", "picaretagem"],
    message_text: "Entendo a preocupação. A iGreen é regulamentada pela ANEEL (Lei 14.300), tem CNPJ ativo e mais de 500 mil clientes. Você não paga nada extra — segue pagando só sua conta de luz, com desconto.",
    next_action: "Responder objeção golpe", conversion_chance: 45 },
  { shortcut: "/fidelidade", category: "objection", temperature: "objection",
    trigger_keywords: ["fidelidade", "multa", "preso", "amarrado"],
    message_text: "Sem fidelidade. Você pode cancelar quando quiser, sem multa nenhuma.",
    next_action: "Responder objeção fidelidade", conversion_chance: 50 },
  { shortcut: "/preco", category: "objection", temperature: "objection",
    trigger_keywords: ["caro", "preço", "preco", "grátis", "gratis", "pago", "custo"],
    message_text: "O cadastro é 100% gratuito. Você continua pagando sua conta normalmente, só que com 15% a 20% de desconto.",
    next_action: "Responder objeção preço", conversion_chance: 50 },
  { shortcut: "/comofunciona", category: "objection", temperature: "objection",
    trigger_keywords: ["como funciona", "explica", "funciona como"],
    message_text: "É simples: você continua com a mesma distribuidora, mas parte da sua energia passa a vir de fonte limpa e mais barata. Sem obra, sem placa, sem mexer na instalação.",
    next_action: "Explicar como funciona", conversion_chance: 55 },
  { shortcut: "/problema", category: "objection", temperature: "objection",
    trigger_keywords: ["problema", "errado", "deu ruim", "não funciona"],
    message_text: "Se algo der errado, é só cancelar — sem multa. Sua conta com a distribuidora continua igual, do jeito que sempre foi.",
    next_action: "Acionar garantia/cancelamento", conversion_chance: 40 },
  { shortcut: "/depois", category: "objection", temperature: "objection",
    trigger_keywords: ["depois", "pensar", "amanhã", "semana que vem", "ver com"],
    message_text: "Tranquilo! Posso te chamar amanhã ou prefere outro dia da semana? Qual horário é melhor pra você?",
    next_action: "Agendar retorno", conversion_chance: 40 },
  { shortcut: "/jadesconto", category: "objection", temperature: "objection",
    trigger_keywords: ["já tenho desconto", "ja tenho desconto", "já tenho"],
    message_text: "Que ótimo! Posso fazer uma simulação rápida pra comparar com o desconto que você já tem? Leva 2 minutos e é sem compromisso.",
    next_action: "Comparar proposta", conversion_chance: 45 },
  { shortcut: "/medo", category: "objection", temperature: "objection",
    trigger_keywords: ["medo", "mexer", "instalação", "instalacao", "obra"],
    message_text: "Fica tranquilo, nada muda na sua instalação. Só muda quem fornece os créditos de energia — tudo é feito digitalmente.",
    next_action: "Responder medo de obra", conversion_chance: 50 },
  { shortcut: "/quemsomos", category: "objection", temperature: "objection",
    trigger_keywords: ["quem são", "quem sao", "quem é vocês", "quem e voce"],
    message_text: "Somos parceiros oficiais iGreen Energy. Se quiser, te mando o link com CNPJ e a página da ANEEL pra confirmar 👍",
    next_action: "Enviar prova social", conversion_chance: 45 },
  { shortcut: "/dead_soft", category: "objection", temperature: "dead",
    trigger_keywords: ["não quero", "nao quero", "para de", "sair", "encerrar", "não me chama"],
    message_text: "Sem problemas! Se mudar de ideia no futuro, estou por aqui 💚",
    next_action: "Encerrar com porta aberta", conversion_chance: 5 },

  // ─── Reaquecimento por etapa do fluxo ─────────────────────────────────────
  // Cobertura completa: cada etapa do editor de conversa tem 1 frase pronta.
  { shortcut: "/step_boas_vindas_botoes", category: "step", conversation_step: "boas_vindas_botoes", temperature: "cold",
    message_text: "Oi! Vi que você começou a conversa mas não escolheu uma opção. Quer continuar? Só responder qualquer coisa que eu sigo daqui 💚",
    next_action: "Retomar boas-vindas", conversion_chance: 40 },
  { shortcut: "/step_como_funciona", category: "step", conversation_step: "como_funciona", temperature: "cold",
    message_text: "Ficou alguma dúvida sobre como o desconto funciona? Posso te explicar em poucas palavras e já partir pra simulação 🙂",
    next_action: "Retomar explicação", conversion_chance: 45 },
  { shortcut: "/step_completa_ou_rapida", category: "step", conversation_step: "completa_ou_rapida", temperature: "warm",
    message_text: "Pra eu continuar, me diz: você prefere o cadastro Rápido (só com o valor da conta) ou o Completo (com a foto da conta para já calcular tudo)?",
    next_action: "Decidir tipo de cadastro", conversion_chance: 55 },
  { shortcut: "/step_aguardando_valor_conta", category: "step", conversation_step: "aguardando_valor_conta", temperature: "warm",
    message_text: "Pra eu te mostrar o desconto exato, falta só o valor médio da sua conta de luz. Quanto vem por mês, mais ou menos?",
    next_action: "Pedir valor da conta", conversion_chance: 55 },
  { shortcut: "/step_aguardando_conta", category: "step", conversation_step: "aguardando_conta", temperature: "warm",
    message_text: "Falta só a foto da conta de luz pra eu te mostrar quanto dá pra economizar. Pode tirar uma foto bem legível e enviar aqui? 📸",
    next_action: "Pedir foto da conta", conversion_chance: 55 },
  { shortcut: "/step_aguardando_foto_conta", category: "step", conversation_step: "aguardando_foto_conta", temperature: "warm",
    message_text: "Sem a foto da conta de luz não consigo simular o seu desconto. Pode mandar uma foto bem legível agora? 📸",
    next_action: "Reforçar foto da conta", conversion_chance: 55 },
  { shortcut: "/step_simulacao_apresentada", category: "step", conversation_step: "simulacao_apresentada", temperature: "warm",
    message_text: "Vi que você parou logo depois da simulação. Faz sentido o desconto que apresentei? Posso te explicar qualquer parte 💚",
    next_action: "Retomar após simulação", conversion_chance: 60 },
  { shortcut: "/step_resultado_simulacao_sim", category: "step", conversation_step: "resultado_simulacao_sim", temperature: "hot",
    message_text: "Você confirmou que faz sentido o desconto da simulação 👏 Pra eu seguir o cadastro, me envia uma foto da sua conta de luz, por favor.",
    next_action: "Pedir conta após sim", conversion_chance: 70 },
  { shortcut: "/step_resultado_simulacao_nao", category: "step", conversation_step: "resultado_simulacao_nao", temperature: "cold",
    message_text: "Sem problemas! Se mudar de ideia, é só me chamar aqui que retomo a proposta de onde paramos 💚",
    next_action: "Porta aberta após não", conversion_chance: 15 },
  { shortcut: "/step_confirmando_dados", category: "step", conversation_step: "confirmando_dados", temperature: "warm",
    message_text: "Os dados da conta estão certinhos? Se sim, responde \"sim\" que seguimos com o cadastro 👍",
    next_action: "Confirmar dados OCR", conversion_chance: 65 },
  { shortcut: "/step_aguardando_doc", category: "step", conversation_step: "aguardando_doc", temperature: "warm",
    message_text: "Estamos quase! Falta só a foto do RG ou CNH (frente e verso). Pode mandar por aqui?",
    next_action: "Pedir documento", conversion_chance: 60 },
  { shortcut: "/step_aguardando_facial", category: "step", conversation_step: "aguardando_facial", temperature: "hot",
    message_text: "Último passo: uma selfie do seu rosto pra validação. Pode mandar agora?",
    next_action: "Pedir selfie", conversion_chance: 70 },
  { shortcut: "/step_corrigir_celular_portal", category: "step", conversation_step: "corrigir_celular_portal", temperature: "hot",
    message_text: "Vi que paramos na etapa de confirmar o celular no portal. Pode me enviar o número correto com DDD pra eu corrigir e seguir o cadastro?",
    next_action: "Corrigir celular portal", conversion_chance: 75 },
  { shortcut: "/step_portal", category: "step", conversation_step: "portal_submitting", temperature: "hot",
    message_text: "Seu cadastro está em andamento no portal iGreen. Precisa de ajuda em alguma tela?",
    next_action: "Acompanhar portal", conversion_chance: 90 },
  { shortcut: "/step_aguardando_humano", category: "step", conversation_step: "aguardando_humano", temperature: "hot",
    message_text: "Oi! Sou {{representante}} e vou te acompanhar pessoalmente daqui pra frente. Como posso ajudar?",
    next_action: "Assumir manualmente", conversion_chance: 80 },

  // ─── Empurrões finais (hot/warm) ──────────────────────────────────────────
  { shortcut: "/hot_pedir_doc", category: "hot", temperature: "hot",
    message_text: "Perfeito! Conta recebida ✅ Agora me envia uma foto do RG ou CNH e finalizamos rapidinho.",
    next_action: "Pedir documento", conversion_chance: 85 },
  { shortcut: "/warm_pedir_conta", category: "hot", temperature: "warm",
    message_text: "Com o valor da conta (ou a foto) eu já te mostro a economia exata em 1 minuto. Me manda aí?",
    next_action: "Pedir valor/foto da conta", conversion_chance: 60 },
];

const byShortcut = new Map(SYSTEM_PHRASE_CATALOG.map((p) => [p.shortcut, p]));

export const VALID_SHORTCUTS = SYSTEM_PHRASE_CATALOG.map((p) => p.shortcut);

/**
 * Lista canônica das etapas que têm frase de reaquecimento pronta.
 * Usada pelo painel admin para sempre mostrar todas as etapas, mesmo quando
 * não há lead parado naquela etapa no momento.
 */
export const KNOWN_REACTIVATION_STEPS: string[] = SYSTEM_PHRASE_CATALOG
  .filter((p) => p.category === "step" && p.conversation_step)
  .map((p) => p.conversation_step as string);

/** Pega a frase oficial do catálogo para uma dada etapa do fluxo. */
export function getCatalogPhraseForStep(step: string): PhraseEntry | null {
  return SYSTEM_PHRASE_CATALOG.find(
    (p) => p.category === "step" && p.conversation_step === step,
  ) ?? null;
}

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
