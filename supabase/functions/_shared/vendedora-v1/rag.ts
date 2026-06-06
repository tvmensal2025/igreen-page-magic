// Camada 3 — RAG dupla: FAQ + conversas vencedoras.

import { embed } from "./gateway.ts";
import type { Etapa, RagChunk, SupabaseClient } from "./types.ts";

export async function buscarContexto(args: {
  supabase: SupabaseClient;
  consultantId: string | null;
  etapa: Etapa;
  query: string;
}): Promise<RagChunk[]> {
  let vec: number[];
  try {
    vec = await embed(args.query);
  } catch (e) {
    console.warn("[rag] embed falhou:", (e as Error).message);
    return [];
  }

  const chunks: RagChunk[] = [];

  try {
    const { data: faq } = await args.supabase.rpc("match_knowledge", {
      p_consultant_id: args.consultantId,
      p_query_embedding: vec,
      p_match_count: 3,
    });
    if (Array.isArray(faq)) {
      for (const r of faq) {
        chunks.push({
          source: "faq",
          title: r.title || "FAQ",
          content: r.content || "",
          similarity: Number(r.similarity) || 0,
        });
      }
    }
  } catch (e) {
    console.warn("[rag] match_knowledge falhou:", (e as Error).message);
  }

  try {
    const { data: win } = await args.supabase.rpc("match_winning", {
      p_consultant_id: args.consultantId,
      p_etapa: args.etapa,
      p_query_embedding: vec,
      p_match_count: 2,
    });
    if (Array.isArray(win)) {
      for (const r of win) {
        chunks.push({
          source: "winning",
          title: `Exemplo vencedor (${r.etapa})`,
          content: r.snippet || "",
          similarity: Number(r.similarity) || 0,
        });
      }
    }
  } catch (e) {
    console.warn("[rag] match_winning falhou:", (e as Error).message);
  }

  return chunks;
}

export function formatChunks(chunks: RagChunk[]): string {
  if (!chunks.length) return "";
  const faq = chunks.filter((c) => c.source === "faq");
  const win = chunks.filter((c) => c.source === "winning");
  let out = "";
  if (faq.length) {
    out += "## FAQ relevante\n" + faq.map((c) => `### ${c.title}\n${c.content}`).join("\n\n");
  }
  if (win.length) {
    out += (out ? "\n\n" : "") + "## Como vendedores reais fecharam casos parecidos\n" +
      win.map((c) => `- ${c.content}`).join("\n");
  }
  return out;
}
