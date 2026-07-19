// AI Button Intent Matcher
// Quando o cliente responde texto livre num passo que tem botões, usa Gemini
// (via Lovable AI Gateway) pra adivinhar qual botão ele quis tocar.
// Retorna { match: <id|null>, refused: bool, confused: bool, confidence: 0..1 }.

export interface ButtonOption {
  id: string;
  title: string;
  phrases?: string[];
}

export interface ButtonIntentResult {
  match: string | null;     // id do botão escolhido, ou null
  refused: boolean;          // cliente quer parar/sair
  confused: boolean;         // cliente está confuso ("?", "oque", "nao entendi")
  confidence: number;
  reason: string;
}

const CONFUSION_RX = /^(?:[\?\.!]+|oi+|hein|hm+|h+a+|que|qual|oque|o que|como assim|n[aã]o entendi|menu|op[cç][oõ]es?|ajuda|help)[\s\?\.!]*$/i;
const REFUSAL_RX = /\b(n[aã]o (vou|quero|posso|irei|tenho|consigo)|n[aã]o tenho (interesse|tempo)|sair|parar|cancela|desisto|deixa pra l[aá]|sem tempo|depois eu|amanh[aã] eu)\b/i;
/** Afirmação curta → 1º botão positivo (não tratar "ok"/"s" como confuso). */
const AFFIRM_RX = /^(ok|okay|blz|beleza|ss+|sim+|claro|pode|quero|vamos|bora|interessad[oa]|ativar|👍|✅)[\s!.]*$/i;

