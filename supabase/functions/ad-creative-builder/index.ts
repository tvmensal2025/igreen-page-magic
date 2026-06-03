// Gera copy de elite (6 frameworks), filtra termos proibidos pela Meta e atribui score por variação.
// Injeta padrões aprendidos pelo ad-creative-learner pra cada novo anúncio sair melhor que o anterior.
import { adminClient, authConsultant, corsHeaders } from "../_shared/fb-graph.ts";
import { geminiGenerate } from "../_shared/gemini.ts";

async function loadInsights(consultantId: string, distribuidora?: string) {
  try {
    const admin = adminClient();
    const q = admin.from("ad_creative_insights").select("*").eq("consultant_id", consultantId);
    const { data } = distribuidora
      ? await q.eq("distribuidora", distribuidora).maybeSingle()
      : await q.order("updated_at", { ascending: false }).limit(1).maybeSingle();
    return data;
  } catch { return null; }
}

// Carrega criativos de concorrentes que estão há mais tempo no ar (sinal de que convertem).
// Prioriza os que têm imagem real coletada (referência visual concreta para o builder).
async function loadCompetitorWinners(limit = 8) {
  try {
    const admin = adminClient();
    const { data } = await admin
      .from("ad_competitor_creatives")
      .select("advertiser, headline, primary_text, angle, creative_format, active_days, image_url")
      .order("active_days", { ascending: false })
      .limit(limit * 2);
    const arr = data || [];
    const withImg = arr.filter((c: any) => c.image_url);
    const withoutImg = arr.filter((c: any) => !c.image_url);
    return [...withImg, ...withoutImg].slice(0, limit);
  } catch { return []; }
}

// Insight global da rede (últimos 7 dias) — gravado pelo ad-creative-learner em ad_playbooks.
async function loadGlobalPlaybook() {
  try {
    const admin = adminClient();
    const { data } = await admin
      .from("ad_playbooks")
      .select("payload, generated_at")
      .eq("scope", "global")
      .eq("source_metric", "learner_daily_aggregate")
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.payload || null;
  } catch { return null; }
}

// Termos que a Meta rejeita ou penaliza fortemente — copy regenera/filtra automaticamente.
const FORBIDDEN = [
  /\bgarantid[oa]s?\b/i, /\b100\s*%\b/, /\bmilagre|milagros[oa]\b/i,
  /\bganh(?:e|a|ar)\s+(dinheiro|grana|muito)\b/i, /\bgr[áa]tis\b/i,
  /\bmelhor\s+do\s+(brasil|mundo|mercado)\b/i, /[!?]{2,}/,
  /\b(VOC[ÊE]|SEU|SUA)\b/,
];

// Aberturas fracas que matam CTR no Feed (texto corta em ~40 chars no mobile).
// Variações que começam assim são descartadas pelo cleanList.
const WEAK_OPENERS = [
  /^entre\s+em\s+contato/i,
  /^saiba\s+mais/i,
  /^conhe[çc]a\s+/i,
  /^clique\s+(aqui|abaixo|no\s+bot[ãa]o)/i,
  /^ol[áa][,.\s]/i,
];

function isClean(s: string): boolean {
  if (!s) return false;
  return !FORBIDDEN.some((r) => r.test(s));
}

// Para primary_text: verifica se a primeira sentença (até ponto/quebra) cabe em 40 chars.
// Esse é o hook visível antes do "ver mais" no Feed mobile.
function firstSentence(s: string): string {
  const m = s.match(/^[^.!?\n]+/);
  return (m ? m[0] : s).trim();
}

function hookOk(s: string): boolean {
  if (WEAK_OPENERS.some((r) => r.test(s))) return false;
  const first = firstSentence(s);
  // hook ideal: 12–40 chars antes do primeiro ponto
  return first.length >= 8 && first.length <= 40;
}

