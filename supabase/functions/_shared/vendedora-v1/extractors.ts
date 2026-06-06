// Extractors V2 — micro-LLM com tool forçada por etapa.
// Cada extractor retorna o campo que ele extraiu (ou null se não houver).

import { chatForced } from "./gateway.ts";

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
  try {
    const r = await chatForced({
      model: MODEL,
      temperature: 0,
      tool: TOOL_NOME,
      messages: [
        { role: "system", content: "Extraia o NOME PRÓPRIO do lead SOMENTE se ele se apresentou claramente. Aceita: 'sou o X', 'me chamo X', 'meu nome é X', 'pode me chamar de X', 'X aqui', ou um substantivo próprio óbvio (nome humano real). NÃO aceite saudações, confirmações ('ok','sim','blz'), perguntas, números, ou qualquer texto que não seja inequivocamente um nome humano. Sem nome claro → retorne vazio." },
        { role: "user", content: inbound },
      ],
    });
    const raw = String(r.args?.nome || "").trim();
    if (!raw || raw.length < 2 || raw.length > 80) return null;
    // Normaliza pra checar stop-list (lower, remove pontuação)
    const norm = raw.toLowerCase().replace(/[.,!?;:"'()\-]/g, "").trim();
    if (NAO_E_NOME.has(norm)) return null;
    // Rejeita se não contém ao menos uma letra alfabética
    if (!/[a-záàâãéèêíïóôõöúçñ]/i.test(raw)) return null;
    // Rejeita se for só dígitos/símbolos
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
  // Atalho regex pra palavras-gatilho fortes
  if (/\b(quero|vamos|fechado|fechou|bora|pode mandar|ok manda|como faço|como fazer|t[óo]\s*dentro|sim,?\s*manda|manda\s*a[ií])\b/i.test(inbound)) {
    return true;
  }
  try {
    const r = await chatForced({
      model: MODEL,
      temperature: 0,
      tool: TOOL_INTERESSE,
      messages: [
        { role: "system", content: "Classifique se o lead confirmou interesse explícito em prosseguir com o cadastro após receber a simulação de economia. 'Sim' isolado conta. 'Vou pensar', 'depois', 'talvez' NÃO conta." },
        { role: "user", content: inbound },
      ],
    });
    return !!r.args?.confirmou;
  } catch { return false; }
}