export async function matchButtonIntent(
  message: string,
  buttons: ButtonOption[],
  opts: { apiKey?: string; timeoutMs?: number } = {},
): Promise<ButtonIntentResult> {
  const msg = String(message || "").trim();
  if (!msg || !buttons.length) {
    return { match: null, refused: false, confused: !msg, confidence: 0, reason: "empty" };
  }

  // Match direto por número
  const numMatch = msg.match(/^([1-9])\b/);
  if (numMatch) {
    const idx = Number(numMatch[1]) - 1;
    if (idx >= 0 && idx < buttons.length) {
      return { match: buttons[idx].id, refused: false, confused: false, confidence: 0.95, reason: "number" };
    }
  }

  // Afirmação curta → botão positivo (antes do length<=2 confused)
  if (AFFIRM_RX.test(msg)) {
    const positive = buttons.find((b) =>
      /sim|quero|ativar|continuar|interess|analis|pode|vamos|bora|segu|ok|aceito/i.test(b.title)
    ) || buttons[0];
    return { match: positive.id, refused: false, confused: false, confidence: 0.88, reason: "affirm" };
  }

  // Regex rápidos — depois do número, senão "1", "2", "3" viram confused.
  if (CONFUSION_RX.test(msg) || msg.length <= 2) {
    return { match: null, refused: false, confused: true, confidence: 0.95, reason: "regex_confused" };
  }
  if (REFUSAL_RX.test(msg)) {
    return { match: null, refused: true, confused: false, confidence: 0.9, reason: "regex_refused" };
  }

  // Match por title aproximado (substring case-insensitive sem acento)
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const msgN = norm(msg);
  for (const b of buttons) {
    const tN = norm(b.title);
    if (msgN === tN) {
      return { match: b.id, refused: false, confused: false, confidence: 0.9, reason: "title" };
    }
    // Só substring se título/msg forem longos o bastante (evita "quero" ⊆ "Quero ativar")
    if (tN.length >= 8 && msgN.includes(tN)) {
      return { match: b.id, refused: false, confused: false, confidence: 0.9, reason: "title" };
    }
    if (msgN.length >= 8 && tN.includes(msgN)) {
      return { match: b.id, refused: false, confused: false, confidence: 0.85, reason: "title_short" };
    }
    for (const ph of (b.phrases || [])) {
      const pN = norm(ph);
      if (!pN) continue;
      if (msgN === pN) {
        return { match: b.id, refused: false, confused: false, confidence: 0.85, reason: "phrase" };
      }
      if (pN.length >= 8 && msgN.includes(pN)) {
        return { match: b.id, refused: false, confused: false, confidence: 0.85, reason: "phrase" };
      }
    }
  }

  // Fallback IA (Lovable AI Gateway)
  const apiKey = opts.apiKey || Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    return { match: null, refused: false, confused: true, confidence: 0.3, reason: "no_api_key" };
  }

  // 🧪 modo teste/sandbox: pula IA pra não gastar 2-4s extra por turno.
  // Como nenhum match deterministico pegou, deixa o motor seguir como
  // "outro" e cair na transição default do step.
  try {
    const { isMockMode } = await import("./test-mode.ts");
    if (isMockMode()) {
      return { match: null, refused: false, confused: true, confidence: 0.4, reason: "mock_skip_ai" };
    }
  } catch (_) { /* noop */ }

  const prompt = `Cliente respondeu no WhatsApp: "${msg.slice(0, 200)}"

Opções disponíveis (cliente deveria tocar em um botão):
${buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n")}

Qual opção (1-${buttons.length}) o cliente quis?
- Se quer SAIR/PARAR/CANCELAR → "9"
- Se está confuso, não entendeu, perguntou "que é isso", mandou "?" → "0"
- Senão, responda só o número (1 a ${buttons.length}).

Responda APENAS o número, nada mais.`;

  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), opts.timeoutMs || 4000);
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 8,
        temperature: 0,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!resp.ok) {
      return { match: null, refused: false, confused: true, confidence: 0.3, reason: `ai_${resp.status}` };
    }
    const body = await resp.json();
    const out = String(body?.choices?.[0]?.message?.content || "").trim();
    const n = parseInt(out.match(/\d+/)?.[0] || "", 10);
    if (n === 9) return { match: null, refused: true, confused: false, confidence: 0.8, reason: "ai_refused" };
    if (n === 0 || isNaN(n)) return { match: null, refused: false, confused: true, confidence: 0.7, reason: "ai_confused" };
    if (n >= 1 && n <= buttons.length) {
      return { match: buttons[n - 1].id, refused: false, confused: false, confidence: 0.75, reason: "ai_match" };
    }
    return { match: null, refused: false, confused: true, confidence: 0.4, reason: "ai_oor" };
  } catch (e) {
    return { match: null, refused: false, confused: true, confidence: 0.3, reason: `ai_error:${(e as Error).message}` };
  }
}

/** Extrai botões de um step (captures._buttons + transitions trigger_phrases) */
export function extractStepButtons(step: any): ButtonOption[] {
  const out: ButtonOption[] = [];
  // 1) captures._buttons (config direto)
  const caps = Array.isArray(step?.captures) ? step.captures : [];
  const btnCap = caps.find((c: any) => c?.field === "_buttons" && c?.enabled !== false);
  if (btnCap?.value && Array.isArray(btnCap.value)) {
    for (const b of btnCap.value) {
      if (b?.id && b?.title) out.push({ id: String(b.id), title: String(b.title) });
    }
  }
  // 2) Anexa phrases de transitions
  const txns = Array.isArray(step?.transitions) ? step.transitions : [];
  for (const t of txns) {
    const phrases = Array.isArray(t?.trigger_phrases) ? t.trigger_phrases : [];
    if (!phrases.length) continue;
    const matchBtn = out.find((b) =>
      phrases.some((p: string) =>
        String(p).toLowerCase().includes(b.title.toLowerCase()) ||
        b.title.toLowerCase().includes(String(p).toLowerCase())
      )
    );
    if (matchBtn) matchBtn.phrases = phrases.map(String);
    else if (out.length === 0) {
      // Sem _buttons mas com phrases → cria botão virtual
      out.push({ id: t.goto_step_id || phrases[0], title: phrases[0], phrases: phrases.map(String) });
    }
  }
  return out;
}