function variationScore(s: string, kind: "headline" | "primary"): number {
  if (!isClean(s)) return 0;
  const len = s.length;
  const idealMin = kind === "headline" ? 14 : 35;
  const idealMax = kind === "headline" ? 30 : 90;
  let score = 60;
  if (len >= idealMin && len <= idealMax) score += 15;
  if (/\d/.test(s)) score += 10; // números aumentam CTR
  if (/(fala|toca|garante|peça|peca|simule|baixe|conhe[çc]a|descubra|economiz|chame|👇|👉)/i.test(s)) score += 10;
  if (/cliente|cidade|região|aqui|seu boleto|sua conta/i.test(s)) score += 5;
  // Bônus de hook curto APENAS no primary — o texto fica visível mesmo com "ver mais".
  if (kind === "primary" && hookOk(s)) score += 20;
  return Math.min(100, score);
}

const FALLBACK = {
  headlines: [
    { text: "Conta de luz 20% mais barata", framework: "específico", angle: "economia_concreta", score: 90 },
    { text: "Sua conta de luz subiu de novo?", framework: "PAS", angle: "quebra_objecao", score: 80 },
    { text: "Pague menos sem obra nem taxa", framework: "objeção", angle: "quebra_objecao", score: 85 },
    { text: "Em até 30 dias na sua fatura", framework: "urgência", angle: "urgencia", score: 78 },
    { text: "+50 mil famílias economizam", framework: "prova social", angle: "prova_social", score: 82 },
  ],
  primary_texts: [
    { text: "Sua conta de luz até 20% mais barata. Sem obra. Fala no zap 👇", framework: "AIDA", angle: "economia_concreta", score: 92 },
    { text: "Cansado da conta alta? Desconto direto na fatura. Toca aqui.", framework: "PAS", angle: "quebra_objecao", score: 86 },
    { text: "Energia limpa, conta leve. Sem instalar nada. Garante a sua 🌱", framework: "benefício", angle: "curiosidade", score: 88 },
  ],
  description: "Sem obra. Sem taxa.",
  image_briefs: [
    { format: "estatico", brief: "Foto real de uma fatura de luz na mão, valores 'antes/depois' destacados em verde, sem stock photo." },
    { format: "estatico", brief: "Pessoa real (não modelo) sorrindo segurando a conta, fundo de cozinha simples, texto pequeno: 'Diminuí R$ 1.200/ano'." },
    { format: "carrossel", brief: "Slide 1 fundo amarelo texto preto: 'A Lei 14.300 te dá direito a desconto. Quase ninguém sabe.' Slides seguintes explicam." },
  ],
};

interface Variation { text: string; framework: string; angle?: string; score: number }
interface ImageBrief { format: string; brief: string }
interface CopyPack {
  headlines: Variation[];
  primary_texts: Variation[];
  description: string;
  image_briefs: ImageBrief[];
  // Backwards compatibility — clientes antigos esperam string[]
  legacy?: { headlines: string[]; primary_texts: string[] };
}

// Ângulos obrigatórios — IA precisa entregar 1 de cada (evita 6 títulos do mesmo tipo).
const REQUIRED_ANGLES = [
  "economia_concreta", // R$/% específicos
  "quebra_objecao",    // sem obra, sem fidelidade, sem instalar
  "prova_social",      // milhares de famílias, depoimento
  "curiosidade",       // gancho, lei 14.300, segredo
  "urgencia_local",    // cidade/distribuidora + prazo
  "dor_pas",           // PAS — começa pela dor
];

