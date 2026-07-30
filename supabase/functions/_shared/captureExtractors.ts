// Capture extractors com cascata: regex → números por extenso → validação.
// Usado pelo Fluxo da Camila para extrair dados da mensagem do lead.

import { parseMoneyBR, MONEY_NUM_SRC } from "./parse-money.ts";
import { isUsableCustomerName } from "./customer-display-name.ts";
import { toNationalPhoneDigits } from "./portal-phone.ts";

const MONEY_NUM_RE = new RegExp(`(${MONEY_NUM_SRC})`);
const MONEY_BARE_RE = new RegExp(
  `^\\s*(?:${MONEY_NUM_SRC})\\s*(?:reais?|pila|mangos?|contos?|r?\\$)?\\s*$`,
  "i",
);
const MONEY_PREFIXED_RE = new RegExp(
  `(?:r?\\$\\s*|reais?\\s*|conta\\s+(?:de|vem|tá|é|cerca de|uns|umas|aproximadamente)?\\s*|valor\\s+(?:de|é)?\\s*)?(${MONEY_NUM_SRC})`,
  "i",
);

const NUM_EXTENSO: Record<string, number> = {
  cem: 100, duzentos: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500,
  seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900, mil: 1000,
};
const DEZ_EXTENSO: Record<string, number> = {
  dez: 10, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
  sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
};

const DDDS_VALIDOS = new Set([
  11,12,13,14,15,16,17,18,19, 21,22,24, 27,28, 31,32,33,34,35,37,38,
  41,42,43,44,45,46, 47,48,49, 51,53,54,55, 61, 62,64, 63, 65,66, 67,
  68, 69, 71,73,74,75,77, 79, 81,87, 82, 83, 84, 85,88, 86,89, 91,93,94,
  92,97, 95, 96, 98,99,
]);

