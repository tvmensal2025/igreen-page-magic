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

// Carrega somente anúncios concorrentes observados recentemente. A permanência
// no ar é uma heurística de relevância, não uma prova de conversão. O modelo
// recebe apenas copy e metadados; as imagens coletadas não são enviadas ao Gemini.
async function loadCompetitorReferences(limit = 8) {
  try {
    const admin = adminClient();
    const recentCutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
    const { data } = await admin
      .from("ad_competitor_creatives")
      .select("advertiser, headline, primary_text, angle, creative_format, last_seen_at")
      .gte("last_seen_at", recentCutoff)
      .order("last_seen_at", { ascending: false })
      .limit(limit * 2);
    return (data || [])
      .filter((item: any) => !/i\s*green/i.test(String(item.advertiser || "")))
      .slice(0, limit);
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

const UNVERIFIED_CLAIMS = [
  /\d/,
  /\b(?:lei|prazo|urg[eê]ncia|depoimento|milhares?|famílias?|clientes? satisfeitos?)\b/i,
  /\b(?:economia|desconto)\s+(?:de|at[ée])\b/i,
  /\b(?:por cento|percentual|reais|r\$)\b/i,
];

function claimSafe(s: string): boolean {
  if (UNVERIFIED_CLAIMS.some((r) => r.test(s))) return false;
  if (/\bsem\s+(?:obra|placas?)\b/i.test(s) && !/\b(?:consulte|consulta|opção|pode|simule|verifique|confira|sujeit[oa])\b/i.test(s)) {
    return false;
  }
  return true;
}

function isClean(s: string): boolean {
  if (!s) return false;
  return claimSafe(s) && !FORBIDDEN.some((r) => r.test(s));
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
  if (/(fala|toca|peça|peca|simule|consulte|entenda|verifique|chame|👇|👉)/i.test(s)) score += 10;
  if (/cliente|cidade|região|aqui|seu boleto|sua conta/i.test(s)) score += 5;
  // Bônus de hook curto APENAS no primary — o texto fica visível mesmo com "ver mais".
  if (kind === "primary" && hookOk(s)) score += 20;
  return Math.min(100, score);
}

const FALLBACK = {
  headlines: [
    { text: "Simule sua conta de luz", framework: "simulação", angle: "simulacao", score: 85 },
    { text: "Veja se há economia", framework: "transparência", angle: "transparencia", score: 82 },
    { text: "Consulte opção sem placas", framework: "objeção", angle: "sem_placas", score: 84 },
    { text: "Consulte opção sem obra", framework: "objeção", angle: "sem_obra", score: 84 },
    { text: "Entenda antes de aderir", framework: "transparência", angle: "como_funciona", score: 80 },
    { text: "Conta alta? Faça simulação", framework: "PAS", angle: "dor_pas", score: 82 },
  ],
  primary_texts: [
    { text: "Conta de luz pesando? Simule para verificar se pode haver economia. Fale no zap 👇", framework: "PAS", angle: "simulacao", score: 90 },
    { text: "Quer entender a proposta? Consulte as condições antes de decidir. Fale no zap.", framework: "transparência", angle: "transparencia", score: 88 },
    { text: "Prefere evitar instalação? Consulte se há opção sem placas e sem obra para o local.", framework: "objeção", angle: "sem_obra", score: 86 },
  ],
  description: "Consulte e simule",
  image_briefs: [
    { format: "estatico", brief: "Pessoa consultando uma fatura sem valores legíveis, com chamada para simulação e sem promessa de resultado." },
    { format: "video_9x16", brief: "Vídeo vertical mostrando o passo a passo da simulação, as condições de forma legível e um convite para consultar." },
    { format: "carrossel", brief: "Carrossel explicando como consultar disponibilidade, simular e revisar condições antes de decidir." },
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

// Ângulos verificáveis — evitam números, prova social, prazo ou benefício não comprovado.
const REQUIRED_ANGLES = [
  "simulacao",
  "transparencia",
  "sem_placas",
  "sem_obra",
  "como_funciona",
  "dor_pas",
];

async function generate(cities: string[], insights?: any, competitors: any[] = [], consultantId?: string, globalPlaybook?: any): Promise<CopyPack> {
  const ctx = cities.join(", ") || "Brasil";
  const isDistribuidora = ctx.toLowerCase().includes("clientes da");

  const learnedBlock = insights ? `

APRENDIZADO DESTE CONSULTOR (use somente padrões de copy sustentados pelas métricas reais):
- Padrões VENCEDORES (use): ${(insights.winning_patterns || []).join(", ") || "(ainda coletando)"}
- Padrões PERDEDORES (evite): ${(insights.losing_patterns || []).join(", ") || "(ainda coletando)"}
${insights.summary ? `- Lição mais recente: ${insights.summary}` : ""}
${insights.competitor_summary ? `- Referências recentes de copy dos concorrentes: ${insights.competitor_summary}` : ""}
` : "";

  const competitorBlock = competitors.length ? `

ANÚNCIOS DE OUTRAS EMPRESAS OBSERVADOS RECENTEMENTE (referências de linguagem; observação e tempo no ar NÃO comprovam conversão, desempenho ou veracidade; inspire-se, NÃO copie claims):
${competitors.map((c, i) => `${i + 1}. [${c.advertiser} • ${c.creative_format || "?"} • ${c.angle || "?"}] "${(c.headline || "").slice(0, 60)}" — ${(c.primary_text || "").slice(0, 100)}`).join("\n")}
` : "";

  const globalBlock = globalPlaybook ? `

PADRÕES DE COPY DA REDE (últimos 7 dias, ${globalPlaybook.consultants_in_sample || 0} consultores — use somente como referência):
- TOP vencedores globais: ${(globalPlaybook.winning_patterns || []).slice(0, 5).map((p: any) => p.pattern).join(" | ") || "(coletando)"}
- A EVITAR globalmente: ${(globalPlaybook.losing_patterns || []).slice(0, 5).map((p: any) => p.pattern).join(" | ") || "(coletando)"}
` : "";

  const prompt = `Você escreve anúncios em pt-BR para energia por assinatura. Crie copy clara para a iGreen Energy sem prometer resultado não comprovado.

Contexto-alvo: ${ctx}.
${isDistribuidora ? "IMPORTANTE: o 1º item é a distribuidora do cliente — use o nome dela somente como contexto de localização, sem afirmar disponibilidade ou prazo.\n" : ""}${learnedBlock}${globalBlock}${competitorBlock}

Retorne JSON ESTRITO. Cada headline DEVE ter um ângulo distinto da lista [${REQUIRED_ANGLES.join(", ")}] — exatamente 1 de cada:

{
  "headlines": [
    { "text": "...", "framework": "simulação",       "angle": "simulacao" },
    { "text": "...", "framework": "transparência", "angle": "transparencia" },
    { "text": "...", "framework": "objeção",       "angle": "sem_placas" },
    { "text": "...", "framework": "objeção",       "angle": "sem_obra" },
    { "text": "...", "framework": "explicativo",   "angle": "como_funciona" },
    { "text": "...", "framework": "PAS",           "angle": "dor_pas" }
  ],
  "primary_texts": [
    { "text": "...", "framework": "simulação",       "angle": "simulacao" },
    { "text": "...", "framework": "transparência",   "angle": "transparencia" },
    { "text": "...", "framework": "objeção",         "angle": "sem_obra" }
  ],
  "description": "1 descrição curta",
  "image_briefs": [
    { "format": "estatico",  "brief": "imagem cotidiana que convide a simular, sem valores, antes/depois ou promessa visual." },
    { "format": "video_9x16","brief": "vídeo vertical curto explicando consulta, simulação e revisão das condições." },
    { "format": "carrossel", "brief": "carrossel informativo sobre como consultar e simular antes de decidir." }
  ]
}

REGRAS DE OURO:
- Títulos: 14 a 30 caracteres. Textos: 35 a 90 caracteres. Descrição: até 25.
- PROIBIDO usar: "garantido", "100%", "milagre", "ganhe dinheiro", "grátis", "melhor do Brasil/mundo", "!!" ou "??", VOCÊ/SEU/SUA em CAIXA ALTA.
- Não invente nem exija percentuais, valores, quantidade de clientes, depoimentos, leis, datas, prazos, urgência, disponibilidade, economia ou qualquer prova social.
- Use linguagem condicional: "pode", "consulte", "simule", "verifique". "Sem placas" e "sem obra" devem aparecer como opção sujeita à consulta, não como garantia universal.
- O tempo no ar ou o texto de outra empresa não comprova conversão nem valida claims.
- Cada primary_text deve começar com gancho curto e terminar com CTA de consulta ou simulação.
- PROIBIDO começar primary_text com: "Entre em contato", "Saiba mais", "Conheça", "Clique aqui", "Olá".
- Use no máximo 1 emoji por texto. Números não são obrigatórios e só podem aparecer se vierem do contexto fornecido.
- Image briefs não podem inventar resultado, comparação antes/depois, depoimento, prazo ou valor.

Exemplo do nível esperado:
- headline: "Simule sua conta de luz"
- primary: "Conta de luz pesando? Simule para verificar se pode haver economia. Fale no zap 👇"`;

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
        // Para primary: descarta abridores fracos ("Entre em contato com a P..." é o sintoma clássico).
        .filter((v) => kind === "headline" || !WEAK_OPENERS.some((r) => r.test(v.text)))
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
          .filter((b: ImageBrief) => b.brief.length > 10 && claimSafe(b.brief))
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
      loadCompetitorReferences(8),
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
