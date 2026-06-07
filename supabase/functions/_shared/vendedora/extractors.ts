// Extractors V2 — micro-LLM com tool forçada por etapa.
// Cada extractor retorna o campo que ele extraiu (ou null se não houver).

import { chatForced } from "./gateway.ts";
import { extractNome as extractNomeRegex } from "../captureExtractors.ts";



const MODEL = "google/gemini-2.5-flash-lite";

const TOOL_NOME = {
  type: "function",
  function: {
    name: "extrair_nome",
    description: "Extrai o nome do lead se ele se apresentou na mensagem.",
    parameters: {
      type: "object",
      properties: { nome: { type: "string", description: "nome do lead ou string vazia se ausente" } },
      required: ["nome"],
      additionalProperties: false,
    },
  },
};

const TOOL_VALOR = {
  type: "function",
  function: {
    name: "extrair_valor_conta",
    description: "Extrai o valor médio mensal da conta de luz em reais (número).",
    parameters: {
      type: "object",
      properties: { valor: { type: "number", description: "valor em R$ ou 0 se ausente" } },
      required: ["valor"],
      additionalProperties: false,
    },
  },
};

const TOOL_EMAIL = {
  type: "function",
  function: {
    name: "extrair_email",
    description: "Extrai o e-mail do lead se ele forneceu um na mensagem.",
    parameters: {
      type: "object",
      properties: { email: { type: "string", description: "e-mail ou string vazia" } },
      required: ["email"],
      additionalProperties: false,
    },
  },
};

const TOOL_INTERESSE = {
  type: "function",
  function: {
    name: "classificar_interesse",
    description: "Classifica se o lead demonstrou interesse explícito em prosseguir com o cadastro após a simulação. Palavras-gatilho: quero, vamos, fechado, como faço, ok manda, pode mandar, bora, sim.",
    parameters: {
      type: "object",
      properties: {
        confirmou: { type: "boolean", description: "true se demonstrou interesse explícito em seguir" },
      },
      required: ["confirmou"],
      additionalProperties: false,
    },
  },
};

const NAO_E_NOME = new Set([
  "ok","sim","nao","não","blz","beleza","vlw","valeu","certo","ta","tá","tah",
  "oi","ola","olá","bom dia","boa tarde","boa noite",
  "quero","aceito","fechou","fechado","bora","manda","ver","quanto","como",
  "talvez","depois","pode","vai","top","massa","show","legal","claro",
]);