function cpfValido(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11 || /^(\d)\1+$/.test(digits)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(digits[i]) * (10 - i);
  let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(digits[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(digits[i]) * (11 - i);
  let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0;
  return d2 === parseInt(digits[10]);
}

/**
 * True se a mensagem inteira (ou o núcleo numérico) parece telefone BR.
 * Bug Isa 2026-07-20: "03481914644" virava R$ 34.819 via extractValorPermissivo
 * (regex de dinheiro pegava os 6 primeiros dígitos).
 */
export function looksLikeBrazilPhoneMessage(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  // Mensagem só com dígitos/separadores de telefone (sem "R$", "reais", etc.)
  if (/r\$|\breais?\b|\bconta\b|\bvalor\b/i.test(trimmed)) return false;
  const national = toNationalPhoneDigits(trimmed);
  if (national.length !== 10 && national.length !== 11) return false;
  const ddd = parseInt(national.slice(0, 2), 10);
  return DDDS_VALIDOS.has(ddd);
}

/** Sequência longa de dígitos (≥8) sem formatação monetária → telefone/CPF/ID, não conta. */
function looksLikeLongDigitId(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw || /[.,]/.test(raw) || /r\$|\breais?\b/i.test(raw)) return false;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8 && digits.length === raw.replace(/[\s()-]/g, "").replace(/\D/g, "").length;
}

export function extractValor(text: string): number | null {
  if (!text) return null;
  if (looksLikeBrazilPhoneMessage(text) || looksLikeLongDigitId(text)) return null;
  const t = text.toLowerCase().trim();
  // 1) Regex direto: "R$ 380,50", "$380", "380 reais", "uns 400", "350.00", "1.688,15"
  const moneyHint = /r?\$|\breais?\b|\bconta\b|\bluz\b|\bvalor\b|\bpila\b|\bmangos?\b|\bcontos?\b/i.test(t);
  const approxHint = /\b(uns|umas|cerca\s+de|aproximadamente|aprox|por\s+volta|em\s+torno|quase|talvez|ma[is]?\s+ou\s+menos)\b/i.test(t);
  const bareNumber = MONEY_BARE_RE.test(t);
  if (moneyHint || bareNumber || approxHint) {
    const m = t.match(MONEY_PREFIXED_RE);
    if (m) {
      const v = parseMoneyBR(m[1]);
      if (v != null && v >= 30 && v <= 50000) return v;
    }
  }
  // 2) Extenso: "trezentos", "quinhentos e cinquenta"
  for (const [palavra, val] of Object.entries(NUM_EXTENSO)) {
    if (t.includes(palavra)) {
      let total = val;
      // pega "e cinquenta" depois
      const after = t.split(palavra)[1] || "";
      const dezMatch = after.match(/\s+e\s+(\w+)/);
      if (dezMatch && DEZ_EXTENSO[dezMatch[1]]) total += DEZ_EXTENSO[dezMatch[1]];
      if (total >= 30 && total <= 50000) return total;
    }
  }
  return null;
}

/** Fallback permissivo para o contexto "valor da conta": qualquer número 30..50000 na mensagem. */
export function extractValorPermissivo(text: string): number | null {
  if (!text) return null;
  // Telefone / ID longo nunca é valor de conta (mesmo que um prefixo case no MONEY_NUM).
  if (looksLikeBrazilPhoneMessage(text) || looksLikeLongDigitId(text)) return null;
  const direct = extractValor(text);
  if (direct != null) return direct;
  const m = text.match(MONEY_NUM_RE);
  if (!m) return null;
  const v = parseMoneyBR(m[1]);
  if (v != null && v >= 30 && v <= 50000) return v;
  return null;
}

export function extractTelefone(text: string): string | null {
  if (!text) return null;
  // Preferência: normalização canônica (aceita 034…, 55…, (34) 9…).
  const national = toNationalPhoneDigits(text.trim());
  if (national.length === 10 || national.length === 11) {
    const ddd = parseInt(national.slice(0, 2), 10);
    if (DDDS_VALIDOS.has(ddd)) return national;
  }
  const m = text.match(/(?:\+?55\s*)?\(?(\d{2})\)?\s*9?\s*(\d{4})[-\s]?(\d{4})/);
  if (!m) return null;
  const ddd = parseInt(m[1]);
  if (!DDDS_VALIDOS.has(ddd)) return null;
  const digits = (m[0].replace(/\D/g, "")).replace(/^55/, "");
  // normaliza pra 10 ou 11 dígitos (com 9 na frente do número)
  if (digits.length === 10 || digits.length === 11) return digits;
  return null;
}

export function extractCPF(text: string): string | null {
  if (!text) return null;
  const m = text.match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/);
  if (!m) return null;
  const digits = m[0].replace(/\D/g, "");
  return cpfValido(digits) ? digits : null;
}

const PALAVROES = /\b(merda|porra|caralho|fdp|puta|cu|viado|otario)\b/i;

