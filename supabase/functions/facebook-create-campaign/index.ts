// Cria Campaign + AdSet (Click-to-WhatsApp) + Ad com criativo a partir das fotos.
import {
  adminClient,
  authConsultant,
  corsHeaders,
  fbFetch,
  getOrCreateWallet,
  loadConsultantAdSettings,
  loadPlatformAccount,
} from "../_shared/fb-graph.ts";
import { notifyConsultant } from "../_shared/notify-consultant.ts";

interface Body {
  name: string;
  cities: { key: string; name: string }[];
  // Segmentação por endereço/raio (sobrepõe cities quando preenchido).
  // Cada ponto: lat/lng + raio em km (1 a 50) + endereço.
  custom_locations?: {
    latitude: number;
    longitude: number;
    radius: number; // km
    address_string?: string;
    name?: string;
  }[];
  daily_budget_cents: number;
  duration_days?: number | null;
  age_min?: number;
  age_max?: number;
  // Modo do criativo: "photo" (padrão) ou "video" (1 vídeo Reels/Stories).
  creative_mode?: "photo" | "video";
  // Cada foto traz seu formato original — usado pra montar asset_feed_spec
  // com customization por posicionamento. Aceita string[] legado (= square).
  photos?: ({ url: string; format: "square" | "vertical" | "story" } | string)[];
  // Vídeo único (modo "video"). Quando presente, ignora photos.
  video?: { url: string; thumb_url?: string };
  headline: string;
  primary_text: string;
  description?: string;
  distribuidora?: string;
  // Quando publicado a partir da galeria de templates do Super Admin.
  // Se presente, fotos/textos/idade/orçamento podem ser sobrescritos pelo template
  // (apenas se o cliente não passou um valor explícito) e gravamos o uso.
  template_id?: string | null;
  // Placements: "auto" = Advantage+ Placements (recomendação Meta — distribui
  // automaticamente em todos os elegíveis para CTWA). "manual" = usa lista em `placements`.
  placement_mode?: "auto" | "manual";
  // Lista de placements no formato "fb:feed", "fb:reels", "ig:reels", etc.
  placements?: string[];
  // Primeira mensagem que abre no WhatsApp ao clicar no anúncio (CTWA).
  // Texto curto, em 1ª pessoa, do ponto de vista do lead. Max 160 chars.
  initial_message?: string;
}

function buildInitialMessage(raw: string | undefined, distribuidora?: string): string {
  const clean = (raw || "").replace(/[\r\n]+/g, " ").trim();
  if (clean) return clean.slice(0, 160);
  const d = (distribuidora || "").trim();
  return d
    ? `Olá! Quero saber mais sobre a redução na conta de luz ${d}.`.slice(0, 160)
    : "Olá! Quero saber mais sobre a redução na minha conta de luz.";
}

const WA_BUSINESS_REQUIRED_SUBCODE = "2446885";
const WA_BUSINESS_REQUIRED_MESSAGE =
  "A Página selecionada está vinculada a um WhatsApp pessoal. Para publicar anúncio de WhatsApp, conecte uma conta WhatsApp Business à Página no Meta Business Suite e depois selecione os assets novamente.";

