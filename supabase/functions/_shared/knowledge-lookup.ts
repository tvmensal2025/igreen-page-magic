// Deterministic knowledge lookup for ai-agent-router kb-only mode.
// Looks up consultant FAQ first, then active knowledge sections. No LLM calls.

import { phraseMatchesMessage as phraseMatchesShared, QA_STOPWORDS } from "./qa-phrase-match.ts";

type LookupResult = {
  found: boolean;
  text: string;
  source: "bot_flow_qa" | "ai_knowledge_sections" | "none";
  confidence: number;
};

const STOPWORDS = QA_STOPWORDS;

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
  return phraseMatchesShared(phraseRaw, messageRaw);
}

function tokenScore(queryRaw: string, haystackRaw: string): number {
  const queryTokens = normalizeText(queryRaw).split(" ").filter((t) => t.length > 2 && !STOPWORDS.has(t));
  if (queryTokens.length === 0) return 0;
  const haystack = ` ${normalizeText(haystackRaw)} `;
  const hits = queryTokens.filter((t) => haystack.includes(` ${t} `)).length;
  return hits / queryTokens.length;
}

// Gera o embedding da pergunta via Lovable AI Gateway (mesmo modelo do
// embed-knowledge: gemini-embedding-001, 1536 dims). Retorna null em qualquer
// falha — o caller cai na busca por palavra-chave (fail-open).
const EMBED_GATEWAY = "https://ai.gateway.lovable.dev/v1/embeddings";
async function embedQuestion(text: string): Promise<number[] | null> {
  try {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return null;
    const res = await fetch(EMBED_GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-embedding-001", input: text.slice(0, 2000), dimensions: 1536 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const v = data?.data?.[0]?.embedding;
    return Array.isArray(v) ? v : null;
  } catch (_e) {
    return null;
  }
}

// Busca semântica: embedding da pergunta + match_knowledge (cosine). Retorna os
// trechos mais próximos acima do limiar de similaridade. Null em falha.
const SEMANTIC_MIN_SIMILARITY = 0.55;
async function semanticLookup(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  question: string,
  consultantId: string | null | undefined,
): Promise<{ text: string; confidence: number } | null> {
  const vec = await embedQuestion(question);
  if (!vec) return null;
  try {
    const { data, error } = await supabase.rpc("match_knowledge_all", {
      p_consultant_id: consultantId ?? null,
      p_query_embedding: vec,
      p_match_count: 4,
    });
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const top = (data as Array<{ titulo: string; conteudo: string; similarity: number }>)
      .filter((r) => Number(r.similarity) >= SEMANTIC_MIN_SIMILARITY);
    if (top.length === 0) return null;
    // Junta os melhores trechos (até ~1500 chars) pra dar contexto rico ao LLM.
    let text = "";
    for (const r of top) {
      const bloco = `${r.titulo ? r.titulo + "\n" : ""}${r.conteudo || ""}`.trim();
      if (!bloco) continue;
      if (text.length + bloco.length > 1500) break;
      text += (text ? "\n\n" : "") + bloco;
    }
    if (!text.trim()) return null;
    return { text, confidence: Number(top[0].similarity) };
  } catch (_e) {
    return null;
  }
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

  // ─── Busca SEMÂNTICA (embeddings) ─────────────────────────────────────
  // Antes do fallback por palavra-chave: entende a pergunta pelo significado,
  // não pelas palavras exatas. Ex.: "vou gastar mais no fim das contas?" casa
  // a seção de cobrança mesmo sem repetir os termos cadastrados.
  const semantic = await semanticLookup(opts.supabase, question, opts.consultantId);
  if (semantic) {
    return { found: true, text: semantic.text, source: "ai_knowledge_sections", confidence: semantic.confidence };
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