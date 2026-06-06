// Extractors — microtarefas LLM com tool forçada (chatForced).
// Cada extractor faz UMA pergunta sobre a última mensagem do lead.
// Só aceita resultados com confiança ALTA para escrever no banco.

import { chatForced, type ChatMsg } from "./gateway.ts";

const MODEL = "google/gemini-3-flash-preview";

type Conf = "alta" | "media" | "baixa";

function buildMessages(system: string, inbound: string, history?: string): ChatMsg[] {
  const ctx = history
    ? `# Histórico recente\n${history.slice(-1200)}\n\n# Última mensagem do lead\n${inbound}`
    : `# Última mensagem do lead\n${inbound}`;
  return [
    { role: "system", content: system },
    { role: "user", content: ctx },
  ];
}

export async function extractName(
  inbound: string,
  history?: string,
): Promise<{ nome: string | null; confianca: Conf }> {
  try {
    const { args } = await chatForced({
      model: MODEL,
      temperature: 0.1,
      messages: buildMessages(
        `Você extrai o NOME do lead da última mensagem dele. Se a mensagem não traz um nome, retorne presente=false. Ignore saudações ("oi", "tudo bem"). Aceite primeiro nome ou nome completo. Não invente.`,
        inbound,
        history,
      ),
      tool: {
        type: "function",
        function: {
          name: "extrair_nome",
          description: "Extrai o nome do lead da última mensagem.",
          parameters: {
            type: "object",
            properties: {
              presente: { type: "boolean" },
              nome: { type: "string", description: "Nome puro, sem 'meu nome é'. Capitalizado." },
              confianca: { type: "string", enum: ["alta", "media", "baixa"] },
            },
            required: ["presente", "confianca"],
            additionalProperties: false,
          },
        },
      },
    });
    if (!args || !args.presente) return { nome: null, confianca: "alta" };
    const nome = String(args.nome || "").trim().slice(0, 80);
    return { nome: nome || null, confianca: (args.confianca as Conf) || "media" };
  } catch (e) {
    console.warn("[extractName] falhou:", (e as Error).message);
    return { nome: null, confianca: "baixa" };
  }
}

export async function extractValor(
  inbound: string,
  history?: string,
): Promise<{ valor: number | null; confianca: Conf }> {
  try {
    const { args } = await chatForced({
      model: MODEL,
      temperature: 0.1,
      messages: buildMessages(
        `Você extrai o VALOR MONETÁRIO da conta de luz da última mensagem do lead. Aceite "250", "R$ 250", "duzentos e cinquenta", "uns 300". Se não há valor explícito (ex: "vou ver amanhã"), retorne presente=false. Não invente.`,
        inbound,
        history,
      ),
      tool: {
        type: "function",
        function: {
          name: "extrair_valor",
          description: "Extrai o valor da conta de luz em reais.",
          parameters: {
            type: "object",
            properties: {
              presente: { type: "boolean" },
              valor_reais: { type: "number" },
              confianca: { type: "string", enum: ["alta", "media", "baixa"] },
            },
            required: ["presente", "confianca"],
            additionalProperties: false,
          },
        },
      },
    });
    if (!args || !args.presente) return { valor: null, confianca: "alta" };
    const v = Number(args.valor_reais);
    if (!Number.isFinite(v) || v <= 0 || v >= 100000) return { valor: null, confianca: "baixa" };
    return { valor: v, confianca: (args.confianca as Conf) || "media" };
  } catch (e) {
    console.warn("[extractValor] falhou:", (e as Error).message);
    return { valor: null, confianca: "baixa" };
  }
}

export async function extractEmail(
  inbound: string,
): Promise<{ email: string | null; confianca: Conf }> {
  // Fast-path por regex: e-mail é determinístico, não precisa LLM.
  const m = inbound.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
  if (m) {
    const email = m[0].toLowerCase();
    return { email, confianca: "alta" };
  }
  return { email: null, confianca: "alta" };
}

export async function extractInteresse(
  inbound: string,
  history?: string,
): Promise<{ interessado: boolean | null; confianca: Conf }> {
  try {
    const { args } = await chatForced({
      model: MODEL,
      temperature: 0.1,
      messages: buildMessages(
        `Você decide se o lead acabou de CONFIRMAR INTERESSE em seguir com o cadastro da iGreen, depois de ver a simulação. Exemplos de confirmação: "quero", "vamos", "como faço", "bora", "sim", "fechou", "topo". Exemplos de recusa: "não", "depois", "vou pensar", "não tenho interesse". Se a mensagem é ambígua ou off-topic, retorne presente=false.`,
        inbound,
        history,
      ),
      tool: {
        type: "function",
        function: {
          name: "extrair_interesse",
          description: "Detecta confirmação ou recusa explícita de interesse.",
          parameters: {
            type: "object",
            properties: {
              presente: { type: "boolean" },
              interessado: { type: "boolean" },
              confianca: { type: "string", enum: ["alta", "media", "baixa"] },
            },
            required: ["presente", "confianca"],
            additionalProperties: false,
          },
        },
      },
    });
    if (!args || !args.presente) return { interessado: null, confianca: "alta" };
    return { interessado: !!args.interessado, confianca: (args.confianca as Conf) || "media" };
  } catch (e) {
    console.warn("[extractInteresse] falhou:", (e as Error).message);
    return { interessado: null, confianca: "baixa" };
  }
}