const STOPWORDS_NOME = new Set([
  // saudações / confirmações
  "sim","nao","não","ok","oi","ola","olá","bom","boa","dia","tarde","noite",
  "eu","obrigado","obrigada","valeu","beleza","blz","claro","talvez","quero","posso",
  "pode","manda","vamos","bora","entao","então","como","qual","quanto","quem",
  "que","quê","hein","hum","hmm","ah","ahn","tudo","bem","tbm","tambem","também",
  // negações / hesitações que vinham capturadas como "nome"
  "ainda","agora","depois","hoje","amanha","amanhã","ontem",
  "sei","sabe","quase","mais","menos","muito","pouco","nada","nunca","nenhum","nenhuma",
  "talvez","acho","creio","penso","tipo","meio","tudo","nadica",
  "tava","estava","esta","está","estou","to","tô","fui","fiz","tem","tinha",
  "fala","falar","manda","mandar","ver","vendo","vou","vai","vamos",
  "humano","atendente","consultor","robo","robô","bot",
  // tokens curtos / lixo
  "n","s","ne","né","ta","tá","oq","pq","vc","tb","tbm",
  // domínio: energia / conta de luz — palavras que o lead diz como SUBSTANTIVO,
  // não como nome próprio. Sem isso "Apagão", "Energia", "Conta" viravam nome.
  "apagao","apagão","energia","luz","conta","fatura","boleto","kwh","kw",
  "distribuidora","enel","cemig","cpfl","equatorial","coelba","light",
  "eletropaulo","neoenergia","celpe","celesc","copel","elektro","energisa",
  "desconto","economia","economizar","pagamento","valor","preco","preço",
  "dinheiro","grana","caro","barato",
  "indicacao","indicação","propaganda","anuncio","anúncio",
  "instagram","facebook","whatsapp","zap","site","google","tiktok","youtube",
  "ajuda","ajudar","problema","duvida","dúvida","duvidas","dúvidas",
  "simular","simulacao","simulação","cancelar","sair","parar","cadastro","cadastrar",
  "info","informacao","informação","informacoes","informações",
  "preciso","queria","precisava","gostaria",
  // pronomes átonos / verbos de indicação — evitam capturar "te recomendou" do QR do Horacio
  "te","me","nos","se","lhe","ti","mim",
  "recomendou","recomendado","recomenda","recomendar","recomendação","recomendacao",
  "indicou","indicado","indica","indicar","indicação","indicacao",
  "mandou","mandado","manda","mandar",
  // correção / verbo no passado — "Escrevi errado", "Digitei errado" NÃO são nome
  "escrevi","digitei","errei","falei","enganei","corrigi","corrijo",
  "errado","errada","errados","erradas","correto","correta",
  // NÃO listar nomes próprios comuns (rafael, etc.): o lead pode se chamar
  // assim. Indicação do QR ("horacio te recomendou") já é bloqueada no hard-block
  // no topo de extractNome — não precisa blacklist de prenome.
]);


// Substantivos do domínio que NUNCA podem virar nome, mesmo com erro de digitação.
// Usados pra rejeitar via Levenshtein ≤1 quando a palavra tem ≥5 letras.
const DOMAIN_BLACKLIST = [
  "apagao","apagão","energia","fatura","boleto","conta","distribuidora",
  "desconto","economia","pagamento","propaganda","anuncio","anúncio",
  "instagram","facebook","whatsapp","cadastro","simular","simulacao","simulação",
  "informacao","informação","problema","duvida","dúvida",
];

function levenshteinSmall(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 1) return 2;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function isDomainNoise(word: string): boolean {
  const w = word.toLowerCase();
  if (STOPWORDS_NOME.has(w)) return true;
  if (w.length >= 5) {
    for (const term of DOMAIN_BLACKLIST) {
      if (levenshteinSmall(w, term) <= 1) return true;
    }
  }
  return false;
}

/**
 * Nomes próprios BR que terminam em -ndo/-ar e por isso escapam do
 * guard estrutural de verbo abaixo. Denylist nunca fica completa; esta
 * allowlist evita rejeitar gente de verdade.
 */
const NAMES_LOOKING_LIKE_VERBS = new Set([
  "fernando","orlando","armando","rolando","edmundo","raimundo","wando",
  "reinaldo","aldo","ubaldo","osvaldo","oswaldo","geraldo","ronaldo",
  "cesar","caesar","oscar","edgar","hilar","gaspar","balthazar","baltazar",
  "wilson","nelson",
]);

/**
 * Guard estrutural: a palavra parece VERBO conjugado, não nome próprio.
 * Complementa a blacklist de vocabulário (que nunca cobre tudo) e evita
 * salvar frases como "quero entender melhor" ou "vou pensar" como nome.
 */
function looksLikeVerb(word: string): boolean {
  const w = word.toLowerCase().replace(/[.]/g, "");
  if (w.length < 4) return false;
  if (NAMES_LOOKING_LIKE_VERBS.has(w)) return false;
  // gerúndio: pensando, mandando, recebendo, seguindo
  if (/(ando|endo|indo)$/.test(w) && w.length >= 6) return true;
  // infinitivo: entender, participar, assinar, receber, decidir
  if (/(ar|er|ir)$/.test(w) && w.length >= 6) return true;
  // futuro / condicional: mandarei, gostaria, faria, poderiam
  if (/(arei|erei|irei|aria|eria|iria|ariam|eriam|iriam)$/.test(w)) return true;
  // pretérito 1ª/3ª pessoa: mandei, recebi, pensou, chegaram
  if (/(ei|ou)$/.test(w) && w.length >= 6) return true;
  if (/(aram|eram|iram|amos|emos|imos)$/.test(w)) return true;
  return false;
}


