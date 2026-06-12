// Extrator de e-mail — portado de vendedora/extractors.ts antes de apagar
// a vendedora. Regex resolve 95%; LLM micro-tool resolve o resto.

import { chatForced } from "./gateway.ts";

const MODEL = "google/gemini-2.5-flash-lite";

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

export async function extrairEmail(inbound: string): Promise<string | null> {
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