function campaignErrorResponse(err: unknown) {
  const message = (err as Error)?.message || "Erro inesperado ao criar campanha.";
  if (message.includes(WA_BUSINESS_REQUIRED_SUBCODE) || message.includes("conta pessoal")) {
    return new Response(JSON.stringify({
      error: WA_BUSINESS_REQUIRED_MESSAGE,
      code: "WHATSAPP_BUSINESS_REQUIRED",
      meta_error: message,
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  let consultantIdForAlert: string | null = null;
  try {
    const auth = await authConsultant(req);
    if (!auth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    consultantIdForAlert = auth.id;

    const body = await req.json() as Body;

    // ─── Template (galeria pública) ──────────────────────────────────────
    // Se vier template_id, carrega e usa fotos/copy/segmentação/orçamento do
    // template como FALLBACK (cliente pode sobrescrever). Substitui placeholders
    // {cidade} / {distribuidora} / {nome_consultor} server-side.
    let templateRow: any = null;
    if (body.template_id) {
      const admin0 = adminClient();
      const { data: t } = await admin0
        .from("ad_templates")
        .select("*")
        .eq("id", body.template_id)
        .maybeSingle();
      if (!t || t.status !== "published") {
        return new Response(JSON.stringify({ error: "Template indisponível ou despublicado." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      templateRow = t;
      const { data: cRow } = await admin0
        .from("consultants")
        .select("name")
        .eq("id", auth.id)
        .maybeSingle();
      const consultantName = cRow?.name || "iGreen";
      const firstCity = body.cities?.[0]?.name || "sua cidade";
      const distrib = body.distribuidora || "sua distribuidora";
      const fill = (s: string) => (s || "")
        .replaceAll("{cidade}", firstCity)
        .replaceAll("{distribuidora}", distrib)
        .replaceAll("{nome_consultor}", consultantName);

      if (!body.photos?.length && Array.isArray(t.photos)) body.photos = t.photos as any;
      if (!body.headline) body.headline = fill(t.headline);
      else body.headline = fill(body.headline);
      if (!body.primary_text) body.primary_text = fill(t.primary_text);
      else body.primary_text = fill(body.primary_text);
      if (!body.description && t.description_text) body.description = fill(t.description_text);
      if (body.age_min == null) body.age_min = t.age_min;
      if (body.age_max == null) body.age_max = t.age_max;
      if (!body.daily_budget_cents) body.daily_budget_cents = t.suggested_daily_budget_cents;

      // A/B test: empilha variações do template (placeholders preenchidos) no body
      const hvar = Array.isArray(t.headline_variants) ? t.headline_variants : [];
      const pvar = Array.isArray(t.primary_text_variants) ? t.primary_text_variants : [];
      (body as any).__variants = {
        headlines: hvar.map(fill).filter(Boolean),
        primary_texts: pvar.map(fill).filter(Boolean),
      };
    }

    const creativeMode: "photo" | "video" = body.creative_mode === "video" ? "video" : "photo";
    const hasCustomLocations = Array.isArray(body.custom_locations) && body.custom_locations.length > 0;
    const hasCities = Array.isArray(body.cities) && body.cities.length > 0;
    const hasCreative = creativeMode === "video"
      ? !!(body.video && body.video.url)
      : !!(body.photos && body.photos.length);
    if ((!hasCities && !hasCustomLocations) || !body.daily_budget_cents || !hasCreative || !body.headline || !body.primary_text) {
      return new Response(JSON.stringify({ error: "Campos obrigatórios faltando (localização, criativo, headline ou texto)." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Mínimo R$ 10/dia (Meta aceita a partir de ~R$ 6/dia em CTWA, mas <R$10
    // o aprendizado fica muito lento). UI também recomenda R$20 como sweet spot.
    if (body.daily_budget_cents < 1000) {
      return new Response(JSON.stringify({ error: "Orçamento mínimo é R$ 10/dia." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Admin (Super Admin) usa a conta Facebook da plataforma diretamente —
    // bypass dos guardrails de carteira (ele paga via cartão na conta Meta).
    const adminDb = adminClient();
    const { data: adminRole } = await adminDb
      .from("user_roles").select("role")
      .eq("user_id", auth.id).eq("role", "admin").maybeSingle();
    const isAdmin = !!adminRole;

    // GUARDRAIL: saldo da carteira precisa cobrir pelo menos N dias do orçamento
    // (com o markup já aplicado), senão a campanha pausa antes de gerar resultado.
    if (!isAdmin) {
      const admin = adminDb;
      const { data: ps } = await admin.from("platform_settings").select("*").eq("id", true).maybeSingle();
      const feePct = Number(ps?.platform_fee_percent ?? 20) / 100;
      // Mínimo de 3 dias (era 7) — permite teste rápido "gastar pouco para validar".
      // O usuário pode subir o orçamento depois quando o anúncio começar a entregar.
      const minDays = 3;
      const safety = Math.max(Number(ps?.campaign_safety_multiplier ?? 1.0), minDays);
      const minBalance = Number(ps?.min_balance_to_create_campaign_cents ?? 3000);
      const requiredCents = Math.max(minBalance, Math.round(body.daily_budget_cents * (1 + feePct) * safety));
      const { data: w } = await admin.from("consultant_wallet")
        .select("balance_cents").eq("consultant_id", auth.id).maybeSingle();
      const balance = Number(w?.balance_cents ?? 0);
      if (balance < requiredCents) {
        return new Response(JSON.stringify({
          error: `Saldo insuficiente. Mínimo recomendado para esta campanha: R$ ${(requiredCents/100).toFixed(2)} (você tem R$ ${(balance/100).toFixed(2)}). Recarregue na carteira.`,
          code: "INSUFFICIENT_WALLET_BALANCE",
          required_cents: requiredCents,
          balance_cents: balance,
        }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Carrega a conta Facebook ÚNICA da plataforma (admin) — todos consultores
    // rodam ads na mesma ad account/página/pixel, mudando só o telefone do CTA.
    const platform = await loadPlatformAccount();
    if (!platform?.ad_account_id || !platform.page_id) {
      return new Response(JSON.stringify({
        error: "A conta Facebook da plataforma ainda não foi configurada. Peça ao Super Admin para conectar.",
        code: "PLATFORM_FB_NOT_CONFIGURED",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Audiências da plataforma (LAL + Custom) — aplicadas no targeting pra
    // levar o algoritmo direto pro perfil dos clientes pagantes reais.
    const { data: pfAud } = await adminClient()
      .from("platform_facebook_account")
      .select("custom_audience_id, lookalike_audience_id")
      .eq("id", true)
      .maybeSingle();
    const platformLalId = pfAud?.lookalike_audience_id || null;
    const platformCustomAudId = pfAud?.custom_audience_id || null;
    // Configurações específicas do consultor: telefone WhatsApp + cidades.
    const settings = await loadConsultantAdSettings(auth.id);
    const waDigitsRaw = String(settings?.whatsapp_destination_number || "").replace(/\D/g, "");
    if (!waDigitsRaw) {
      return new Response(JSON.stringify({
        error: "Não encontramos seu número de WhatsApp. Adicione na aba Dados antes de publicar.",
        code: "WHATSAPP_NOT_CONFIGURED",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Aceita formato BR: 55 + DDD (2) + número (8 ou 9). Se vier sem 55, prefixa.
    const waNumberSetting = waDigitsRaw.startsWith("55") ? waDigitsRaw : `55${waDigitsRaw}`;
    if (waNumberSetting.length < 12 || waNumberSetting.length > 13) {
      return new Response(JSON.stringify({
        error: `Número de WhatsApp inválido (${waNumberSetting}). Use 55 + DDD + número (ex: 5511990092401). Corrija na aba Dados.`,
        code: "WHATSAPP_INVALID_FORMAT",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Trava de saldo: precisa cobrir budget × duração (default 7 dias se omitido).
    const wallet = await getOrCreateWallet(auth.id);
    const dur = body.duration_days && body.duration_days > 0 ? body.duration_days : 7;
    const requiredCents = body.daily_budget_cents * dur;
    if (!isAdmin && wallet.balance_cents < requiredCents) {
      return new Response(JSON.stringify({
        error: `Saldo insuficiente. Você precisa de R$ ${(requiredCents / 100).toFixed(2)} mas tem R$ ${(wallet.balance_cents / 100).toFixed(2)}. Adicione crédito antes de publicar.`,
        code: "INSUFFICIENT_BALANCE",
        balance_cents: wallet.balance_cents,
        required_cents: requiredCents,
      }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Adapter: mantém o resto do código falando com "conn".
    // PIXEL TRAVADO: todo novo anúncio sai com o pixel oficial da plataforma,
    // independente do que estiver salvo em platform_facebook_account.pixel_id.
    const REQUIRED_PIXEL_ID = "1521037349653769";
    if (platform.pixel_id && platform.pixel_id !== REQUIRED_PIXEL_ID) {
      console.warn(`[fb-create-campaign] platform.pixel_id=${platform.pixel_id} difere do REQUIRED_PIXEL_ID=${REQUIRED_PIXEL_ID}; usando o travado.`);
    }
    const conn = {
      token: platform.token,
      ad_account_id: platform.ad_account_id,
      page_id: platform.page_id,
      pixel_id: REQUIRED_PIXEL_ID,
      ig_account_id: platform.ig_account_id,
      whatsapp_phone_number_id: null as string | null,
      whatsapp_destination_number: waNumberSetting,
    };

    const accId = conn.ad_account_id; // já vem com prefixo act_
    // Idade ampliada por padrão (25-65) — mais inventário = CPM/CPL mais baixo.
    // Advantage+ audience exige age_min <= 25 (subcode 1870188). Cap defensivo.
    const ageMin = Math.min(body.age_min ?? 25, 25);
    // Advantage+ exige age_max >= 65 (subcode 1870189). Cap defensivo.
    const ageMax = Math.max(body.age_max ?? 65, 65);
    const today = new Date().toISOString().slice(0, 10);
    const cityNames = body.cities.map((c) => c.name).slice(0, 3).join(", ");
    // Tag de consultor profissional: usa license iGreen (ID curto e estável)
    // pra padronizar nomes no Gerenciador e facilitar relatórios por consultor.
    const adminDb2 = adminClient();
    const { data: consultantRow } = await adminDb2
      .from("consultants")
      .select("name, license, facebook_label_id")
      .eq("id", auth.id)
      .maybeSingle();
    const consultantLicense = consultantRow?.license || auth.id.slice(0, 8);
    const consultantName = consultantRow?.name || settings?.display_name || "Consultor";
    const consultantTag = `CONS-${consultantLicense}`;
    const distribTag = body.distribuidora || cityNames || "iGreen";
    const cityPrincipal = body.cities[0]?.name || cityNames;
    const campaignName = body.name
      ? `[${consultantTag}] ${distribTag} · ${body.name} · ${today}`
      : `[${consultantTag}] ${distribTag} · ${cityPrincipal} · ${today}`;

    // Adlabel nativo do Meta — uma label por consultor, cacheada em
    // consultants.facebook_label_id. Permite filtrar campanhas no Gerenciador
    // por "Label = consultor:LICENSE".
    let consultantLabelId = consultantRow?.facebook_label_id || null;
    if (!consultantLabelId) {
      try {
        const labelName = `consultor:${consultantLicense}:${consultantName}`.slice(0, 100);
        const lr = await fbFetch(`/${accId}/adlabels`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ name: labelName, access_token: conn.token }),
        });
        if (lr?.id) {
          consultantLabelId = lr.id;
          await adminDb2.from("consultants").update({ facebook_label_id: consultantLabelId }).eq("id", auth.id);
        }
      } catch (e) {
        console.warn("[fb-create] criar adlabel falhou (segue sem):", (e as Error).message);
      }
    }
    const adlabelsParam = consultantLabelId ? JSON.stringify([{ id: consultantLabelId }]) : null;

    // CTWA OFICIAL via WABA — número precisa estar conectado à Página no Meta Business
    // Suite (WhatsApp Business API). Otimiza por CONVERSATIONS (mais barato que LINK_CLICKS),
    // atribuição nativa anúncio ↔ primeira mensagem, casa com pixel + CAPI via promoted_object.
    const hasPixel = !!conn.pixel_id;
    const objective = "OUTCOME_ENGAGEMENT";
    const optimizationGoal = "CONVERSATIONS";
    const pixelEvent = hasPixel ? "LEAD" : null;
    if (!conn.whatsapp_destination_number) {
      throw new Error("WHATSAPP_BUSINESS_REQUIRED: número WhatsApp Business (WABA) não configurado para esta Página.");
    }

    // 1) Campaign
    console.log("[fb-create] step=campaign_create");
    const camp = await fbFetch(`/${accId}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name: campaignName,
        objective,
        special_ad_categories: JSON.stringify([]),
        status: "PAUSED",
        buying_type: "AUCTION",
        daily_budget: String(body.daily_budget_cents),
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        ...(adlabelsParam ? { adlabels: adlabelsParam } : {}),
        access_token: conn.token,
      }),
    });
    const campaignId = camp.id as string;

    // 2) AdSet — destination WhatsApp
    // Targeting "leve" pra reduzir CPL:
    // - cidades SEM radius (apenas o município escolhido, sem cidades vizinhas)
    // - SEM interests fixos: deixa o algoritmo achar o público (Advantage+ Audience)
    // - Placements automáticos só FB + IG (messenger não combina com destination=WHATSAPP)
    const targeting: Record<string, unknown> = {
      geo_locations: {
        // Apenas a cidade escolhida (sem radius/distance_unit) — Meta interpreta
        // como exclusivamente o município, sem expandir para o entorno.
        cities: body.cities.map((c) => ({ key: c.key })),
        location_types: ["home", "recent"],
      },
      age_min: ageMin,
      age_max: ageMax,
      // Advantage+ Audience (padrão Meta 2026) — algoritmo expande além das âncoras.
      // Meta EXIGE age_min<=25 e age_max>=65 explícitos (subcodes 1870188/1870189).
      targeting_automation: { advantage_audience: 1 },
    };
    // Placements: por padrão omite tudo → Meta aplica Advantage+ Placements
    // (recomendação oficial p/ CTWA, distribui em TODOS os elegíveis e otimiza CPL).
    // Modo manual: respeita lista do usuário (formato "fb:feed", "ig:reels", ...).
    const placementMode = body.placement_mode || "auto";
    if (placementMode === "manual" && Array.isArray(body.placements) && body.placements.length) {
      const fbPos: string[] = [];
      const igPos: string[] = [];
      for (const p of body.placements) {
        const [plat, pos] = p.split(":");
        if (plat === "fb" && pos) fbPos.push(pos);
        else if (plat === "ig" && pos) igPos.push(pos);
      }
      const platforms: string[] = [];
      if (fbPos.length) platforms.push("facebook");
      if (igPos.length) platforms.push("instagram");
      if (platforms.length) {
        (targeting as any).publisher_platforms = platforms;
        if (fbPos.length) (targeting as any).facebook_positions = fbPos;
        if (igPos.length) (targeting as any).instagram_positions = igPos;
      }
    }
    // Lookalike de clientes pagantes como âncora (Advantage+ expande a partir dela).
    // Excluimos a Custom Audience de clientes ativos pra não gastar verba com gente que já é cliente.
    if (platformLalId) {
      (targeting as any).custom_audiences = [{ id: platformLalId }];
    }
    if (platformCustomAudId) {
      (targeting as any).excluded_custom_audiences = [{ id: platformCustomAudId }];
    }
    // CTWA WABA: destination=WHATSAPP + promoted_object liga anúncio ↔ número WABA.
    // Tracking specs: messaging_first_reply (Meta nativo) + offsite_conversion via pixel/CAPI.
    const waNumberClean = String(conn.whatsapp_destination_number).replace(/\D/g, "");
    const promotedObject: Record<string, string> = {
      page_id: conn.page_id,
      whatsapp_phone_number: waNumberClean,
    };
    const trackingSpecs: any[] = [
      { "action.type": ["onsite_conversion.messaging_first_reply"] },
    ];
    if (hasPixel) {
      trackingSpecs.push({ "action.type": ["offsite_conversion"], fb_pixel: [conn.pixel_id] });
    }
    const adsetParams: Record<string, string> = {
      name: `[${consultantTag}] ${distribTag} · Conjunto Principal · ${cityPrincipal}`,
      campaign_id: campaignId,
      billing_event: "IMPRESSIONS",
      optimization_goal: optimizationGoal,
      destination_type: "WHATSAPP",
      promoted_object: JSON.stringify(promotedObject),
      tracking_specs: JSON.stringify(trackingSpecs),
      targeting: JSON.stringify(targeting),
      status: "PAUSED",
      // frequency_control_specs só é aceito com optimization_goal=REACH (Meta).
      ...(optimizationGoal === "REACH"
        ? { frequency_control_specs: JSON.stringify([{ event: "IMPRESSIONS", interval_days: 7, max_frequency: 3 }]) }
        : {}),
      ...(adlabelsParam ? { adlabels: adlabelsParam } : {}),
      access_token: conn.token,
    };
    // Janela do adset precisa ser ≥ 24 h (Meta subcode 1487793). Soma 1 h de buffer pra absorver clock skew.
    const startAt = Date.now() + 60_000;
    adsetParams.start_time = new Date(startAt).toISOString();
    const days = Math.max(1, body.duration_days ?? 7);
    adsetParams.end_time = new Date(startAt + days * 86400_000 + 3_600_000).toISOString();
    console.log("[fb-create] step=adset_create campaign=", campaignId);
    const adset = await fbFetch(`/${accId}/adsets`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(adsetParams),
    });
    const adsetId = adset.id as string;

    // 3) Upload de imagens — preserva o formato (square / vertical / story).
    type Tagged = { url: string; format: "square" | "vertical" | "story" };
    const tagged: Tagged[] = body.photos.slice(0, 10).map((p) =>
      typeof p === "string" ? { url: p, format: "square" as const } : p,
    );

    // 3.0) SEM validação Gemini síncrona aqui — estourava CPU da Edge Function (546).
    // A análise de imagem virou job assíncrono via ad-image-validator (preflight separado).
    const validated: Tagged[] = tagged;
    const rejectedImages: { url: string; issues: string[]; suggestion?: string }[] = [];

    // base64 em chunks (não loop byte-a-byte) — reduz CPU em ~10x
    function bytesToBase64(buf: Uint8Array): string {
      const CHUNK = 0x8000;
      let bin = "";
      for (let i = 0; i < buf.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + CHUNK)) as any);
      }
      return btoa(bin);
    }

    console.log("[fb-create] step=images_start count=", validated.length);
    const uploaded: { hash: string; format: "square" | "vertical" | "story" }[] = [];
    const uploadErrors: string[] = [];
    const adminImg = adminClient();
    const FB_GRAPH = "https://graph.facebook.com/v23.0";

    // Limita a 5 imagens por publicação pra ficar dentro do CPU budget.
    for (const item of validated.slice(0, 5)) {
      const url = item.url;
      const filename = url.split("/").pop()?.split("?")[0] || `img_${Date.now()}.jpg`;
      let hash: string | null = null;

      // Estratégia 0: hash cacheado em ad_image_library — pula chamada à Meta.
      try {
        const { data: cached } = await adminImg
          .from("ad_image_library").select("id, fb_image_hash, usage_count")
          .eq("consultant_id", auth.id).eq("url", url).maybeSingle();
        if (cached?.fb_image_hash) {
          hash = cached.fb_image_hash;
          await adminImg.from("ad_image_library").update({
            usage_count: ((cached as any).usage_count ?? 0) + 1,
            last_used_at: new Date().toISOString(),
          }).eq("id", cached.id);
          console.log("[fb-create] image_hash CACHE HIT", filename, hash);
        }
      } catch (e) { console.warn("[fb-create] cache lookup falhou:", (e as Error).message); }

      // Estratégia 1: multipart binário (oficial, mais confiável).
      if (!hash) {
        try {
          const imgResp = await fetch(url);
          if (!imgResp.ok) throw new Error(`download ${imgResp.status}`);
          const blob = await imgResp.blob();
          const fd = new FormData();
          fd.append("source", blob, filename);
          fd.append("access_token", conn.token);
          const r = await fetch(`${FB_GRAPH}/${accId}/adimages`, { method: "POST", body: fd });
          const j = await r.json();
          if (!r.ok) {
            const msg = j?.error?.error_user_msg || j?.error?.message || `HTTP ${r.status}`;
            throw new Error(msg);
          }
          hash = j?.images && Object.values(j.images)[0] ? (Object.values(j.images)[0] as any).hash : null;
          if (!hash) throw new Error("response sem hash");
        } catch (e1) {
          console.warn("[fb-create] multipart falhou, fallback url:", filename, (e1 as Error).message);
          // Estratégia 2: parâmetro url (Meta baixa direto).
          try {
            const r = await fbFetch(`/${accId}/adimages`, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ url, name: filename, access_token: conn.token }),
            });
            hash = r?.images && Object.values(r.images)[0] ? (Object.values(r.images)[0] as any).hash : null;
            if (!hash) throw new Error("response sem hash");
          } catch (e2) {
            console.error("[fb-create] upload imagem falhou em todas tentativas:", filename, (e2 as Error).message);
            uploadErrors.push(`${filename}: ${(e1 as Error).message}`);
          }
        }
      }

      if (hash) {
        uploaded.push({ hash, format: item.format });
        // Cacheia hash em ad_image_library (best-effort).
        try {
          await adminImg.from("ad_image_library").update({
            fb_image_hash: hash,
            fb_image_hash_synced_at: new Date().toISOString(),
            last_used_at: new Date().toISOString(),
          }).eq("consultant_id", auth.id).eq("url", url);
        } catch (_) {}
      }
    }
    if (!uploaded.length) {
      const detail = uploadErrors.length ? ` Detalhe Meta: ${uploadErrors.join(" | ")}` : "";
      throw new Error(`Nenhuma imagem pôde ser carregada no Facebook.${detail}`);
    }
    const squareHashes = uploaded.filter((u) => u.format === "square").map((u) => u.hash);
    const verticalHashes = uploaded.filter((u) => u.format === "vertical").map((u) => u.hash);
    const storyHashes = uploaded.filter((u) => u.format === "story").map((u) => u.hash);
    const allHashes = uploaded.map((u) => u.hash);

    // 4) Creative — Click-to-WhatsApp NATIVO (WABA). Meta abre conversa direto
    // no número da WABA conectado à Página, sem link wa.me intermediário.
    const initialMessage = buildInitialMessage(body.initial_message, body.distribuidora);
    console.log("[fb-create] initial WA message:", initialMessage);
    // CTWA oficial usa api.whatsapp.com/send com phone WABA (mesmo número do promoted_object).
    const waLink = `https://api.whatsapp.com/send?phone=${waNumberClean}&text=${encodeURIComponent(initialMessage)}`;
    // url_tags: macros do Meta substituem {{campaign.id}} / {{adset.id}} no clique.
    const urlTags = `utm_source=facebook&utm_medium=cpc&utm_campaign={{campaign.id}}&utm_content=consultor_${consultantLicense}&utm_term={{adset.id}}`;

    // Helper: monta link_data com CTA WHATSAPP_MESSAGE apontando para a Page+WABA.
    // OBS: removemos `description` no link_data — em CTWA a Meta às vezes mostra
    // preview feio do domínio do api.whatsapp.com. Headline + body já bastam.
    const baseLinkData = (image_hash: string): Record<string, unknown> => ({
      message: body.primary_text,
      name: body.headline,
      link: waLink,
      call_to_action: {
        type: "WHATSAPP_MESSAGE",
        value: { link: waLink },
      },
      image_hash,
    });

    const adIds: string[] = [];
    // Estratégia 1 (preferida): 1 Ad com asset_feed_spec + customization
    // por posicionamento. Reels/Stories pegam 9:16, Feed pega 1:1/4:5 → fim do corte.
    const hasMultiFormat = (squareHashes.length + verticalHashes.length > 0) && storyHashes.length > 0;
    if (hasMultiFormat) {
      const images: any[] = [];
      if (squareHashes.length || verticalHashes.length) {
        for (const h of [...squareHashes, ...verticalHashes]) images.push({ hash: h, adlabels: [{ name: "feed" }] });
      }
      for (const h of storyHashes) images.push({ hash: h, adlabels: [{ name: "story" }] });
      const assetFeedSpec = {
        images,
        bodies: (() => {
          const v = (body as any).__variants?.primary_texts as string[] | undefined;
          const all = [body.primary_text, ...((v || []).filter((x) => x && x !== body.primary_text))].slice(0, 5);
          return all.map((text) => ({ text }));
        })(),
        titles: (() => {
          const v = (body as any).__variants?.headlines as string[] | undefined;
          const all = [body.headline, ...((v || []).filter((x) => x && x !== body.headline))].slice(0, 5);
          return all.map((text) => ({ text }));
        })(),
        descriptions: body.description ? [{ text: body.description }] : [],
        link_urls: [{ website_url: waLink }],
        call_to_action_types: ["WHATSAPP_MESSAGE"],
        ad_formats: ["SINGLE_IMAGE"],
        asset_customization_rules: [
          {
            customization_spec: { publisher_platforms: ["facebook"], facebook_positions: ["feed", "marketplace", "search", "video_feeds"] },
            image_label: { name: "feed" },
          },
          {
            customization_spec: { publisher_platforms: ["instagram"], instagram_positions: ["stream", "explore"] },
            image_label: { name: "feed" },
          },
          {
            customization_spec: { publisher_platforms: ["facebook"], facebook_positions: ["story", "instream_video"] },
            image_label: { name: "story" },
          },
          {
            customization_spec: { publisher_platforms: ["facebook"], facebook_positions: ["facebook_reels"] },
            image_label: { name: "story" },
          },
          {
            customization_spec: { publisher_platforms: ["instagram"], instagram_positions: ["story", "reels"] },
            image_label: { name: "story" },
          },
        ],
      };
      try {
        const cr = await fbFetch(`/${accId}/adcreatives`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            name: `[${consultantTag}] ${distribTag} · Creative Multiformato`,
            object_story_spec: JSON.stringify({ page_id: conn.page_id }),
            asset_feed_spec: JSON.stringify(assetFeedSpec),
            degrees_of_freedom_spec: JSON.stringify({
              creative_features_spec: { standard_enhancements: { enroll_status: "OPT_IN" } },
            }),
            url_tags: urlTags,
            access_token: conn.token,
          }),
        });
        const adN = await fbFetch(`/${accId}/ads`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            name: `[${consultantTag}] ${distribTag} · Anúncio Multiformato`,
            adset_id: adsetId,
            creative: JSON.stringify({ creative_id: cr.id }),
            status: "PAUSED",
            ...(adlabelsParam ? { adlabels: adlabelsParam } : {}),
            access_token: conn.token,
          }),
        });
        adIds.push(adN.id);
      } catch (e) {
        console.warn("[fb-create] asset_feed_spec falhou, caindo no fallback:", (e as Error).message);
      }
    }

    // Estratégia 2 (fallback): 1 Ad por imagem (até 5). Meta auto-corta —
    // só usado quando o usuário não enviou foto vertical (story 9:16).
    if (adIds.length === 0) {
      const adImageHashes = allHashes.slice(0, 5);
      for (let i = 0; i < adImageHashes.length; i++) {
        try {
          const cr = await fbFetch(`/${accId}/adcreatives`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            name: `[${consultantTag}] ${distribTag} · Creative ${i + 1}`,
            object_story_spec: JSON.stringify({
              page_id: conn.page_id,
                link_data: baseLinkData(adImageHashes[i]),
            }),
            url_tags: urlTags,
            access_token: conn.token,
          }),
        });
        const adN = await fbFetch(`/${accId}/ads`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            name: `[${consultantTag}] ${distribTag} · Anúncio ${i + 1}`,
            adset_id: adsetId,
            creative: JSON.stringify({ creative_id: cr.id }),
            status: "PAUSED",
            ...(adlabelsParam ? { adlabels: adlabelsParam } : {}),
            access_token: conn.token,
          }),
        });
        adIds.push(adN.id);
      } catch (e) {
        console.warn(`[fb-create] criativo ${i + 1} falhou:`, (e as Error).message);
      }
    }
    }
    if (!adIds.length) throw new Error("Nenhum anúncio pôde ser criado no Facebook.");

    // 6) Persiste
    const admin = adminClient();
    await admin.from("facebook_campaigns").insert({
      consultant_id: auth.id,
      fb_campaign_id: campaignId,
      fb_adset_ids: [adsetId],
      fb_ad_ids: adIds,
      name: campaignName,
      cities: body.cities,
      age_min: ageMin,
      age_max: ageMax,
      daily_budget_cents: body.daily_budget_cents,
      duration_days: body.duration_days ?? null,
      status: "pending_review",
      started_at: new Date().toISOString(),
      distribuidora: body.distribuidora ?? null,
      pixel_event_optimized: pixelEvent,
      initial_message: initialMessage,
    });

    // Telemetria de uso do template (gallery → consultor → campanha).
    if (templateRow?.id) {
      const { data: campRow } = await admin
        .from("facebook_campaigns")
        .select("id")
        .eq("fb_campaign_id", campaignId)
        .maybeSingle();
      await admin.from("ad_template_usages").insert({
        template_id: templateRow.id,
        consultant_id: auth.id,
        campaign_id: campRow?.id ?? null,
      });
    }

    // 7) Tenta ativar imediatamente (sem setTimeout — Edge Function morre depois do response)
    let activated = false;
    let activationError: string | null = null;
    try {
      await fbFetch(`/${adsetId}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ status: "ACTIVE", access_token: conn.token }),
      });
      for (const adId of adIds) {
        await fbFetch(`/${adId}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ status: "ACTIVE", access_token: conn.token }),
        });
      }
      await fbFetch(`/${campaignId}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ status: "ACTIVE", access_token: conn.token }),
      });
      activated = true;
      await admin.from("facebook_campaigns").update({ status: "active" }).eq("fb_campaign_id", campaignId);
      if (rejectedImages.length) {
        await notifyConsultant(
          auth.id,
          "warning",
          "Campanha publicada com alertas",
          `${rejectedImages.length} foto(s) foram descartadas na validação.\nCampanha: ${campaignName}`,
        );
      } else {
        await notifyConsultant(
          auth.id,
          "info",
          "Campanha ativada ✅",
          `Sua campanha está no ar:\n${campaignName}\nOrçamento: R$ ${(body.daily_budget_cents / 100).toFixed(2)}/dia`,
        );
      }
    } catch (e) {
      activationError = (e as Error).message;
      console.warn("[fb-create] ativação adiada:", activationError);
      await admin.from("facebook_campaigns").update({ status: "pending_review", rejection_reason: activationError }).eq("fb_campaign_id", campaignId);
      await notifyConsultant(
        auth.id,
        "warning",
        "Campanha em revisão",
        `A campanha "${campaignName}" foi criada mas não ativou automaticamente.\n\nMotivo: ${activationError}\n\nAcesse o painel e clique em "Tentar reativar".`,
      );
    }

    return new Response(JSON.stringify({ ok: true, campaign_id: campaignId, adset_id: adsetId, ad_ids: adIds, ads_count: adIds.length, activated, activation_error: activationError }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[fb-create] step=fatal", err);
    // notifyConsultant removido daqui — chamada externa em catch pode estourar CPU
    // e a UI já mostra o erro retornado pela função.
    return campaignErrorResponse(err);
  }
});