const NAME_PARTICLES = new Set(["de", "da", "do", "dos", "das", "e"]);

function capitalizeName(raw: string): string {
  // Até 5 partes: "Manoel Bento de Oliveira" / "Ana Paula da Silva Santos"
  // Hífen em prenome composto: "Maria-Clara"
  return raw.trim().split(/\s+/).slice(0, 5)
    .map((w, i) => {
      const low = w.toLowerCase();
      if (i > 0 && NAME_PARTICLES.has(low)) return low;
      // Sufixos comuns BR
      if (i > 0 && /^(jr|júnior|junior|filho|filha|neto|neta)$/i.test(low)) {
        return low === "jr" ? "Jr." : titleCaseHyphenated(w);
      }
      return titleCaseHyphenated(w);
    })
    .join(" ");
}

function titleCaseHyphenated(part: string): string {
  return part
    .split("-")
    .map((p) => {
      if (!p) return p;
      // Apóstrofo: D'Angelo
      if (p.includes("'")) {
        return p.split("'").map((s, i) => {
          if (!s) return s;
          const base = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
          return i === 0 ? base : base;
        }).join("'");
      }
      return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
    })
    .join("-");
}

function isValidNameCandidate(cleaned: string): boolean {
  if (!cleaned || cleaned.length < 2) return false;
  if (/\d/.test(cleaned)) return false;
  if (PALAVROES.test(cleaned)) return false;
  const parts = cleaned.toLowerCase().split(/\s+/);
  // Rejeita partes com menos de 2 letras (ex: "Ainda N"), exceto partículas (e)
  // e sufixos Jr. (após strip do ponto vira "jr")
  const NAME_SUFFIXES = new Set(["jr", "junior", "júnior", "filho", "filha", "neto", "neta"]);
  if (parts.some(p => {
    const bare = p.replace(/\./g, "");
    if (NAME_PARTICLES.has(bare) || NAME_SUFFIXES.has(bare)) return false;
    // hífen: cada lado ≥2
    if (bare.includes("-")) return bare.split("-").some((s) => s.length < 2);
    return bare.length < 2;
  })) return false;
  // Partículas (de/da/do) não contam como ruído — nomes BR comuns
  const contentParts = parts.filter((p) => !NAME_PARTICLES.has(p.replace(/\./g, "")));
  if (contentParts.length === 0) return false;
  // Rejeita se qualquer palavra de conteúdo for stopword ou ruído de domínio
  // (sufixos Filho/Jr não são stopword)
  if (contentParts.some(p => {
    const bare = p.replace(/\./g, "");
    if (NAME_SUFFIXES.has(bare)) return false;
    return isDomainNoise(bare.split("-")[0] || bare);
  })) return false;
  // Guarda canônica: meme / telefone / interjeição
  if (!isUsableCustomerName(cleaned)) return false;
  return true;
}


export interface ExtractNomeOpts {
  /**
   * Permite aceitar resposta de 1 palavra única sem gatilho ("sou X / me chamo X").
   * Deve ser `true` SOMENTE quando o bot acabou de perguntar o nome explicitamente
   * (ex: passo `capture_nome` ou `name_ask_sent_at` setado).
   * Default `false`: 1 palavra avulsa NÃO vira nome — evita salvar "Apagão",
   * "Energia", "Conta" e similares como nome do lead.
   */
  allowSingleWord?: boolean;
}

