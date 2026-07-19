/**
 * Intent de cobertura / cidade (anúncio cita Uberlândia, lead mora em vizinha, etc.).
 * Regras conservadoras: evita gatilhos soltos ("aqui", "cidade", "moro") que
 * casam fora de contexto.
 */

export const COVERAGE_CITY_SOFT_REPLY =
  "Tranquilo! 😊\n\n" +
  "O anúncio pode citar uma cidade, mas a *iGreen* atende pela *distribuidora* da sua conta " +
  "(em Minas, por exemplo, *CEMIG*) — *cidade vizinha também entra*.\n\n" +
  "No cadastro a gente confirma na hora se sua região é elegível. É rapidinho 🌱⚡";

export const STEP_SOFT_NUDGE =
  "Sem pressa 🙂 Me conta com suas palavras que eu te oriento.";

export const STEP_SOFT_NUDGES = [
  "Sem pressa 🙂 Me conta com suas palavras que eu te oriento.",
  "Tô aqui — pode me falar do seu jeito 😊",
  "Entendi. Se puder me contar um pouquinho mais, eu te ajudo na sequência 🌱",
  "Fico no aguardo quando puder — respondo por aqui 💚",
  "Pode me falar do jeito que for mais fácil pra você 😊",
] as const;

/** Cidades do Triângulo / DDD 34 (+ vizinhas comuns em campanha). */
const RE_MG_NEAR_CITIES =
  /\b(?:uberl[aâ]ndia|araguari|uberaba|patroc[ií]nio|ituiutaba|arax[aá]|tupaciguara|prata|frutal|campina\s*verde|monte\s*alegre|nova\s*ponte|indian[oó]polis|capin[oó]polis|sacramento|concei[cç][aã]o\s*das\s*alagoas)\b/i;

/** Frases explícitas — sem "aqui" solto nem "cobertura" isolada. */
const RE_COVERAGE_PHRASES =
  /(?:nao|não)\s+(?:sou|moro|fico|perten[cç]o)\s+(?:de|da|do|em|na|no)\s+(?!acordo\b|dia\b|hora\b|época\b)/i;

const RE_COVERAGE_MORE = [
  /(?:moro|sou|fico)\s+em\s+outra\s+cidade/i,
  /\bcidade\s+vizinha\b/i,
  /\boutra\s+cidade\b/i,
  /\bfora\s+da\s+(?:cidade|regi[aã]o)\b/i,
  /(?:nao|não)\s+atende(?:m)?\s+(?:na\s+minha|minha\s+(?:cidade|regi[aã]o))/i,
  /\batende(?:m)?\s+(?:na\s+minha\s+cidade|minha\s+regi[aã]o)\b/i,
  /\btem\s+cobertura(?:\s+(?:aqui|na\s+minha\s+(?:cidade|regi[aã]o)))?\b/i,
  /\bfunciona\s+(?:na\s+minha\s+cidade|na\s+minha\s+regi[aã]o)\b/i,
  /(?:an[uú]ncio|propaganda|campanha)\s+(?:[eé]\s+)?(?:s[oó]\s+(?:pra|para)|apenas)\s+\w/i,
  /\bminha\s+cidade\b/i,
  /\bmeu\s+estado\b/i,
  // "aqui em <cidade>" — só com cidade nomeada (não "estou aqui")
  /\baqui\s+em\s+[a-záàâãéêíóôõúç]{3,}/i,
];

/** moro/sou/fico + em|de|na + cidade (não casa/apto). */
const RE_LOCATIVE_CITY =
  /(?:moro|sou|fico|vivo)\s+(?:em|de|na|no)\s+(?!casa\b|apartamento\b|apto\b|aluguel\b|condom[ií]nio\b|rua\b|bairro\b|acordo\b)([a-záàâãéêíóôõúç]{3,}(?:\s+[a-záàâãéêíóôõúç]{2,}){0,2})/i;

function hasCityContext(t: string): boolean {
  if (/(?:moro|sou|fico|vivo)\s+(?:em|de|na|no)\s/i.test(t)) return true;
  if (/(?:nao|não)\s+(?:sou|moro|fico)\s+(?:de|em|na|no)\s/i.test(t)) return true;
  if (/\baqui\s+em\s/i.test(t)) return true;
  if (/(?:vizinha|fora|atende|regi[aã]o|cidade)\b/i.test(t)) return true;
  return false;
}

export function isCoverageCityIntent(text: string): boolean {
  const t = String(text || "").trim();
  if (t.length < 8) return false;

  if (RE_COVERAGE_PHRASES.test(t)) return true;
  for (const rx of RE_COVERAGE_MORE) {
    if (rx.test(t)) return true;
  }

  if (RE_MG_NEAR_CITIES.test(t) && hasCityContext(t)) return true;

  const loc = RE_LOCATIVE_CITY.exec(t);
  if (loc) {
    const place = String(loc[1] || "").trim();
    // Só aceita se o lugar parece nome de cidade (não verbo/adjetivo comum)
    if (place.length >= 4 && !/^(isso|aqui|lá|la|bem|mais|menos|dia|ano)$/i.test(place)) {
      return true;
    }
  }

  return false;
}

export function coverageCityReply(nome?: string | null): string {
  const n = String(nome || "").trim().split(/\s+/)[0] || "";
  if (!n) return COVERAGE_CITY_SOFT_REPLY;
  return COVERAGE_CITY_SOFT_REPLY.replace("Tranquilo!", `Tranquilo, *${n}*!`);
}

/**
 * Gatilhos FAQ — só frases completas (≥2 palavras ou cidade nomeada).
 * Evita "não sou de", "moro em", "aqui" soltos.
 */
export const COVERAGE_CITY_FAQ_TRIGGERS: string[] = [
  "atende na minha cidade",
  "atende minha região",
  "tem cobertura aqui",
  "tem cobertura na minha cidade",
  "funciona na minha cidade",
  "atendem na minha cidade",
  "não sou daqui de",
  "nao sou daqui de",
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
  "moro em araxa",
  "sou de araxa",
  "aqui em araguari",
  "aqui em uberaba",
  "aqui em uberlândia",
  "aqui em uberlandia",
];

export const COVERAGE_CITY_FAQ_TEXT =
  "Tranquilo, {{nome}}! 😊\n\n" +
  "O anúncio pode citar uma cidade, mas a *iGreen* atende pela *distribuidora* da sua conta " +
  "(em Minas, por exemplo, *CEMIG*) — *cidade vizinha também entra*.\n\n" +
  "No cadastro a gente confirma na hora se sua região é elegível. É rapidinho 🌱⚡";
