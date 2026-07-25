/**
 * Catálogo canônico de portais / dashboards / atalhos externos
 * usados pela plataforma. Fonte única para a página Super Admin → Portais.
 *
 * Não inclui secrets — só URLs públicas de console, painel ou health.
 */

export type PortalPriority = "critico" | "operacional" | "dev" | "legado";

export interface PortalLink {
  label: string;
  url: string;
  /** Se true, é healthcheck / API, não dashboard humano */
  kind?: "dashboard" | "docs" | "health" | "api" | "billing";
}

export interface PortalProduct {
  id: string;
  name: string;
  description: string;
  category: string;
  priority: PortalPriority;
  /** Destaque pedido explícito do usuário */
  featured?: boolean;
  links: PortalLink[];
  envHints?: string[];
}

export const PORTAL_CATEGORIES = [
  "Canais & Comunicação",
  "IA & LLM",
  "Infra & Hosting",
  "Ads & Captação",
  "Pagamentos",
  "iGreen (produto)",
  "Mídia & Voz",
  "Dados & Observabilidade",
  "Dev & Ferramentas",
  "Utilitários BR",
] as const;

export type PortalCategory = (typeof PORTAL_CATEGORIES)[number];

export const SUPER_ADMIN_PORTALS: PortalProduct[] = [
  // ── Pedido explícito (featured) ──────────────────────────────────────────
  {
    id: "lovable",
    name: "Lovable",
    description:
      "Cloud do projeto + AI Gateway (OpenAI-compatível) para Gemini/GPT — OCR, Cérebro, chat, embeddings.",
    category: "IA & LLM",
    priority: "critico",
    featured: true,
    envHints: ["LOVABLE_API_KEY"],
    links: [
      { label: "Lovable (app)", url: "https://lovable.dev", kind: "dashboard" },
      { label: "Workspace / Secrets", url: "https://lovable.dev/dashboard", kind: "dashboard" },
      { label: "AI Gateway (API)", url: "https://ai.gateway.lovable.dev", kind: "api" },
    ],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    description:
      "OCR conta/doc, intent leve, sync AI audit; direto e via Lovable Gateway (gemini-2.5 / flash).",
    category: "IA & LLM",
    priority: "critico",
    featured: true,
    envHints: ["GEMINI_API_KEY", "GOOGLE_AI_API_KEY"],
    links: [
      { label: "Google AI Studio", url: "https://aistudio.google.com/", kind: "dashboard" },
      { label: "API Keys (AI Studio)", url: "https://aistudio.google.com/apikey", kind: "dashboard" },
      {
        label: "Cloud Console — Generative Language",
        url: "https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com",
        kind: "dashboard",
      },
    ],
  },
  {
    id: "openai",
    name: "OpenAI (GPT)",
    description:
      "Intent-classifier opcional, Vision no sync worker; modelos GPT também via Lovable Gateway.",
    category: "IA & LLM",
    priority: "critico",
    featured: true,
    envHints: ["OPENAI_API_KEY", "OPENAI_VISION_MODEL"],
    links: [
      { label: "Platform OpenAI", url: "https://platform.openai.com/", kind: "dashboard" },
      { label: "API Keys", url: "https://platform.openai.com/api-keys", kind: "dashboard" },
      { label: "Usage", url: "https://platform.openai.com/usage", kind: "billing" },
      { label: "Docs API", url: "https://platform.openai.com/docs", kind: "docs" },
    ],
  },
  {
    id: "velip",
    name: "Velip",
    description:
      "Voz PSTN (Sofia) + SMS MakeSMS na cadência/reheat. Canal de ligação e SMS em produção.",
    category: "Canais & Comunicação",
    priority: "critico",
    featured: true,
    envHints: ["VELIP_API_TOKEN", "VELIP_WEBHOOK_AUTH", "VELIP_CALLER_ID"],
    links: [
      { label: "API v2 (vox)", url: "https://vox.velip.com.br/api/v2", kind: "api" },
      { label: "Docs API", url: "https://api.velip.com.br/", kind: "docs" },
      { label: "MCP Velip", url: "https://vox20.velip.com.br/mcpserver/velip", kind: "api" },
      {
        label: "Docs GitHub (velip-docs)",
        url: "https://github.com/velipbr/velip-docs",
        kind: "docs",
      },
    ],
  },
  {
    id: "easypanel",
    name: "EasyPanel",
    description:
      "VPS: hospeda Evolution, MinIO, workers Portal2 / Club / Sync / compress. Painel da infra.",
    category: "Infra & Hosting",
    priority: "critico",
    featured: true,
    links: [
      { label: "EasyPanel (site / login)", url: "https://easypanel.io", kind: "dashboard" },
      {
        label: "Worker Sync (health)",
        url: "https://igreen-worker-igreen.d9v63q.easypanel.host/health",
        kind: "health",
      },
      {
        label: "Worker Club",
        url: "https://igreen-worker-club.d9v63q.easypanel.host",
        kind: "health",
      },
      {
        label: "MinIO (mídia pública)",
        url: "https://igreen-minio.d9v63q.easypanel.host",
        kind: "dashboard",
      },
      {
        label: "Evolution API (legado)",
        url: "https://igreen-evolution-api.b099mi.easypanel.host",
        kind: "api",
      },
    ],
  },
  {
    id: "whapi",
    name: "Whapi",
    description:
      "WhatsApp primário (superadmin/consultor Whapi). Envio, webhook, health AUTH, botões.",
    category: "Canais & Comunicação",
    priority: "critico",
    featured: true,
    envHints: ["WHAPI_TOKEN", "WHAPI_API_URL", "WHAPI_WEBHOOK_SECRET"],
    links: [
      { label: "Painel Whapi", url: "https://panel.whapi.cloud", kind: "dashboard" },
      { label: "Billing", url: "https://panel.whapi.cloud/billing", kind: "billing" },
      { label: "API Gate", url: "https://gate.whapi.cloud", kind: "api" },
      { label: "Docs Whapi", url: "https://whapi.cloud/docs", kind: "docs" },
    ],
  },

  // ── Demais produtos ──────────────────────────────────────────────────────
  {
    id: "supabase",
    name: "Supabase",
    description: "Auth, Postgres/RLS, Realtime, Storage fallback, ~210 Edge Functions, crons.",
    category: "Infra & Hosting",
    priority: "critico",
    envHints: [
      "VITE_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_ACCESS_TOKEN",
    ],
    links: [
      {
        label: "Dashboard do projeto",
        url: "https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl",
        kind: "dashboard",
      },
      {
        label: "Edge Functions (secrets)",
        url: "https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/settings/functions",
        kind: "dashboard",
      },
      {
        label: "Database",
        url: "https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/editor",
        kind: "dashboard",
      },
      {
        label: "API URL",
        url: "https://zlzasfhcxcznaprrragl.supabase.co",
        kind: "api",
      },
      {
        label: "MCP Supabase",
        url: "https://mcp.supabase.com/mcp?project_ref=zlzasfhcxcznaprrragl",
        kind: "api",
      },
      {
        label: "Access Tokens (CLI)",
        url: "https://supabase.com/dashboard/account/tokens",
        kind: "dashboard",
      },
    ],
  },
  {
    id: "meta",
    name: "Meta / Facebook Ads",
    description:
      "OAuth, campanhas CTWA, métricas, auto-pause, CAPI, Lead Ads, Cérebro MG.",
    category: "Ads & Captação",
    priority: "critico",
    envHints: [
      "FACEBOOK_APP_ID",
      "FACEBOOK_APP_SECRET",
      "FACEBOOK_CAPI_ACCESS_TOKEN",
      "FACEBOOK_CAPI_PIXEL_ID",
    ],
    links: [
      { label: "Business Manager", url: "https://business.facebook.com/", kind: "dashboard" },
      {
        label: "Ads Manager",
        url: "https://business.facebook.com/adsmanager/manage/campaigns",
        kind: "dashboard",
      },
      {
        label: "WhatsApp Manager (números)",
        url: "https://business.facebook.com/wa/manage/phone-numbers/",
        kind: "dashboard",
      },
      {
        label: "WABA (contas WA)",
        url: "https://business.facebook.com/settings/whatsapp-business-accounts",
        kind: "dashboard",
      },
      {
        label: "Páginas",
        url: "https://business.facebook.com/settings/pages",
        kind: "dashboard",
      },
      {
        label: "Developers (apps)",
        url: "https://developers.facebook.com/apps/",
        kind: "dashboard",
      },
      {
        label: "Marketing API errors",
        url: "https://developers.facebook.com/docs/marketing-api/error-reference",
        kind: "docs",
      },
      { label: "Graph API Explorer", url: "https://developers.facebook.com/tools/explorer/", kind: "dashboard" },
    ],
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Top-up carteira do consultor (Ads pré-pago); webhook credita líquido − fee.",
    category: "Pagamentos",
    priority: "critico",
    envHints: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    links: [
      { label: "Dashboard Stripe", url: "https://dashboard.stripe.com/", kind: "dashboard" },
      { label: "Payments", url: "https://dashboard.stripe.com/payments", kind: "dashboard" },
      { label: "Webhooks", url: "https://dashboard.stripe.com/webhooks", kind: "dashboard" },
      { label: "API Keys", url: "https://dashboard.stripe.com/apikeys", kind: "dashboard" },
    ],
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    description: "TTS voz Sofia (Estúdio, cadência WA, ligações Velip); stitch de nome.",
    category: "Mídia & Voz",
    priority: "critico",
    envHints: ["ELEVENLABS_API_KEY"],
    links: [
      { label: "App ElevenLabs", url: "https://elevenlabs.io/app", kind: "dashboard" },
      { label: "Speech Synthesis", url: "https://elevenlabs.io/app/speech-synthesis", kind: "dashboard" },
      { label: "Usage", url: "https://elevenlabs.io/app/usage", kind: "billing" },
      { label: "API Docs", url: "https://elevenlabs.io/docs", kind: "docs" },
    ],
  },
  {
    id: "minio",
    name: "MinIO",
    description: "Storage S3-compatível de áudio/imagem/vídeo/docs; quota no Super Admin.",
    category: "Infra & Hosting",
    priority: "critico",
    envHints: [
      "MINIO_SERVER_URL",
      "MINIO_ROOT_USER",
      "MINIO_PUBLIC_URL",
      "PUBLIC_MEDIA_BASE_URL",
    ],
    links: [
      {
        label: "Host mídia (público)",
        url: "https://igreen-minio.d9v63q.easypanel.host",
        kind: "dashboard",
      },
      { label: "Docs MinIO", url: "https://min.io/docs/minio/linux/index.html", kind: "docs" },
    ],
  },
  {
    id: "evolution",
    name: "Evolution API",
    description:
      "WhatsApp legado (Baileys) para consultores não-Whapi. Self-host no EasyPanel.",
    category: "Canais & Comunicação",
    priority: "legado",
    envHints: ["EVOLUTION_API_URL", "EVOLUTION_API_KEY", "EVOLUTION_WEBHOOK_SECRET"],
    links: [
      {
        label: "Instância EasyPanel",
        url: "https://igreen-evolution-api.b099mi.easypanel.host",
        kind: "api",
      },
      { label: "Docs Evolution", url: "https://doc.evolution-api.com/", kind: "docs" },
    ],
  },
  {
    id: "igreen-portal",
    name: "iGreen — Portal / Digital",
    description: "Cadastro energia (Portal 2); OTP; links de consultor.",
    category: "iGreen (produto)",
    priority: "critico",
    envHints: ["PORTAL2_WORKER_URL", "PORTAL2_WORKER_SECRET"],
    links: [
      {
        label: "Portal Digital",
        url: "https://digital.igreenenergy.com.br",
        kind: "dashboard",
      },
      {
        label: "Autoconexão Green",
        url: "https://green.igreenenergy.com.br/autoconexao",
        kind: "dashboard",
      },
      {
        label: "Expansão",
        url: "https://expansao.igreenenergy.com.br",
        kind: "dashboard",
      },
    ],
  },
  {
    id: "igreen-club",
    name: "iGreen Club",
    description: "Cadastro Club PF via worker-club (JWT /auth/consultor).",
    category: "iGreen (produto)",
    priority: "critico",
    envHints: ["CLUB_WORKER_URL", "WORKER_CLUB_URL", "ALLOW_LIVE_CLUB_POST"],
    links: [
      { label: "Landing Club", url: "https://club.igreenenergy.com.br", kind: "dashboard" },
      { label: "API iGreen", url: "https://api.igreenenergy.com.br", kind: "api" },
      {
        label: "Worker Club (EasyPanel)",
        url: "https://igreen-worker-club.d9v63q.easypanel.host",
        kind: "health",
      },
    ],
  },
  {
    id: "igreen-escritorio",
    name: "iGreen Escritório / Sync",
    description: "Sync carteira via Playwright + API JWT (worker EasyPanel).",
    category: "iGreen (produto)",
    priority: "critico",
    envHints: [
      "IGREEN_SYNC_WORKER_URL",
      "IGREEN_SYNC_WORKER_SECRET",
      "IGREEN_PORTAL_EMAIL",
    ],
    links: [
      {
        label: "Escritório (login)",
        url: "https://escritorio.igreenenergy.com.br/login",
        kind: "dashboard",
      },
      {
        label: "Clientes Green",
        url: "https://escritorio.igreenenergy.com.br/clientes-green",
        kind: "dashboard",
      },
      {
        label: "API-VO",
        url: "https://api-vo.igreenenergy.com.br/v1",
        kind: "api",
      },
      {
        label: "Worker Sync (health)",
        url: "https://igreen-worker-igreen.d9v63q.easypanel.host/health",
        kind: "health",
      },
    ],
  },
  {
    id: "google-solar",
    name: "Google Solar + Maps",
    description: "Análise de telhado 3D, geocode, imagery/heatmap.",
    category: "Ads & Captação",
    priority: "operacional",
    envHints: ["GOOGLE_SOLAR_API_KEY", "GOOGLE_MAPS_API_KEY", "SOLAR_USE_MOCK"],
    links: [
      {
        label: "Cloud Console",
        url: "https://console.cloud.google.com/",
        kind: "dashboard",
      },
      {
        label: "Solar API",
        url: "https://console.cloud.google.com/apis/library/solar.googleapis.com",
        kind: "dashboard",
      },
      {
        label: "Maps Platform",
        url: "https://console.cloud.google.com/google/maps-apis",
        kind: "dashboard",
      },
      {
        label: "Docs Solar API",
        url: "https://developers.google.com/maps/documentation/solar",
        kind: "docs",
      },
    ],
  },
  {
    id: "tiktok",
    name: "TikTok Lead Generation",
    description: "Webhook de leads TikTok → lead-ingest.",
    category: "Ads & Captação",
    priority: "operacional",
    envHints: [
      "TIKTOK_WEBHOOK_SECRET",
      "TIKTOK_ACCESS_TOKEN",
      "TIKTOK_LEADGEN_FALLBACK_CONSULTANT",
    ],
    links: [
      { label: "TikTok Ads", url: "https://ads.tiktok.com/", kind: "dashboard" },
      {
        label: "Marketing API",
        url: "https://business-api.tiktok.com/portal",
        kind: "dashboard",
      },
      {
        label: "Docs Lead Generation",
        url: "https://ads.tiktok.com/help/article/lead-generation",
        kind: "docs",
      },
    ],
  },
  {
    id: "evomi",
    name: "Evomi (proxy residencial)",
    description: "Contorna Cloudflare/WAF no Club e Sync (proxy sticky).",
    category: "Infra & Hosting",
    priority: "operacional",
    envHints: ["PROXY_URL", "CLUB_PROXY_SERVER", "CLUB_PROXY_USER", "IGREEN_PROXY_STICKY"],
    links: [
      { label: "Evomi", url: "https://evomi.com/", kind: "dashboard" },
      {
        label: "Host proxy (core-residential)",
        url: "https://evomi.com/",
        kind: "api",
      },
    ],
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    description:
      "WAF dos sites iGreen (externo). Workers tratam 403/challenge — sem SDK no app.",
    category: "Infra & Hosting",
    priority: "operacional",
    links: [
      { label: "Cloudflare Dashboard", url: "https://dash.cloudflare.com/", kind: "dashboard" },
    ],
  },
  {
    id: "github",
    name: "GitHub",
    description: "Repo igreen-page-magic; CI; deploy de edges via workflow_dispatch.",
    category: "Dev & Ferramentas",
    priority: "critico",
    envHints: ["GITHUB_PERSONAL_ACCESS_TOKEN", "SUPABASE_ACCESS_TOKEN"],
    links: [
      {
        label: "Repositório",
        url: "https://github.com/tvmensal2025/igreen-page-magic",
        kind: "dashboard",
      },
      {
        label: "Actions",
        url: "https://github.com/tvmensal2025/igreen-page-magic/actions",
        kind: "dashboard",
      },
      {
        label: "Deploy edges (workflow)",
        url: "https://github.com/tvmensal2025/igreen-page-magic/actions/workflows/deploy-edge-functions.yml",
        kind: "dashboard",
      },
    ],
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Erros front (@sentry/react) + edges (_shared/sentry.ts).",
    category: "Dados & Observabilidade",
    priority: "operacional",
    envHints: ["VITE_SENTRY_DSN", "SENTRY_DSN", "SENTRY_AUTH_TOKEN"],
    links: [
      { label: "Sentry", url: "https://sentry.io/", kind: "dashboard" },
      { label: "Issues", url: "https://sentry.io/issues/", kind: "dashboard" },
    ],
  },
  {
    id: "turn-webrtc",
    name: "TURN / WebRTC (suporte remoto)",
    description: "STUN/TURN para /super-admin/suporte em NAT simétrico (Metered / Twilio / Xirsys).",
    category: "Canais & Comunicação",
    priority: "operacional",
    envHints: ["VITE_TURN_URL", "VITE_TURN_USER", "VITE_TURN_PASS"],
    links: [
      { label: "Metered STUN/TURN", url: "https://www.metered.ca/stun-turn", kind: "dashboard" },
      {
        label: "OpenRelay (community)",
        url: "https://www.metered.ca/tools/openrelay",
        kind: "docs",
      },
      {
        label: "Twilio STUN/TURN",
        url: "https://www.twilio.com/en-us/stun-turn",
        kind: "dashboard",
      },
      { label: "Xirsys", url: "https://xirsys.com/", kind: "dashboard" },
    ],
  },
  {
    id: "twilio",
    name: "Twilio Voice (legado)",
    description: "Código Voice antigo — produção usa Velip. Ainda opção de TURN.",
    category: "Canais & Comunicação",
    priority: "legado",
    envHints: [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_FROM_NUMBER",
    ],
    links: [
      { label: "Console Twilio", url: "https://console.twilio.com/", kind: "dashboard" },
    ],
  },
  {
    id: "playwright",
    name: "Playwright",
    description: "E2E (@playwright/test); automação Sync; MCP browser.",
    category: "Dev & Ferramentas",
    priority: "dev",
    links: [
      { label: "Playwright", url: "https://playwright.dev/", kind: "docs" },
      { label: "Trace Viewer", url: "https://trace.playwright.dev/", kind: "dashboard" },
    ],
  },
  {
    id: "context7",
    name: "Context7",
    description: "Docs atualizadas no IDE (Supabase, React, Stripe…) via MCP.",
    category: "Dev & Ferramentas",
    priority: "dev",
    envHints: ["CONTEXT7_API_KEY"],
    links: [
      { label: "Context7", url: "https://context7.com/", kind: "dashboard" },
      { label: "Docs MCP", url: "https://context7.com/docs", kind: "docs" },
    ],
  },
  {
    id: "testsprite",
    name: "TestSprite",
    description: "Análise/testes cloud E2E via MCP.",
    category: "Dev & Ferramentas",
    priority: "dev",
    envHints: ["TESTSPRITE_API_KEY"],
    links: [
      {
        label: "Dashboard / API Key",
        url: "https://www.testsprite.com/dashboard/settings/apikey",
        kind: "dashboard",
      },
      { label: "TestSprite", url: "https://www.testsprite.com/", kind: "dashboard" },
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    description: "IDE agentic; browser MCP; skills do projeto.",
    category: "Dev & Ferramentas",
    priority: "dev",
    links: [
      { label: "Cursor", url: "https://cursor.com/", kind: "dashboard" },
      { label: "Docs Cursor", url: "https://docs.cursor.com/", kind: "docs" },
      { label: "Dashboard conta", url: "https://cursor.com/dashboard", kind: "dashboard" },
    ],
  },
  {
    id: "figma",
    name: "Figma",
    description: "Design via MCP Figma no Cursor (plugin).",
    category: "Dev & Ferramentas",
    priority: "dev",
    links: [
      { label: "Figma", url: "https://www.figma.com/", kind: "dashboard" },
    ],
  },
  {
    id: "viacep",
    name: "ViaCEP",
    description: "CEP → endereço (bot, captação, Club, Portal).",
    category: "Utilitários BR",
    priority: "operacional",
    links: [
      { label: "ViaCEP", url: "https://viacep.com.br/", kind: "docs" },
      {
        label: "Exemplo API",
        url: "https://viacep.com.br/ws/01310100/json/",
        kind: "api",
      },
    ],
  },
  {
    id: "ibge",
    name: "IBGE Localidades",
    description: "UFs / municípios (Club uf_select; seed).",
    category: "Utilitários BR",
    priority: "operacional",
    links: [
      {
        label: "API Localidades",
        url: "https://servicodados.ibge.gov.br/api/docs/localidades",
        kind: "docs",
      },
      {
        label: "Estados",
        url: "https://servicodados.ibge.gov.br/api/v1/localidades/estados",
        kind: "api",
      },
    ],
  },
  {
    id: "osm",
    name: "OpenStreetMap / Nominatim / Overpass",
    description: "Captação/pesquisa de leads por cidade (geocode + POIs).",
    category: "Utilitários BR",
    priority: "operacional",
    links: [
      { label: "Nominatim", url: "https://nominatim.openstreetmap.org/", kind: "dashboard" },
      { label: "Overpass Turbo", url: "https://overpass-turbo.eu/", kind: "dashboard" },
      { label: "Overpass API", url: "https://overpass-api.de/", kind: "api" },
      { label: "OpenStreetMap", url: "https://www.openstreetmap.org/", kind: "dashboard" },
    ],
  },
  {
    id: "whatsapp-web",
    name: "WhatsApp (links wa.me)",
    description: "Links em SMS/templates para abrir chat do consultor.",
    category: "Canais & Comunicação",
    priority: "operacional",
    links: [
      { label: "wa.me (base)", url: "https://wa.me/", kind: "api" },
      {
        label: "api.whatsapp.com/send",
        url: "https://api.whatsapp.com/send",
        kind: "api",
      },
    ],
  },
  {
    id: "redis",
    name: "Redis",
    description: "Fila dos workers Portal2/Club (EasyPanel; ex. evolution-api-redis).",
    category: "Infra & Hosting",
    priority: "operacional",
    envHints: ["REDIS_URL"],
    links: [
      { label: "Redis Docs", url: "https://redis.io/docs/", kind: "docs" },
      {
        label: "Gerenciar via EasyPanel",
        url: "https://easypanel.io",
        kind: "dashboard",
      },
    ],
  },
];

export function portalsByCategory(): Map<string, PortalProduct[]> {
  const map = new Map<string, PortalProduct[]>();
  for (const cat of PORTAL_CATEGORIES) map.set(cat, []);
  for (const p of SUPER_ADMIN_PORTALS) {
    const list = map.get(p.category) ?? [];
    list.push(p);
    map.set(p.category, list);
  }
  return map;
}

export function featuredPortals(): PortalProduct[] {
  return SUPER_ADMIN_PORTALS.filter((p) => p.featured);
}

export function countPortalLinks(): number {
  return SUPER_ADMIN_PORTALS.reduce((n, p) => n + p.links.length, 0);
}
