// ad-initial-message — apoia a "primeira mensagem do WhatsApp" (CTWA) das campanhas.
//
// Por que existe: a primeira mensagem (initial_message) é uma das chaves de
// atribuição de lead → campanha. Se duas campanhas tiverem a MESMA frase, o
// match por texto fica ambíguo. Esta função:
//   action="check"   → diz se a frase já está em uso por OUTRA campanha
//                       (do próprio consultor) e sugere uma variação única.
//   action="vary"    → reescreve a frase com IA, mantendo o foco (1ª pessoa,
//                       interesse em reduzir a conta de luz), mas com palavras
//                       diferentes pra ficar única.
//
// Tudo em pt-BR. A IA mantém o sentido; só muda a forma.
import { adminClient, authConsultant, corsHeaders } from "../_shared/fb-graph.ts";
import { geminiText } from "../_shared/gemini.ts";

interface Body {
  action: "check" | "vary";
  message?: string;
  distribuidora?: string | null;
  // Quando editando uma campanha existente, ignora ela mesma na checagem.
  exclude_campaign_id?: string | null;
}

function normalize(s: string): string {
  return (s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Similaridade Jaccard simples por palavras (>3 chars).
function similarity(a: string, b: string): number {
  const toks = (s: string) => new Set(normalize(s).split(" ").filter((w) => w.length > 3));
  const A = toks(a), B = toks(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / new Set([...A, ...B]).size;
}

async function loadConsultantMessages(consultantId: string, excludeId?: string | null): Promise<{ id: string; initial_message: string }[]> {
  const admin = adminClient();
  let q = admin
    .from("facebook_campaigns")
    .select("id, initial_message")
    .eq("consultant_id", consultantId)
    .not("initial_message", "is", null)
    .neq("initial_message", "");
  if (excludeId) q = q.neq("id", excludeId);
  const { data } = await q.limit(200);
  return (data || []) as { id: string; initial_message: string }[];
}

// Considera "duplicada" se for idêntica (normalizada) ou muito parecida (>= 0.8).
function findDuplicate(message: string, existing: { id: string; initial_message: string }[]): { id: string; initial_message: string } | null {
  const norm = normalize(message);
  for (const c of existing) {
    if (normalize(c.initial_message) === norm) return c;
  }
  for (const c of existing) {
    if (similarity(message, c.initial_message) >= 0.8) return c;
  }
  return null;
}

const FOCUS_RULES = `Regras OBRIGATÓRIAS:
- Escreva em português do Brasil, em 1ª pessoa (como o CLIENTE falando com a empresa).
- O foco é SEMPRE: interesse em reduzir/economizar na conta de luz (energia).
- Curta: no máximo 160 caracteres, idealmente 1 frase.
- Tom natural de WhatsApp, educado, sem emoji exagerado (no máximo 1).
- NADA de promessas proibidas (sem "grátis", "100%", "garantido").
- Deve ser DIFERENTE das frases já usadas (listadas abaixo), mas com o mesmo sentido.
- Responda APENAS com a frase final, sem aspas, sem explicação.`;

async function varyMessage(base: string, distribuidora: string | null, existing: string[], consultantId: string): Promise<string> {
  const distribLine = distribuidora ? `Distribuidora/concessionária: ${distribuidora}.` : "";
  const usadas = existing.length
    ? `Frases JÁ usadas (NÃO repita, crie uma diferente):\n${existing.slice(0, 20).map((m, i) => `${i + 1}. ${m}`).join("\n")}`
    : "Ainda não há outras frases.";
  const prompt = `Você cria a "primeira mensagem" que o cliente envia no WhatsApp ao clicar num anúncio de energia (Click-to-WhatsApp).

${FOCUS_RULES}

${distribLine}
Frase atual (use como base de sentido, mas reescreva com outras palavras):
"${base}"

${usadas}

Frase nova (única, mesmo sentido):`;
  const out = await geminiText(prompt, {
    model: "gemini-2.5-flash",
    consultantId,
    functionName: "ad-initial-message",
    temperature: 0.9,
  });
  // Limpa aspas e quebras, limita a 160.
  return (out || "").replace(/[\r\n]+/g, " ").replace(/^["'\s]+|["'\s]+$/g, "").trim().slice(0, 160);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const auth = await authConsultant(req);
    if (!auth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = (await req.json()) as Body;
    const message = (body.message || "").trim();
    const distribuidora = body.distribuidora || null;
    const existing = await loadConsultantMessages(auth.id, body.exclude_campaign_id);
    const existingMsgs = existing.map((c) => c.initial_message);

    if (body.action === "check") {
      if (!message) {
        return new Response(JSON.stringify({ error: "Mensagem vazia." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const dup = findDuplicate(message, existing);
      let suggestion: string | null = null;
      if (dup) {
        try {
          suggestion = await varyMessage(message, distribuidora, existingMsgs, auth.id);
        } catch (e) {
          console.warn("[ad-initial-message] vary (na checagem) falhou:", (e as Error).message);
        }
      }
      return new Response(JSON.stringify({
        ok: true,
        duplicate: !!dup,
        // não devolve o texto da outra campanha (privacidade), só o sinal.
        reason: dup ? "Essa frase (ou muito parecida) já está em uso em outra campanha sua. Mude um pouco para a gente medir cada campanha com precisão." : null,
        suggestion,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (body.action === "vary") {
      const base = message || (distribuidora
        ? `Olá! Quero saber mais sobre a redução na conta de luz ${distribuidora}.`
        : "Olá! Quero saber mais sobre a redução na minha conta de luz.");
      let varied = "";
      try {
        varied = await varyMessage(base, distribuidora, existingMsgs, auth.id);
      } catch (e) {
        return new Response(JSON.stringify({ error: "Não consegui gerar a variação agora. Tente de novo." }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Se a IA por azar gerou algo ainda duplicado, tenta mais 1 vez.
      if (varied && findDuplicate(varied, existing)) {
        try { varied = await varyMessage(base, distribuidora, [...existingMsgs, varied], auth.id); } catch (_) { /* mantém */ }
      }
      if (!varied) varied = base;
      return new Response(JSON.stringify({ ok: true, message: varied, duplicate: !!findDuplicate(varied, existing) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "action inválida (use 'check' ou 'vary')." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[ad-initial-message] fatal", err);
    return new Response(JSON.stringify({ error: (err as Error)?.message || "Erro inesperado." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
