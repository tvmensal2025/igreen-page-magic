// Deterministic knowledge lookup for ai-agent-router kb-only mode.
// Looks up consultant FAQ first, then active knowledge sections. No LLM calls.

type LookupResult = {
  found: boolean;
  text: string;
  source: "bot_flow_qa" | "ai_knowledge_sections" | "none";
  confidence: number;
};

const STOPWORDS = new Set(["nao", "sim", "ok", "oi", "ola", "eai", "opa", "e", "a", "o", "de", "da", "do"]);

function normalizeText(text: string): string {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phraseMatches(phraseRaw: string, messageRaw: string): boolean {
  const phrase = normalizeText(phraseRaw);
  const message = normalizeText(messageRaw);
  if (!phrase || phrase.length < 2 || !message) return false;
  if (message === phrase) return true;
  const singleWord = !phrase.includes(" ");
  if (singleWord) {
    if (STOPWORDS.has(phrase)) return false;
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(message);
  }
  if (phrase.length >= 6 && message.includes(phrase)) return true;
  return message.length <= 8 && phrase.includes(message);
}

function tokenScore(queryRaw: string, haystackRaw: string): number {
  const queryTokens = normalizeText(queryRaw).split(" ").filter((t) => t.length > 2 && !STOPWORDS.has(t));
  if (queryTokens.length === 0) return 0;
  const haystack = ` ${normalizeText(haystackRaw)} `;
  const hits = queryTokens.filter((t) => haystack.includes(` ${t} `)).length;
  return hits / queryTokens.length;
}

export async function lookupKnowledge(opts: {
  supabase: any;
  question: string;
  consultantId?: string | null;
}): Promise<LookupResult> {
  const question = String(opts.question || "").trim();
  if (question.length < 2) return { found: false, text: "", source: "none", confidence: 0 };

  if (opts.consultantId) {
    const { data: flows } = await opts.supabase
      .from("bot_flows")
      .select("id")
      .eq("consultant_id", opts.consultantId)
      .eq("is_active", true);
    const flowIds = ((flows as Array<{ id: string }>) || []).map((f) => f.id);

    if (flowIds.length > 0) {
      const { data: qaRows } = await opts.supabase
        .from("bot_flow_qa")
        .select("id, text_response, position")
        .in("flow_id", flowIds)
        .eq("is_opening", false);
      const qaIds = ((qaRows as Array<{ id: string }>) || []).map((q) => q.id);

      if (qaIds.length > 0) {
        const { data: triggers } = await opts.supabase
          .from("bot_flow_qa_triggers")
          .select("qa_id, phrase")
          .in("qa_id", qaIds);
        const hit = ((triggers as Array<{ qa_id: string; phrase: string }>) || [])
          .find((t) => phraseMatches(t.phrase, question));
        if (hit) {
          const qa = ((qaRows as Array<{ id: string; text_response: string | null; position: number }>) || [])
            .find((q) => q.id === hit.qa_id);
          const text = String(qa?.text_response || "").trim();
          if (text) return { found: true, text: text.slice(0, 1200), source: "bot_flow_qa", confidence: 1 };
        }
      }
    }
  }

  const { data: sections } = await opts.supabase
    .from("ai_knowledge_sections")
    .select("title, content")
    .eq("is_active", true)
    .or(`consultant_id.is.null${opts.consultantId ? `,consultant_id.eq.${opts.consultantId}` : ""}`)
    .order("position", { ascending: true })
    .limit(80);

  const ranked = ((sections as Array<{ title: string; content: string }>) || [])
    .map((s) => ({ ...s, score: tokenScore(question, `${s.title}\n${s.content}`) }))
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) return { found: false, text: "", source: "none", confidence: 0 };
  const best = ranked[0];
  const text = String(best.content || best.title || "").trim().slice(0, 1200);
  return text
    ? { found: true, text, source: "ai_knowledge_sections", confidence: Math.min(0.9, best.score) }
    : { found: false, text: "", source: "none", confidence: 0 };
}