async function generate(cities: string[], insights?: any, competitors: any[] = [], consultantId?: string, globalPlaybook?: any): Promise<CopyPack> {
  const ctx = cities.join(", ") || "Brasil";
  const isDistribuidora = ctx.toLowerCase().includes("clientes da");

  const learnedBlock = insights ? `

APRENDIZADO DESTE CONSULTOR (use como guia obrigatório):
- Padrões VENCEDORES (use): ${(insights.winning_patterns || []).join(", ") || "(ainda coletando)"}
- Padrões PERDEDORES (evite): ${(insights.losing_patterns || []).join(", ") || "(ainda coletando)"}
- Melhor taxa de toque atingida: ${((insights.best_ctr_bps || 0) / 100).toFixed(2)}% — supere isso
${insights.summary ? `- Lição mais recente: ${insights.summary}` : ""}
${insights.competitor_summary ? `- Padrão dos concorrentes vencedores: ${insights.competitor_summary}` : ""}
` : "";

  const competitorBlock = competitors.length ? `

ANÚNCIOS DE CONCORRENTES NO AR HÁ MAIS TEMPO (sinal claro de que convertem — inspire-se, NÃO copie):
${competitors.map((c, i) => `${i + 1}. [${c.advertiser} • ${c.active_days}d • ${c.creative_format || "?"} • ${c.angle || "?"}] "${(c.headline || "").slice(0, 60)}" — ${(c.primary_text || "").slice(0, 100)}`).join("\n")}
` : "";

  const globalBlock = globalPlaybook ? `

PADRÕES DA REDE iGREEN (últimos 7 dias, ${globalPlaybook.consultants_in_sample || 0} consultores — use como reforço):
- TOP vencedores globais: ${(globalPlaybook.winning_patterns || []).slice(0, 5).map((p: any) => p.pattern).join(" | ") || "(coletando)"}
- A EVITAR globalmente: ${(globalPlaybook.losing_patterns || []).slice(0, 5).map((p: any) => p.pattern).join(" | ") || "(coletando)"}
- Imagens que mais funcionaram: ${(globalPlaybook.best_image_traits || []).slice(0, 3).map((p: any) => p.pattern).join(" | ") || "(coletando)"}
` : "";

  const prompt = `Você é o melhor copywriter de Facebook Ads do Brasil. Gere copy em pt-BR para iGreen Energy (energia por assinatura — desconto na conta de luz).

Contexto-alvo: ${ctx}.
${isDistribuidora ? "IMPORTANTE: o 1º item é a distribuidora do cliente — use o NOME dela em pelo menos 3 dos 6 títulos.\n" : ""}${learnedBlock}${globalBlock}${competitorBlock}

Retorne JSON ESTRITO. Cada headline DEVE ter um ângulo distinto da lista [${REQUIRED_ANGLES.join(", ")}] — exatamente 1 de cada:

{
  "headlines": [
    { "text": "...", "framework": "específico",        "angle": "economia_concreta" },
    { "text": "...", "framework": "objeção",           "angle": "quebra_objecao" },
    { "text": "...", "framework": "prova_social",      "angle": "prova_social" },
    { "text": "...", "framework": "curiosidade",       "angle": "curiosidade" },
    { "text": "...", "framework": "urgência_local",    "angle": "urgencia_local" },
    { "text": "...", "framework": "PAS",               "angle": "dor_pas" }
  ],
  "primary_texts": [
    { "text": "...", "framework": "AIDA",              "angle": "economia_concreta" },
    { "text": "...", "framework": "PAS",               "angle": "dor_pas" },
    { "text": "...", "framework": "benefício_direto",  "angle": "quebra_objecao" }
  ],
  "description": "1 descrição curta",
  "image_briefs": [
    { "format": "estatico",  "brief": "descreva 1 imagem que NÃO seja painel solar genérico — mostre conta antes/depois, pessoa real, ou objeto cotidiano." },
    { "format": "video_9x16","brief": "descreva 1 vídeo vertical 15-25s: hook nos 3 primeiros segundos, prova visual no meio, CTA WhatsApp no fim." },
    { "format": "carrossel", "brief": "slide 1 de alto contraste com texto de curiosidade; slides seguintes mostram a economia." }
  ]
}

REGRAS DE OURO (cumpra TODAS, senão a Meta rejeita):
- Títulos: 14 a 30 caracteres. Textos: 35 a 90 caracteres. Descrição: até 25.
- PROIBIDO usar: "garantido", "100%", "milagre", "ganhe dinheiro", "grátis", "melhor do Brasil/mundo", "!!" ou "??", VOCÊ/SEU/SUA em CAIXA ALTA.
- Tom direto, brasileiro, sem enrolação. Foque em ECONOMIA, nunca em ganho.
- Cada texto primário precisa ter um CTA no final (ex: "Fala no zap 👇", "Toca aqui", "Garante a sua").
- Use no máximo 1 emoji por texto. Pelo menos 3 itens devem conter um número específico.
- Image briefs: NUNCA proponha painel solar bonito em telhado azul — esse é o erro #1 do mercado.

Exemplo do nível de qualidade esperado:
- headline: "Conta CPFL 20% mais barata"
- primary: "Cansado da conta alta? Desconto de até 20% direto no boleto. Sem obra. Fala no zap 👇"`;

  try {
    const result = await geminiGenerate({
      model: "gemini-2.5-pro",
      fallbackModel: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      temperature: 0.75,
      responseMimeType: "application/json",
      thinkingBudget: 1024,
      functionName: "ad-creative-builder",
      consultantId,
    });
    const text = result.text;
    if (!text) return packWithLegacy(FALLBACK);
    const parsed = JSON.parse(text);
    const trim = (s: string, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");

    const cleanList = (arr: any[], kind: "headline" | "primary", maxLen: number): Variation[] =>
      (arr || [])
        .map((v) => ({
          text: trim(typeof v === "string" ? v : v?.text || "", maxLen),
          framework: typeof v === "object" ? (v?.framework || "geral") : "geral",
          angle: typeof v === "object" ? (v?.angle || "geral") : "geral",
        }))
        .filter((v) => v.text && isClean(v.text))
        .map((v) => ({ ...v, score: variationScore(v.text, kind) }))
        .sort((a, b) => b.score - a.score);

    let headlines = cleanList(parsed.headlines, "headline", 30);
    const primary_texts = cleanList(parsed.primary_texts, "primary", 90);

    // Garante diversidade de ângulos: 1 por categoria, no máximo
    const seen = new Set<string>();
    headlines = headlines.filter((h) => {
      const key = h.angle || "geral";
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const briefs: ImageBrief[] = Array.isArray(parsed.image_briefs)
      ? parsed.image_briefs
          .map((b: any) => ({ format: String(b?.format || "estatico").slice(0, 24), brief: String(b?.brief || "").slice(0, 280) }))
          .filter((b: ImageBrief) => b.brief.length > 10)
          .slice(0, 3)
      : FALLBACK.image_briefs;

    return packWithLegacy({
      headlines: headlines.length >= 3 ? headlines.slice(0, 6) : FALLBACK.headlines,
      primary_texts: primary_texts.length >= 2 ? primary_texts.slice(0, 3) : FALLBACK.primary_texts,
      description: trim(parsed.description || FALLBACK.description, 25),
      image_briefs: briefs.length ? briefs : FALLBACK.image_briefs,
    });
  } catch {
    return packWithLegacy(FALLBACK);
  }
}

function packWithLegacy(p: { headlines: Variation[]; primary_texts: Variation[]; description: string; image_briefs: ImageBrief[] }): CopyPack {
  return {
    ...p,
    legacy: {
      headlines: p.headlines.map((h) => h.text),
      primary_texts: p.primary_texts.map((t) => t.text),
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authConsultant(req);
    if (!auth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { cities, distribuidora } = await req.json().catch(() => ({ cities: [] }));
    const [insights, competitors, globalPlaybook] = await Promise.all([
      loadInsights(auth.id, distribuidora),
      loadCompetitorWinners(8),
      loadGlobalPlaybook(),
    ]);
    const copy = await generate(cities || [], insights, competitors, auth.id, globalPlaybook);
    const flat = {
      headlines: copy.legacy!.headlines,
      primary_texts: copy.legacy!.primary_texts,
      description: copy.description,
      image_briefs: copy.image_briefs,
      variations: { headlines: copy.headlines, primary_texts: copy.primary_texts },
    };
    return new Response(JSON.stringify(flat), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