export function extractNome(text: string, opts: ExtractNomeOpts = {}): string | null {
  if (!text) return null;
  // Hard-block: frases de indicação (QR do Horacio etc.) — "te recomendou", "me indicou".
  // Não tentamos extrair nome quando o texto contém esses padrões; nome do lead vem
  // depois, do OCR da conta ou pergunta explícita "qual seu nome?".
  if (/\b(te|me|nos|lhe)\s+(recomend|indic|mand)\w*/i.test(text)) return null;
  if (/\b(recomend|indic)\w*\s+(voc[eê]|vc|tu)\b/i.test(text)) return null;
  // 1) Frase estruturada com gatilho explícito: "sou X", "me chamo X", "meu nome é X".
  //    Removido o gatilho frouxo `nome:?\s?` (matchava "limpa nome te recomendou" do QR).
  //    Mantemos "nome:" com dois-pontos obrigatórios pra forms tipo "Nome: João".
  const m = text.match(/(?:\bsou\b|\bme chamo\b|\bmeu nome [eé]\s|\baqui [eé] o?\s?|\bnome:\s?)\s*([a-zà-ÿ]{2,}(?:[''-][a-zà-ÿ]+)?(?:\s+[a-zà-ÿ]{2,}(?:[''-][a-zà-ÿ]+)?){0,4})/i);
  if (m) {
    const cleaned = capitalizeName(m[1]);
    if (isValidNameCandidate(cleaned)) return cleaned;
  }
  // 2) Resposta crua: 1-5 palavras (letras, hífen, apóstrofo) — nome completo BR
  const trimmed = text.trim().replace(/[.!?,;:]+$/g, "");
  if (trimmed.length > 0 && trimmed.length <= 80) {
    const onlyNameChars = /^[a-zà-ÿ]+(?:[''-][a-zà-ÿ]+)?(?:\s+[a-zà-ÿ]+(?:[''-][a-zà-ÿ]+)?){0,4}$/i.test(trimmed);
    if (onlyNameChars) {
      const wordCount = trimmed.split(/\s+/).length;
      // 1 palavra única: só aceita quando o bot pediu o nome.
      // 2-5 palavras: aceita (ex.: "Manoel Bento de Oliveira", "José Silva Filho").
      if (wordCount === 1 && !opts.allowSingleWord) return null;
      const cleaned = capitalizeName(trimmed);
      if (isValidNameCandidate(cleaned)) return cleaned;
    }
  }
  return null;
}


// Detecta intents puramente por regex (não dependem de IA).
export function detectRegexIntents(text: string): string[] {
  const intents: string[] = [];
  if (!text) return intents;
  if (extractValor(text) != null) intents.push("valor_brl");
  if (extractTelefone(text)) intents.push("telefone_br");
  if (extractCPF(text)) intents.push("cpf_br");
  if (extractNome(text)) intents.push("nome_proprio");
  if (detectHandoffIntent(text)) intents.push("quer_humano");
  return intents;
}

/**
 * Detecta pedido explícito de handoff humano.
 * Cobre variações comuns: "falar com humano", "atendente", "consultor",
 * "pessoa de verdade", "isso é robô?", "quero falar com alguém", etc.
 */
const HANDOFF_PATTERNS: RegExp[] = [
  /\b(falar|conversar|atendimento)\s+(com|por)\s+(um[ao]?\s+)?(humano|pessoa|atendente|consultor[ae]?|gerente|respons[áa]vel|alguém|algu[eé]m\s+de\s+verdade)\b/i,
  /\bquer[oa]?\s+(falar|conversar|atendimento)\s+com\b/i,
  /\b(é|eh|isso|voc[eê])\s+(um\s+)?(rob[oôó]|bot|m[aá]quina|ia|ai)\??/i,
  /\b(n[ãa]o\s+(é|eh)\s+rob[oôó]|n[ãa]o\s+sou\s+rob[oôó])\b/i,
  /\b(atendimento|atendente|suporte)\s+(humano|real)\b/i,
  /\bme\s+passa\s+(para|pro|pra)\s+(um[ao]?\s+)?(humano|atendente|consultor|pessoa)\b/i,
  /\bchama[r]?\s+(um[ao]?\s+)?(consultor|atendente|gerente|humano)\b/i,
];

export function detectHandoffIntent(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return HANDOFF_PATTERNS.some(rx => rx.test(t));
}
