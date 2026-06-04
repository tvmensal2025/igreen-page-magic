export interface CampaignTemplate {
  id: string;
  consultant_id: string;
  name: string;
  anchor_city: string;
  radius_km: number;
  age_min: number;
  age_max: number;
  interests: string[];
  daily_budget_brl: number;
  creative_title: string;
  copy_text: string;
  video_url: string;
  destination_url: string;
  utm_campaign: string;
  observations: string;
  created_at?: string;
  updated_at?: string;
}

export function slugify(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export function buildDestinationUrlWithUtm(t: Pick<CampaignTemplate, "destination_url" | "utm_campaign" | "name">): string {
  const base = (t.destination_url || "https://igreen.cloud/").trim();
  const campaign = (t.utm_campaign || slugify(t.name) || "campanha").trim();
  const url = new URL(base);
  url.searchParams.set("utm_source", "meta");
  url.searchParams.set("utm_medium", "cpc");
  url.searchParams.set("utm_campaign", campaign);
  return url.toString();
}

export const DEFAULT_UBERLANDIA_TEMPLATE: Omit<CampaignTemplate, "id" | "consultant_id" | "created_at" | "updated_at"> = {
  name: "Uberlândia 100km — 28% Análise",
  anchor_city: "Uberlândia, MG",
  radius_km: 100,
  age_min: 28,
  age_max: 65,
  interests: [
    "Proprietários de imóveis",
    "Conta de luz / Energia elétrica / Cemig",
    "Pequenas empresas / Donos de empresa",
    "Sustentabilidade / Energia solar",
  ],
  daily_budget_brl: 70,
  creative_title: "Análise de 28% de economia",
  copy_text:
    "Sua conta de luz pode ficar até 28% mais barata sem obra, sem troca de fiação e sem instalar nada. Faça sua análise gratuita em 2 minutos. ⚡",
  video_url: "",
  destination_url: "https://igreen.cloud/",
  utm_campaign: "uberlandia_100km",
  observations:
    "Usar o mesmo vídeo da campanha 28% Análise. Formulário Instantâneo (Lead). Não editar nos 4 primeiros dias. 1 criativo + 1 público — não fragmentar.",
};

export function generateMetaAdsConfig(t: CampaignTemplate): string {
  const url = buildDestinationUrlWithUtm(t);
  const interests = t.interests.length
    ? t.interests.map((i) => `  • ${i}`).join("\n")
    : "  • (defina interesses)";

  return `══════════════════════════════════════════════
 CAMPANHA META ADS — ${t.name}
══════════════════════════════════════════════

🎯 OBJETIVO
  Cadastros (Leads) — Formulário Instantâneo do Facebook
  (Alternativa: Conversões com Pixel + evento Lead em ${t.destination_url})

💰 ORÇAMENTO
  R$ ${t.daily_budget_brl.toFixed(2)}/dia (CBO — Advantage Campaign Budget)
  Estratégia de lance: Volume mais alto (sem limite de custo)
  Início imediato, sem data de término

📍 CONJUNTO DE ANÚNCIOS (1 só — não fragmentar)
  • Localização: ${t.anchor_city} — raio ${t.radius_km} km
    "Pessoas que moram neste local"
  • Idade: ${t.age_min}–${t.age_max}
  • Gênero: Todos
  • Idioma: Português

🎯 SEGMENTAÇÃO DETALHADA (Advantage detailed targeting ON)
${interests}

📱 POSICIONAMENTOS
  Advantage+ (automático — Feed, Stories, Reels, Explore, etc.)

⚙️ OTIMIZAÇÃO DA ENTREGA
  Leads

🎬 CRIATIVO
  Vídeo: ${t.video_url || "(cole aqui a URL do vídeo)"}
  Título principal: ${t.creative_title}
  Texto principal (copy):
  ─────────────────────────────────────────
  ${t.copy_text}
  ─────────────────────────────────────────
  CTA: "Cadastre-se" (formulário) ou "Saiba mais" (tráfego)
  URL: ${url}

📝 OBSERVAÇÕES
${t.observations || "  —"}

✅ REGRAS DE OURO (gastar pouco, captar muito)
  1. 1 criativo + 1 público — nunca fragmentar
  2. Não editar a campanha nos primeiros 4 dias (zera aprendizado)
  3. Deixar a IA do Meta otimizar 7 dias antes de qualquer ajuste
  4. Formulário instantâneo > tráfego para site (CPL menor)
  5. Se o CPL passar de R$15 após 7 dias, trocar o título primeiro
`;
}
