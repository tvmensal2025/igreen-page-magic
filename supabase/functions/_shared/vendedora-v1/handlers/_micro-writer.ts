// Helper compartilhado: escreve UMA frase curta para uma etapa específica,
// com retry e fallback determinístico. Usado pelos handlers de etapas
// mecânicas que precisam de variação textual sem o peso do writer v1.

import { chat, type ChatMsg } from "../gateway.ts";
import type { Etapa } from "../types.ts";
import { templatePorEtapa, validateReply } from "../templates.ts";

const MODEL_FAST = "google/gemini-3-flash-preview";

export interface MicroWriterOpts {
  etapa: Etapa | "confirmacao";
  representante: string;
  nomeLead: string | null;
  tarefa: string;             // descrição curta da microtarefa
  regrasExtras?: string;      // ex: "Use *negrito* em 'valor'."
  historyMsgs: ChatMsg[];
  inboundText: string;
}

function buildSystem(opts: MicroWriterOpts, agressivo: boolean): string {
  const nome = opts.nomeLead ? `O lead se chama *${opts.nomeLead}*. Use o nome.` : `O nome do lead ainda não foi capturado.`;
  const base = `Você é ${opts.representante} da iGreen Energy, no WhatsApp.
${nome}

TAREFA ÚNICA: ${opts.tarefa}

FORMATO OBRIGATÓRIO:
- 1 frase curta (máx 100 caracteres).
- Termine com "?" se for pergunta.
- Use *negrito* (asterisco simples) onde fizer sentido para destacar a info principal.
- Sem saudação ("oi", "olá") se já houve conversa antes.
- NÃO peça nada além da TAREFA ÚNICA.
- Sem "como posso te ajudar", "estou à disposição".
${opts.regrasExtras ? `- ${opts.regrasExtras}` : ""}`;

  if (agressivo) {
    return base + `\n\n⚠️ TENTATIVA DE CORREÇÃO: sua resposta anterior FALHOU na validação estrutural. Siga o FORMATO à risca. Apenas a tarefa, nada mais.`;
  }
  return base;
}

export async function microWrite(opts: MicroWriterOpts): Promise<{ text: string; modelUsed: string }> {
  // Histórico curto — só os últimos 6 turnos pra evitar prompt inchado.
  const hist = opts.historyMsgs.slice(-6);
  const messages: ChatMsg[] = [
    { role: "system", content: buildSystem(opts, false) },
    ...hist,
    { role: "user", content: opts.inboundText || "(lead em silêncio)" },
  ];
  let modelUsed = MODEL_FAST;
  let text = "";
  try {
    const r = await chat({ model: MODEL_FAST, messages, temperature: 0.4 });
    text = sanitize(r.text);
    modelUsed = r.modelUsed;
  } catch (e) {
    console.warn(`[microWrite/${opts.etapa}] falhou:`, (e as Error).message);
  }

  if (!validateReply(opts.etapa, text)) {
    // Retry 1x mais agressivo
    try {
      const r2 = await chat({
        model: MODEL_FAST,
        temperature: 0.2,
        messages: [
          { role: "system", content: buildSystem(opts, true) },
          ...hist,
          { role: "user", content: opts.inboundText || "(lead em silêncio)" },
        ],
      });
      const t2 = sanitize(r2.text);
      if (validateReply(opts.etapa, t2)) {
        return { text: t2, modelUsed: r2.modelUsed };
      }
    } catch (e) {
      console.warn(`[microWrite/${opts.etapa}] retry falhou:`, (e as Error).message);
    }
    // Fallback determinístico
    return { text: templatePorEtapa(opts.etapa, opts.nomeLead), modelUsed: `${modelUsed}+template` };
  }

  return { text, modelUsed };
}

function sanitize(raw: string): string {
  let s = String(raw || "").trim();
  if (!s) return s;
  s = s.replace(/\*\*(.+?)\*\*/g, "*$1*");
  s = s.replace(/^[ \t]*[-*][ \t]+/gm, "");
  s = s.replace(/\n{2,}/g, "\n");
  // Pega só a primeira linha não-vazia (handlers mecânicos = 1 frase).
  const firstLine = s.split("\n").map((x) => x.trim()).find((x) => x.length > 0) || s;
  return firstLine.slice(0, 300).trim();
}
