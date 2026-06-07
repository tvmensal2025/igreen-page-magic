// Memória persistente: fatos_confirmados (append-only) + estado_atual (mutável).
// Persistida em customers.conversation_summary como JSON.

import { chat } from "./gateway.ts";
import type { MemoryBlock, SupabaseClient } from "./types.ts";

const MODEL = "google/gemini-2.5-flash-lite";

export function readMemory(customer: any): MemoryBlock {
  const raw = customer?.conversation_summary;
  if (!raw) return { fatos_confirmados: [], estado_atual: "" };
  // Backcompat: se for string solta (formato legacy), trata como estado_atual
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return {
          fatos_confirmados: Array.isArray(parsed.fatos_confirmados) ? parsed.fatos_confirmados : [],
          estado_atual: typeof parsed.estado_atual === "string" ? parsed.estado_atual : "",
        };
      }
    } catch { /* não é JSON */ }
    return { fatos_confirmados: [], estado_atual: raw.slice(0, 800) };
  }
  if (typeof raw === "object") {
    return {
      fatos_confirmados: Array.isArray(raw.fatos_confirmados) ? raw.fatos_confirmados : [],
      estado_atual: typeof raw.estado_atual === "string" ? raw.estado_atual : "",
    };
  }
  return { fatos_confirmados: [], estado_atual: "" };
}

export function formatMemory(m: MemoryBlock): string {
  if (!m.fatos_confirmados.length && !m.estado_atual) return "";
  let out = "# Memória da conversa\n";
  if (m.fatos_confirmados.length) {
    out += "Fatos confirmados:\n" + m.fatos_confirmados.map((f) => `- ${f}`).join("\n") + "\n";
  }
  if (m.estado_atual) out += `Estado atual: ${m.estado_atual}`;
  return out;
}

export async function atualizarMemoria(args: {
  supabase: SupabaseClient;
  customerId: string;
  memoriaAtual: MemoryBlock;
  history: string;
  inbound: string;
  reply: string;
}): Promise<void> {
  const system = `Você atualiza a memória persistente de uma vendedora de IA.

Recebe a memória atual + último turno. Devolve JSON:
{
  "fatos_confirmados": ["lista append-only de fatos objetivos curtos do lead (cidade, valor, distribuidora, profissão, situação)"],
  "estado_atual": "1-2 frases (max 200 chars) descrevendo onde está a conversa emocionalmente e o que o lead acabou de fazer"
}

REGRAS:
- fatos_confirmados é APPEND-ONLY. Pegue a lista anterior, NÃO remova nada, só adicione fatos novos confirmados pelo lead.
- estado_atual é REESCRITO todo turno. Curto.
- Só inclua em fatos_confirmados o que o lead CONFIRMOU explicitamente. Nada de palpite.
- Nada de SQL, código, ou narração.`;

  const user = `# Memória atual
${JSON.stringify(args.memoriaAtual)}

# Histórico recente
${args.history}

# Último turno
Lead: ${args.inbound}
Bot: ${args.reply}

Devolva o JSON atualizado.`;

  try {
    const r = await chat({
      model: MODEL,
      json: true,
      temperature: 0.2,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    });
    const parsed = JSON.parse(r.text);
    const next: MemoryBlock = {
      fatos_confirmados: dedupe([
        ...args.memoriaAtual.fatos_confirmados,
        ...(Array.isArray(parsed.fatos_confirmados) ? parsed.fatos_confirmados : []),
      ]).slice(0, 50).map((s) => String(s).slice(0, 160)),
      estado_atual: String(parsed.estado_atual || "").slice(0, 240),
    };
    await args.supabase
      .from("customers")
      .update({ conversation_summary: next, updated_at: new Date().toISOString() })
      .eq("id", args.customerId);
  } catch (e) {
    console.warn("[memory] atualizar falhou:", (e as Error).message);
  }
}

function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = String(x).trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(x).trim());
  }
  return out;
}