export async function extrairNome(inbound: string): Promise<string | null> {
  // 0) Fast-path determinístico — resolve a maioria sem LLM (e sem rate-limit).
  //    Aceita variações comuns: "Carlos Antunes", "ok Carlos", "tá, Roberto Dias",
  //    "sou João", "me chamo Maria", "meu nome é Pedro", "ok confio, Cláudia Reis",
  //    "pode anotar, João", "tô dentro, Maria", "fechado então, Pedro Silva".
  try {
    const txt = String(inbound || "").trim();
    // (a) Remove prefixos curtos de confirmação simples (1 palavra) + pontuação.
    const semPrefixoSimples = txt.replace(
      /^(ok|t[áa]h?|blz|beleza|sim|certo|claro|ent[ãa]o|aham|aqui|opa|oi|bora|fechado|t[óo]|show|massa)[\s,.;:\-]+/i,
      "",
    );
    // (b) Se a mensagem tem padrão "<prefixo curto em minúsculas>, <Nome Próprio...>",
    //     descarta tudo antes da vírgula e tenta o nome no que sobra.
    //     Ex.: "ok confio, Cláudia Reis" / "pode anotar, João" / "tô dentro então, Maria"
    let semPrefixoComposto = semPrefixoSimples;
    const m = semPrefixoSimples.match(/^([a-zà-ÿ\s'çãõáéíóúâêôà]{1,40}),\s*([A-ZÀ-Ý][\wÀ-ÿ'\-]+(?:\s+[A-ZÀ-Ý][\wÀ-ÿ'\-]+)*)\s*$/);
    if (m && m[1].split(/\s+/).filter(Boolean).length <= 4) {
      semPrefixoComposto = m[2];
    }
    const regexHit = extractNomeRegex(semPrefixoComposto)
      || extractNomeRegex(semPrefixoSimples)
      || extractNomeRegex(txt);
    if (regexHit) {
      const norm = regexHit.toLowerCase().replace(/[.,!?;:"'()\-]/g, "").trim();
      if (!NAO_E_NOME.has(norm) && regexHit.length >= 2 && regexHit.length <= 80) {
        return regexHit;
      }
    }
  } catch { /* segue pra LLM */ }

  try {
    const r = await chatForced({
      model: MODEL,
      temperature: 0,
      tool: TOOL_NOME,
      messages: [
        { role: "system", content: "Extraia o NOME PRÓPRIO do lead SOMENTE se ele se apresentou claramente. Aceita: 'sou o X', 'me chamo X', 'meu nome é X', 'pode me chamar de X', 'X aqui', ou um substantivo próprio óbvio (nome humano real, ex: 'Carlos Antunes', 'ok Carlos', 'tá, Roberto Dias'). NÃO aceite saudações, confirmações sozinhas ('ok','sim','blz'), perguntas, números, ou texto que não seja nome humano. Sem nome claro → retorne vazio." },
        { role: "user", content: inbound },
      ],
    });
    const raw = String(r.args?.nome || "").trim();
    if (!raw || raw.length < 2 || raw.length > 80) return null;
    const norm = raw.toLowerCase().replace(/[.,!?;:"'()\-]/g, "").trim();
    if (NAO_E_NOME.has(norm)) return null;
    if (!/[a-záàâãéèêíïóôõöúçñ]/i.test(raw)) return null;
    if (/^[\d\s\W]+$/.test(raw)) return null;
    return raw;
  } catch { return null; }
}


export async function extrairValor(inbound: string): Promise<number | null> {
  try {
    const r = await chatForced({
      model: MODEL,
      temperature: 0,
      tool: TOOL_VALOR,
      messages: [
        { role: "system", content: "Extraia valor em R$ de uma frase informal. '300 reais' → 300. '1.2k' → 1200. 'paga uns 450 por mes' → 450. Sem valor claro → 0." },
        { role: "user", content: inbound },
      ],
    });
    const v = Number(r.args?.valor);
    if (!isFinite(v) || v <= 0 || v >= 100000) return null;
    return v;
  } catch { return null; }
}

export async function extrairEmail(inbound: string): Promise<string | null> {
  // Atalho determinístico: regex resolve 95% dos casos sem LLM.
  const m = inbound.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (m) {
    const e = m[0].toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return e;
  }
  try {
    const r = await chatForced({
      model: MODEL,
      temperature: 0,
      tool: TOOL_EMAIL,
      messages: [
        { role: "system", content: "Extraia e-mail da mensagem. Sem e-mail → vazio." },
        { role: "user", content: inbound },
      ],
    });
    const e = String(r.args?.email || "").trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return e;
    return null;
  } catch { return null; }
}

export async function classificarInteresse(inbound: string): Promise<boolean> {
  const txt = String(inbound || "").trim();

  // 1) Negação explícita NUNCA é interesse ("não quero", "ainda não", "agora não").
  if (/\b(n[ãa]o|nunca|jamais|ainda n[ãa]o|agora n[ãa]o)\b/i.test(txt)) {
    // Só deixa passar se houver confirmação forte DEPOIS da negação
    // (ex.: "não tenho dúvida, quero sim"). Caso contrário, trata como não-interesse.
    if (!/\b(quero sim|sim,?\s*quero|pode sim|claro que quero)\b/i.test(txt)) {
      return false;
    }
  }

  // 2) "quero/queria + verbo de dúvida" é PERGUNTA, não interesse de fechar
  // ("quero saber", "queria entender", "quero ver como funciona", "quero pensar").
  if (/\b(quero|queria|gostaria de)\s+(saber|entender|ver|conhecer|pensar|perguntar|tirar|confirmar|comparar)\b/i.test(txt)) {
    return false;
  }

  // 3) Atalho regex pra palavras-gatilho fortes (interesse real de prosseguir).
  //    Sem \b no final: palavras acentuadas ("aí", "faço") quebram a fronteira
  //    de palavra em regex ASCII e fariam o padrão falhar.
  if (/(^|\s)(vamos|fechado|fechou|bora|t[óo]\s*dentro|manda\s*ver)(\s|$|[.!])/i.test(txt)) return true;
  if (/\b(pode\s*mandar|ok\s*manda|sim,?\s*manda|manda\s*a[ií]|quero\s*sim|sim,?\s*quero|claro\s*que\s*quero|quero\s*(fechar|contratar|cadastrar|come|seguir|aderir|agora|esse|isso)|pode\s*(seguir|mandar|prosseguir)|como\s*fa(z|ç|c))/i.test(txt)) {
    return true;
  }
  // "sim" / "quero" / afirmações isoladas (mensagem curta de confirmação)
  if (/^(sim|quero|isso|claro|com certeza|perfeito|ok|fechado|bora|manda|👍|✅)[\s.!]*$/i.test(txt)) {
    return true;
  }
  try {
    const r = await chatForced({
      model: MODEL,
      temperature: 0,
      tool: TOOL_INTERESSE,
      messages: [
        { role: "system", content: "Classifique se o lead confirmou interesse EXPLÍCITO em prosseguir com o CADASTRO após receber a simulação. true APENAS para concordância clara de avançar ('sim', 'quero fechar', 'vamos', 'como faço pra contratar', 'pode seguir'). false para: dúvidas ('quero saber mais', 'como funciona?'), negações ('não quero', 'agora não'), hesitação ('vou pensar', 'depois', 'talvez'), ou qualquer pergunta. Na dúvida, retorne false." },
        { role: "user", content: inbound },
      ],
    });
    return !!r.args?.confirmou;
  } catch { return false; }
}
