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
import { resolveWabaPhone } from "../_shared/resolve-waba-phone.ts";
import { notifyConsultant } from "../_shared/notify-consultant.ts";
import { buildRodizioPoolPlan } from "./rodizio-pool.ts";

interface Body {
  name: string;
  // Prefixo livre digitado pelo usuário. Vai NA FRENTE do nome padrão
  // gerado pelo sistema no Gerenciador da Meta, para diferenciar campanhas
  // no mesmo mercado (ex.: "Teste A", "Lote 2"). Máx 40 chars, sanitizado.
  name_prefix?: string;
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
  // captions_srt: conteúdo SRT em pt-BR gerado pelo ad-video-captions
  // (anexado ao vídeo na Meta para mostrar legenda no Reels/Feed/Stories).
  video?: { url: string; thumb_url?: string; captions_srt?: string };
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
  // Rodízio (round-robin): quando ligado, os leads deste anúncio são
  // distribuídos em ordem circular entre os participantes em vez de irem todos
  // para o número fixo. A criação efetiva da pool/membros acontece após o
  // insert em facebook_campaigns (ver Tarefa 5.2).
  rodizio_enabled?: boolean;
  // Lista ORDENADA de ids de referral_partners participantes do rodízio.
  // A ordem define a posição na fila circular (0, 1, 2, ...).
  rodizio_partner_ids?: string[];
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
const WHATSAPP_FIX_LINKS = {
  whatsapp_manager: "https://business.facebook.com/wa/manage/phone-numbers/",
  whatsapp_accounts: "https://business.facebook.com/settings/whatsapp-business-accounts",
  pages: "https://business.facebook.com/settings/pages",
};

function campaignErrorResponse(err: unknown) {
  const message = (err as Error)?.message || "Erro inesperado ao criar campanha.";
  if (message.includes("1487079") || /targeting_relaxation/i.test(message)) {
    return new Response(JSON.stringify({
      error: "Configuração de público inválida. Removemos o campo de segmentação rejeitado pela Meta; tente publicar novamente.",
      code: "META_TARGETING_INVALID",
      meta_error: message,
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (message.includes(WA_BUSINESS_REQUIRED_SUBCODE) || message.includes("conta pessoal")) {
    return new Response(JSON.stringify({
      error: WA_BUSINESS_REQUIRED_MESSAGE,
      code: "WHATSAPP_BUSINESS_REQUIRED",
      meta_error: message,
      links: WHATSAPP_FIX_LINKS,
      next_steps: [
        "Abra Contas WhatsApp Business e vincule a WABA à Página usada nos anúncios",
        "Abra WhatsApp Manager e confirme o phone_number_id real do número",
        "Volte no Admin e clique em Validar e corrigir WhatsApp automaticamente",
      ],
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

    // ─── BLOQUEIO: primeira mensagem (CTWA) precisa ser ÚNICA por consultor ───
    // A initial_message é uma das chaves de atribuição lead → campanha. Duas
    // campanhas com a MESMA frase deixam o match por texto ambíguo e embaralham
    // CPL/comissão. Aqui rejeitamos a publicação quando a frase já existe
    // (normalizada) em outra campanha ativa do mesmo consultor. A UI oferece a
    // variação por IA (edge function ad-initial-message) antes de chegar aqui.
    {
      const rawInitial = buildInitialMessage(body.initial_message, body.distribuidora);
      const norm = (s: string) => (s || "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
      const normNew = norm(rawInitial);
      if (normNew.length >= 5) {
        const adminCheck = adminClient();
        const { data: dupRows } = await adminCheck
          .from("facebook_campaigns")
          .select("initial_message")
          .eq("consultant_id", auth.id)
          .not("initial_message", "is", null)
          .neq("initial_message", "")
          .in("status", ["active", "pending_review", "paused"])
          .limit(200);
        const isDup = (dupRows || []).some((r: any) => norm(r.initial_message) === normNew);
        if (isDup) {
          return new Response(JSON.stringify({
            error: "Essa primeira mensagem do WhatsApp já está em uso em outra campanha sua. Mude um pouco a frase (tem o botão 'Variar com IA') para conseguirmos medir cada campanha com precisão.",
            code: "DUPLICATE_INITIAL_MESSAGE",
          }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
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
    // Admin TAMBÉM precisa ter saldo no consultor — sem bypass, pra evitar prejuízo.
    const admin = adminDb;
    const { data: ps } = await admin.from("platform_settings").select("*").eq("id", true).maybeSingle();
    const feePct = Number(ps?.platform_fee_percent ?? 20) / 100;
    // Mínimo de 3 dias (era 7) — permite teste rápido "gastar pouco para validar".
    const minDays = 3;
    const safety = Math.max(Number(ps?.campaign_safety_multiplier ?? 1.0), minDays);
    const minBalance = Number(ps?.min_balance_to_create_campaign_cents ?? 3000);
    const requiredCents = Math.max(minBalance, Math.round(body.daily_budget_cents * (1 + feePct) * safety));
    const { data: w } = await admin.from("consultant_wallet")
      .select("balance_cents,debt_cents").eq("consultant_id", auth.id).maybeSingle();
    const balance = Number(w?.balance_cents ?? 0);
    const debt = Number((w as any)?.debt_cents ?? 0);
    const liquid = Math.max(0, balance - debt);
    if (liquid < requiredCents) {
      return new Response(JSON.stringify({
        error: `Saldo insuficiente. Mínimo para esta campanha: R$ ${(requiredCents/100).toFixed(2)} (você tem R$ ${(liquid/100).toFixed(2)}). Recarregue na carteira.`,
        code: "INSUFFICIENT_WALLET_BALANCE",
        required_cents: requiredCents,
        balance_cents: liquid,
      }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // RATEIO ANTI-PREJUÍZO: divide o saldo entre TODAS as campanhas ativas/pendentes
    // do consultor + a nova. Sem isso, N campanhas ativas teriam cada uma cap = saldo,
    // permitindo gasto potencial = N × saldo na Meta.
    // Para cada campanha existente, descontamos o que ela JÁ gastou (não conta como reserva).
    const { data: existingCamps } = await admin
      .from("facebook_campaigns")
      .select("id, fb_campaign_id, status")
      .eq("consultant_id", auth.id)
      .in("status", ["active", "paused", "pending_review"]);
    // Soma o gasto já realizado pelas existentes (usa nossa tabela diária — barato, sem chamar Meta)
    let alreadySpentMetaCents = 0;
    if (existingCamps && existingCamps.length > 0) {
      const ids = existingCamps.map((c: any) => c.id);
      const { data: spent } = await admin
        .from("facebook_metrics_daily")
        .select("campaign_id, gross_spend_cents")
        .in("campaign_id", ids);
      for (const r of (spent || []) as any[]) {
        alreadySpentMetaCents += Number(r.gross_spend_cents || 0);
      }
    }
    const liquidMetaBudget = Math.floor(liquid / (1 + feePct));
    const activeCount = (existingCamps?.length || 0) + 1; // +1 = a nova
    const perCampaignExtra = Math.floor(liquidMetaBudget / activeCount);
    // CAP DA NOVA CAMPANHA: respeita o que o usuário pediu (daily × duration),
    // SEM inflar com sobra de carteira. O rateio anti-prejuízo entra só como piso
    // de saldo exigido (requiredCents) — não como teto inflado.
    // Meta exige spend_cap mínimo de R$ 300,00 em BRL (subcode 2446307).
    const durationDaysForCap = Math.max(1, body.duration_days ?? 7);
    const exactBudgetCents = body.daily_budget_cents * durationDaysForCap;
    // Usa o MENOR entre o que o usuário pediu e a fatia da carteira (proteção dupla).
    const lifetimeCapCents = Math.max(30000, Math.min(exactBudgetCents, perCampaignExtra || exactBudgetCents));
    // realinha o cap das existentes pra elas também respeitarem o rateio
    const realignTargets = (existingCamps || []).filter((c: any) => c.fb_campaign_id);

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

    // ===== FONTE DA VERDADE: resolvedor autoritativo da WABA =====
    // Consulta a lista viva de phone_numbers da WhatsApp Business Account vinculada
    // à Página da plataforma, escolhe o número deste consultor (por phone_number_id
    // salvo, por match de variantes ou único disponível) e persiste id + display.
    // Nunca adivinha 9º dígito — usa exatamente os dígitos que o Meta acabou de retornar.
    const waba = await resolveWabaPhone(auth.id, { persist: true });
    if (!waba.ok || !waba.chosen) {
      const opts = waba.numbers.map((n) => n.display).join(", ") || "nenhum";
      const msg =
        waba.reason === "no_waba"
          ? (waba.hint || "A Página da plataforma não tem WhatsApp Business (WABA) vinculado. Vincule em Meta Business Suite → WhatsApp → Contas.")
          : waba.reason === "no_numbers"
            ? "Nenhum telefone está registrado na WABA. Registre um número em Meta Business Suite → WhatsApp Manager."
            : waba.reason === "no_match"
              ? `Seu número não bate com nenhum registrado na WABA. Números disponíveis: ${opts}. Escolha um em Anúncios → Configurações.`
              : (waba.hint || "Não foi possível resolver o número WhatsApp Business.");
      return new Response(JSON.stringify({
        error: msg,
        code: "WHATSAPP_BUSINESS_REQUIRED",
        waba_numbers: waba.numbers,
        detected_paths_tried: waba.detected_paths_tried || [],
        discovered_via: waba.discovered_via || null,
        next_steps: waba.next_steps || [],
        links: WHATSAPP_FIX_LINKS,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Número oficial: precisa vir da WABA/Graph ou de phone_number_id real salvo.
    // Não publicamos mais com fallback permission_limited porque a Meta recusa
    // no AdSet e deixa campanha órfã quando Página↔WABA não está vinculado.
    const authoritativeDigits = waba.chosen.digits;
    const authoritativePhoneId = waba.chosen.id;
    const authoritativeDisplay = waba.chosen.display;
    const hasRealPhoneNumberId = /^\d+$/.test(authoritativePhoneId);
    if (!hasRealPhoneNumberId) {
      return new Response(JSON.stringify({
        error: `O número ${authoritativeDigits} está salvo, mas o phone_number_id (${authoritativePhoneId}) não é um ID numérico real da Meta. Copie o phone_number_id no WhatsApp Manager ou vincule a WABA correta à Página ${waba.page_id || "da plataforma"}.`,
        code: "WHATSAPP_BUSINESS_REQUIRED",
        phone_used: authoritativeDigits,
        phone_number_id: authoritativePhoneId,
        phone_display: authoritativeDisplay,
        waba_numbers: waba.numbers,
        detected_paths_tried: waba.detected_paths_tried || [],
        discovered_via: waba.discovered_via || null,
        next_steps: waba.next_steps || [
          "Copie o phone_number_id numérico no WhatsApp Manager",
          "Vincule a WABA correta à Página no Meta Business Suite",
          "Clique em Validar e corrigir WhatsApp automaticamente antes de publicar",
        ],
        links: WHATSAPP_FIX_LINKS,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    console.log(
      "[fb-create] waba resolved id=", authoritativePhoneId,
      "display=", authoritativeDisplay,
      "digits=", authoritativeDigits,
    );

    // Trava de saldo já validada acima (linha ~165) com fee e safety. Aqui só
    // garantimos a wallet existe; remoção do bypass admin pra zero prejuízo.
    const wallet = await getOrCreateWallet(auth.id);
    void wallet;
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
      whatsapp_phone_number_id: authoritativePhoneId,
      whatsapp_destination_number: authoritativeDigits,
    };
    const accId = conn.ad_account_id; // já vem com prefixo act_
    // Idade mínima padrão 28+ (regra de negócio iGreen — público que converte).
    // Advantage+ audience RESPEITA age_min como restrição inegociável — docs Meta:
    // https://developers.facebook.com/docs/marketing-api/audiences/reference/targeting-expansion/advantage-audience/
    // ("minimum age" listado explicitamente como non-negotiable constraint).
    // Portanto age_min=28 + advantage_audience=1 é combinação válida e recomendada.
    const ageMin = body.age_min ?? 28;
    const ageMax = body.age_max ?? 65;
    const today = new Date().toISOString().slice(0, 10);
    const cityNames = (body.cities || []).map((c) => c.name).slice(0, 3).join(", ");
    const locLabel = hasCustomLocations
      ? (body.custom_locations![0].name || body.custom_locations![0].address_string || `${body.custom_locations!.length} ponto(s)`)
      : (cityNames || "iGreen");
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
    const distribTag = body.distribuidora || (hasCustomLocations ? locLabel : (cityNames || "iGreen"));
    const cityPrincipal = body.cities[0]?.name || (hasCustomLocations ? locLabel : cityNames);
    // Prefixo livre do usuário — sanitiza e limita 40 chars, sempre NA FRENTE.
    const rawPrefix = String(body.name_prefix || "").trim();
    const namePrefix = rawPrefix
      ? rawPrefix.replace(/[\[\]·|\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40)
      : "";
    const baseName = body.name
      ? `[${consultantTag}] ${distribTag} · ${body.name} · ${today}`
      : `[${consultantTag}] ${distribTag} · ${cityPrincipal} · ${today}`;
    const campaignName = namePrefix ? `${namePrefix} · ${baseName}` : baseName;


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

    // ─── Pré-check reachestimate: valida promoted_object antes de gastar POSTs ───
    // Se Meta rejeitar aqui, aborta sem criar campanha órfã PAUSED no Ads Manager.
    try {
      const precheckGeo: Record<string, unknown> = hasCustomLocations
        ? { custom_locations: body.custom_locations!.slice(0, 5).map((p) => ({
              latitude: p.latitude, longitude: p.longitude,
              radius: Math.max(1, Math.min(50, Math.round(p.radius))),
              distance_unit: "kilometer",
            })), location_types: ["home", "recent"] }
        : { cities: body.cities.map((c) => ({ key: c.key })), location_types: ["home", "recent"] };
      const precheckTargeting = {
        geo_locations: precheckGeo,
        age_min: ageMin,
        age_max: ageMax,
        targeting_automation: { advantage_audience: 1 },
      };
      const precheckPromoted = { page_id: conn.page_id, whatsapp_phone_number: authoritativeDigits };
      const params = new URLSearchParams({
        targeting_spec: JSON.stringify(precheckTargeting),
        optimization_goal: "CONVERSATIONS",
        destination_type: "WHATSAPP",
        promoted_object: JSON.stringify(precheckPromoted),
        access_token: conn.token,
      });
      await fbFetch(`/${accId}/reachestimate?${params.toString()}`);
      console.log("[fb-create] precheck reachestimate OK");
    } catch (e) {
      const msg = String((e as Error)?.message || "");
      console.warn("[fb-create] precheck reachestimate falhou:", msg.slice(0, 300));
      const isWabaMismatch = msg.includes("1487246") || msg.includes("2446885") || /not linked to your account/i.test(msg);
      if (isWabaMismatch) {
        return new Response(JSON.stringify({
          error: `A Meta rejeitou o número ${authoritativeDisplay} (${authoritativeDigits}, id ${authoritativePhoneId}) no reachestimate. Confirme se este phone_number_id pertence à WABA vinculada à Página ${conn.page_id}.`,
          code: "WHATSAPP_BUSINESS_REQUIRED",
          phone_used: authoritativeDigits,
          phone_number_id: authoritativePhoneId,
          phone_display: authoritativeDisplay,
          waba_numbers: waba.numbers,
          detected_paths_tried: waba.detected_paths_tried || [],
          discovered_via: waba.discovered_via || null,
          meta_message: msg,
          next_steps: [
            `Vincule a WABA ${waba.waba_id || "do número"} à Página ${conn.page_id}`,
            "Confirme no WhatsApp Manager se o phone_number_id é o real do número",
            "Volte no Admin e clique em Validar e corrigir WhatsApp automaticamente",
          ],
          links: WHATSAPP_FIX_LINKS,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // outros erros (targeting inválido, etc.) — segue e deixa POST /campaigns
      // reportar o erro real; NÃO abortamos aqui pra não bloquear falsos-positivos.
    }


    // 1) Campaign
    // Se o usuário definiu duration_days, usa LIFETIME_BUDGET (teto absoluto
    // que a Meta não estoura). Senão, daily_budget contínuo com spend_cap.
    const hasFixedDuration = !!(body.duration_days && body.duration_days > 0);
    // Meta não aceita spend_cap junto com lifetime_budget (subcode 2446474):
    // o próprio lifetime_budget já funciona como teto absoluto.
    const campaignBudgetParams: Record<string, string> = hasFixedDuration
      ? { lifetime_budget: String(exactBudgetCents) }
      : { daily_budget: String(body.daily_budget_cents), spend_cap: String(lifetimeCapCents) };
    console.log("[fb-create] step=campaign_create budget=", campaignBudgetParams);
    const camp = await fbFetch(`/${accId}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name: campaignName,
        objective,
        special_ad_categories: JSON.stringify([]),
        status: "PAUSED",
        buying_type: "AUCTION",
        ...campaignBudgetParams,
        // pacing standard = entrega distribuída ao longo do período (não acelerada).
        pacing_type: JSON.stringify(["standard"]),
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
    const geoLocations: Record<string, unknown> = hasCustomLocations
      ? {
          custom_locations: body.custom_locations!.slice(0, 200).map((p) => ({
            latitude: p.latitude,
            longitude: p.longitude,
            radius: Math.max(1, Math.min(50, Math.round(p.radius))),
            distance_unit: "kilometer",
            ...(p.address_string ? { address_string: p.address_string } : {}),
            ...(p.name ? { name: p.name } : {}),
          })),
          location_types: ["home", "recent"],
        }
      : {
          // Apenas a cidade escolhida (sem radius/distance_unit) — Meta interpreta
          // como exclusivamente o município, sem expandir para o entorno.
          cities: body.cities.map((c) => ({ key: c.key })),
          location_types: ["home", "recent"],
        };
    const targeting: Record<string, unknown> = {
      geo_locations: geoLocations,
      age_min: ageMin,
      age_max: ageMax,
      // Advantage+ Audience (padrão Meta v23+, opt-in explícito).
      // Compatível com age_min customizado — Meta trata idade como non-negotiable constraint.
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
    let waNumberClean = String(conn.whatsapp_destination_number).replace(/\D/g, "");
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
      // Como aqui otimizamos sempre por CONVERSATIONS, ele nunca se aplica —
      // por isso não enviamos esse campo (antes havia um `=== "REACH"` morto
      // que o type-check acusava como comparação sem sobreposição de tipos).
      ...(adlabelsParam ? { adlabels: adlabelsParam } : {}),
      access_token: conn.token,
    };
    // Janela do adset precisa ser ≥ 24 h (Meta subcode 1487793). Soma 1 h de buffer pra absorver clock skew.
    const startAt = Date.now() + 60_000;
    adsetParams.start_time = new Date(startAt).toISOString();
    const days = Math.max(1, body.duration_days ?? 7);
    adsetParams.end_time = new Date(startAt + days * 86400_000 + 3_600_000).toISOString();
    console.log("[fb-create] step=adset_create campaign=", campaignId, "phone_authoritative=", waNumberClean, "phone_id=", authoritativePhoneId);
    let adset: any = null;
    try {
      adset = await fbFetch(`/${accId}/adsets`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(adsetParams),
      });
    } catch (e) {
      const msg = String((e as Error)?.message || "");
      console.warn(`[fb-create] adset falhou phone=${waNumberClean} phone_id=${authoritativePhoneId} err=${msg.slice(0, 300)}`);
      const isWabaMismatch =
        msg.includes("1487246") ||
        msg.includes("2446885") ||
        /not linked to your account/i.test(msg) ||
        /whatsapp/i.test(msg);
      if (isWabaMismatch) {
        return new Response(JSON.stringify({
          error: "Número WhatsApp Business não vinculado à Página/conta Meta usada no anúncio.",
          code: "WHATSAPP_BUSINESS_REQUIRED",
          message: `A Meta rejeitou o número autoritativo ${authoritativeDisplay} (${waNumberClean}, phone_number_id ${authoritativePhoneId}). Confirme se este phone_number_id pertence à WABA vinculada à Página ${conn.page_id}.`,
          phone_used: waNumberClean,
          phone_number_id: authoritativePhoneId,
          phone_display: authoritativeDisplay,
          waba_numbers: waba.numbers,
          meta_message: msg,
          next_steps: [
            `Vincule a WABA ${waba.waba_id || "do número"} à Página ${conn.page_id}`,
            "Confirme no WhatsApp Manager se o phone_number_id é o real do número",
            "Volte no Admin e clique em Validar e corrigir WhatsApp automaticamente",
          ],
          links: WHATSAPP_FIX_LINKS,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }
    console.log("[fb-create] adset OK phone_used=", waNumberClean, "phone_id=", authoritativePhoneId);
    conn.whatsapp_destination_number = waNumberClean;
    const adsetId = adset.id as string;

    const adIds: string[] = [];
    const rejectedImages: { url: string; issues: string[]; suggestion?: string }[] = [];
    // Mensagem inicial WhatsApp — hoisted pra que tanto modo foto quanto vídeo usem.
    const initialMessage = buildInitialMessage(body.initial_message, body.distribuidora);


    // =================== MODO VÍDEO (Reels/Stories) ===================
    if (creativeMode === "video") {
      const videoUrl = body.video!.url;
      let thumbUrl: string | null = body.video!.thumb_url || null;
      console.log("[fb-create] step=video_upload url=", videoUrl);

      // Reusa fb_video_id se já estiver em ad_video_library (best-effort).
      // IMPORTANTE: thumb cacheada SÓ é reaproveitada quando ela veio do USUÁRIO
      // (thumb_source='user'). Se foi gerada pelo Meta, refazemos a busca em
      // /thumbnails pra evitar servir frame antigo quando o vídeo/capa muda.
      let fbVideoId: string | null = null;
      try {
        const { data: cachedVid } = await adminDb2
          .from("ad_video_library").select("id, fb_video_id, thumb_url, thumb_source, usage_count")
          .eq("consultant_id", auth.id).eq("url", videoUrl).maybeSingle();
        if (cachedVid?.fb_video_id) {
          fbVideoId = cachedVid.fb_video_id;
          const cachedSource = (cachedVid as any).thumb_source || "user";
          if (!thumbUrl && cachedSource === "user" && (cachedVid as any).thumb_url) {
            thumbUrl = (cachedVid as any).thumb_url;
          }
          await adminDb2.from("ad_video_library").update({
            usage_count: ((cachedVid as any).usage_count ?? 0) + 1,
            last_used_at: new Date().toISOString(),
          }).eq("id", cachedVid.id);
          console.log("[fb-create] video CACHE HIT", fbVideoId, "thumb_source=", cachedSource);
        }
      } catch (e) { console.warn("[fb-create] video cache lookup:", (e as Error).message); }

      if (!fbVideoId) {
        // Upload do vídeo via parâmetro file_url (Meta baixa direto)
        const FB_GRAPH_VID = "https://graph.facebook.com/v23.0";
        try {
          const vr = await fbFetch(`/${accId}/advideos`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              file_url: videoUrl,
              name: `cons-${consultantLicense}-${Date.now()}`,
              access_token: conn.token,
            }),
          });
          fbVideoId = vr?.id as string;
          if (!fbVideoId) throw new Error("Meta não retornou id do vídeo");
        } catch (e) {
          throw new Error(`Falha ao enviar vídeo ao Facebook: ${(e as Error).message}`);
        }

        // Polling de processamento (máx 50s, intervalos de 3s)
        const started = Date.now();
        let ready = false;
        while (Date.now() - started < 50_000) {
          try {
            const st = await fbFetch(`/${fbVideoId}?fields=status&access_token=${conn.token}`);
            const phase = st?.status?.video_status as string | undefined;
            if (phase === "ready") { ready = true; break; }
            if (phase === "error") throw new Error(`Vídeo rejeitado: ${st?.status?.error?.message || "erro"}`);
          } catch (_) { /* tenta de novo */ }
          await new Promise((r) => setTimeout(r, 3_000));
        }
        if (!ready) console.warn("[fb-create] vídeo não ficou pronto a tempo; ad fica PAUSED até processar");

        // Cacheia na biblioteca
        try {
          await adminDb2.from("ad_video_library").upsert({
            consultant_id: auth.id,
            url: videoUrl,
            thumb_url: thumbUrl,
            thumb_source: body.video!.thumb_url ? "user" : "meta_preferred",
            fb_video_id: fbVideoId,
            fb_video_id_synced_at: new Date().toISOString(),
            last_used_at: new Date().toISOString(),
          }, { onConflict: "consultant_id,url" });
        } catch (e) { console.warn("[fb-create] cache video falhou:", (e as Error).message); }
      }

      // Auto-resolve thumbnail se o usuário não enviou (Meta exige image_url/image_hash).
      if (!thumbUrl && fbVideoId) {
        const fetchThumb = async (): Promise<string | null> => {
          try {
            const tr = await fbFetch(`/${fbVideoId}/thumbnails?access_token=${conn.token}`);
            const list = (tr?.data || []) as Array<{ uri?: string; is_preferred?: boolean }>;
            if (!list.length) return null;
            const preferred = list.find((t) => t.is_preferred && t.uri);
            return (preferred?.uri || list[0]?.uri) ?? null;
          } catch (e) {
            console.warn("[fb-create] thumbnails fetch falhou:", (e as Error).message);
            return null;
          }
        };
        thumbUrl = await fetchThumb();
        if (!thumbUrl) {
          // 1 retry curto: Meta às vezes leva alguns segundos pra gerar thumb
          await new Promise((r) => setTimeout(r, 3_000));
          thumbUrl = await fetchThumb();
        }
        if (thumbUrl) {
          console.log("[fb-create] thumb auto-resolved=", thumbUrl);
          // Persiste no cache marcando origem 'meta_preferred' — assim, se o
          // usuário enviar uma custom no próximo publish, ela sobrescreve.
          try {
            await adminDb2.from("ad_video_library")
              .update({ thumb_url: thumbUrl, thumb_source: "meta_preferred" })
              .eq("consultant_id", auth.id).eq("url", videoUrl);
          } catch (_) { /* best-effort */ }
        } else {
          throw new Error("Meta ainda não gerou a miniatura do vídeo, tente novamente em alguns segundos.");
        }
      }

      // Anexa legendas SRT pt_BR ao vídeo (se geradas pelo wizard via ad-video-captions).
      // Meta API: POST /{video-id}/captions com multipart (captions_file + default_locale).
      // Best-effort: se falhar, o ad sobe sem legenda.
      // IMPORTANTE: fica FORA do if (!thumbUrl) — senão vídeo do cache (com thumb) nunca recebe legenda.
      const captionsSrt = body.video?.captions_srt;
      if (captionsSrt && fbVideoId) {
        try {
          const FB_GRAPH_VID = "https://graph.facebook.com/v23.0";
          const fd = new FormData();
          fd.append(
            "captions_file",
            new Blob([captionsSrt], { type: "application/x-subrip" }),
            "captions.pt_BR.srt",
          );
          fd.append("default_locale", "pt_BR");
          fd.append("access_token", conn.token);
          const cap = await fetch(`${FB_GRAPH_VID}/${fbVideoId}/captions`, {
            method: "POST",
            body: fd,
          });
          const capJson = await cap.json().catch(() => ({}));
          if (!cap.ok) {
            console.warn("[fb-create] captions upload falhou:", cap.status, JSON.stringify(capJson).slice(0, 300));
          } else {
            console.log("[fb-create] captions anexadas pt_BR ao video", fbVideoId);
          }
        } catch (e) {
          console.warn("[fb-create] captions error:", (e as Error).message);
        }
      }


      // Placements 9:16 exclusivamente — vídeos são gravados em modo retrato (Reels/Stories).
      // Feed quadrado e in-stream horizontal cortariam o vídeo. Explore será
      // descontinuado pela Meta em jan/2026 (docs: business/help/682655495435254).
      (targeting as any).publisher_platforms = ["facebook", "instagram"];
      (targeting as any).facebook_positions = ["facebook_reels", "story"];
      (targeting as any).instagram_positions = ["reels", "story"];

      const initialMessageV = buildInitialMessage(body.initial_message, body.distribuidora);
      const waNumberCleanV = String(conn.whatsapp_destination_number).replace(/\D/g, "");
      const waLinkV = `https://api.whatsapp.com/send?phone=${waNumberCleanV}&text=${encodeURIComponent(initialMessageV)}`;
      const urlTagsV = `utm_source=facebook&utm_medium=cpc&utm_campaign={{campaign.id}}&utm_content=consultor_${consultantLicense}&utm_term={{adset.id}}`;

      // Headline curta pra não ser truncada em Reels (~40 chars visíveis) e Stories.
      const videoTitle = String(body.headline || "").slice(0, 27);

      // NÃO enviar image_url: força a Meta a usar a thumbnail nativa do vídeo,
      // que respeita o aspect ratio 9:16. Enviar imagem custom em outro aspect
      // causa crop no card do feed/ads manager (docs: ad-creative-video-data).
      const videoData: Record<string, unknown> = {
        video_id: fbVideoId,
        title: videoTitle,
        message: body.primary_text,
        call_to_action: { type: "WHATSAPP_MESSAGE", value: { link: waLinkV } },
      };

      console.log("[fb-create] video ad: age_min=", ageMin, "age_max=", ageMax,
        "advantage=1 positions_fb=", (targeting as any).facebook_positions,
        "positions_ig=", (targeting as any).instagram_positions);




      const cr = await fbFetch(`/${accId}/adcreatives`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          name: `[${consultantTag}] ${distribTag} · Creative Video Reels`,
          object_story_spec: JSON.stringify({
            page_id: conn.page_id,
            video_data: videoData,
          }),
          url_tags: urlTagsV,
          access_token: conn.token,
        }),
      });
      const adV = await fbFetch(`/${accId}/ads`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          name: `[${consultantTag}] ${distribTag} · Anúncio Video`,
          adset_id: adsetId,
          creative: JSON.stringify({ creative_id: cr.id }),
          status: "PAUSED",
          ...(adlabelsParam ? { adlabels: adlabelsParam } : {}),
          access_token: conn.token,
        }),
      });
      adIds.push(adV.id);
    }

    // =================== MODO FOTO (asset_feed_spec / fallback) ===================
    if (creativeMode === "photo") {
    // 3) Upload de imagens — preserva o formato (square / vertical / story).
    type Tagged = { url: string; format: "square" | "vertical" | "story" };
    const tagged: Tagged[] = body.photos!.slice(0, 10).map((p) =>
      typeof p === "string" ? { url: p, format: "square" as const } : p,
    );

    // 3.0) SEM validação Gemini síncrona aqui — estourava CPU da Edge Function (546).
    // A análise de imagem virou job assíncrono via ad-image-validator (preflight separado).
    const validated: Tagged[] = tagged;

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
    // initialMessage já declarado acima (hoisted pra modo foto e vídeo).
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

    // adIds já declarado acima (modo video pode ter populado).

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
    } // fim do if (creativeMode === "photo")
    if (!adIds.length) throw new Error("Nenhum anúncio pôde ser criado no Facebook.");

    // 6) Persiste
    // Reusa o `admin` (adminClient) já criado na validação de saldo lá em cima —
    // redeclarar com `const admin` aqui causava SyntaxError ("Identifier 'admin'
    // has already been declared") e derrubava a função INTEIRA no boot.
    // Em modo raio, serializa os pontos em `cities` (key sintético "radius:lat,lng:r")
    // pra preservar geo na listagem local — assim o dashboard não fica "sem cidade".
    const citiesPersist = hasCustomLocations
      ? body.custom_locations!.map((p) => ({
          key: `radius:${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}:${Math.round(p.radius)}`,
          name: `${p.name || p.address_string || "Endereço"} (${Math.round(p.radius)}km)`,
        }))
      : (body.cities || []);
    // Captura o id (uuid) da linha recém-criada em facebook_campaigns. Esse id
    // é a chave usada pela pool de rodízio (rodizio_pools.campaign_id) e pela
    // telemetria de template. Antes era refeito um SELECT por fb_campaign_id;
    // agora o insert já devolve o id, evitando uma ida extra ao banco.
    const { data: insertedCampaign } = await admin
      .from("facebook_campaigns")
      .insert({
        consultant_id: auth.id,
        fb_campaign_id: campaignId,
        fb_adset_ids: [adsetId],
        fb_ad_ids: adIds,
        name: campaignName,
        cities: citiesPersist,
        age_min: ageMin,
        age_max: ageMax,
        daily_budget_cents: body.daily_budget_cents,
        lifetime_cap_cents: lifetimeCapCents,
        duration_days: body.duration_days ?? null,
        end_time_utc: hasFixedDuration
          ? new Date(Date.now() + (body.duration_days as number) * 86400_000).toISOString()
          : null,
        status: "pending_review",
        started_at: new Date().toISOString(),
        distribuidora: body.distribuidora ?? null,
        pixel_event_optimized: pixelEvent,
        initial_message: initialMessage,
      })
      .select("id")
      .maybeSingle();
    const campaignRowId = (insertedCampaign as { id?: string } | null)?.id ?? null;

    // ─── Rodízio: cria a pool e os membros ligados a esta campanha ──────────
    // Só cria quando o toggle de rodízio veio ligado E há pelo menos 2
    // participantes (o mínimo que faz a distribuição circular fazer sentido).
    // Quando desligado, nada acontece aqui — o anúncio segue com destino único
    // (whatsapp_destination_number), exatamente como antes.
    //
    // Fail-open (Requisito 6.4): a campanha CTWA já foi criada na Meta e
    // persistida acima. Se a criação da pool falhar, NÃO revertemos a campanha;
    // apenas logamos e avisamos o consultor dono via notifyConsultant. O dono é
    // o consultor logado (auth.id), o mesmo que a RLS de referral_partners usa.
    // O plano (pool + construtor de membros) e a regra "criar ou não" vivem no
    // helper puro `rodizio-pool.ts` (testável sob Vitest). Retorna null quando o
    // rodízio está desligado ou há < 2 participantes — nesse caso nada é criado.
    const rodizioPlan = buildRodizioPoolPlan({
      input: body,
      campaignId: campaignRowId ?? "",
      consultantId: auth.id,
      label: campaignName,
    });
    if (rodizioPlan) {
      try {
        if (!campaignRowId) {
          throw new Error("não foi possível obter o id da campanha recém-criada");
        }
        // 1) Cria a pool ligada ao campaign_id, com o consultor dono.
        const { data: pool, error: poolError } = await admin
          .from("rodizio_pools")
          .insert(rodizioPlan.pool)
          .select("id")
          .single();
        if (poolError || !pool?.id) {
          throw new Error(poolError?.message || "falha ao criar rodizio_pools");
        }
        // 2) Insere os membros na ordem recebida: position 0..n, lead_count=0.
        const members = rodizioPlan.buildMembers(pool.id);
        const { error: membersError } = await admin
          .from("rodizio_pool_members")
          .insert(members);
        if (membersError) {
          throw new Error(membersError.message);
        }
        console.log(`[fb-create] rodízio: pool ${pool.id} criada com ${members.length} membros para campanha ${campaignRowId}`);
      } catch (e) {
        // Fail-open: campanha permanece válida; só logamos e avisamos o dono.
        const msg = (e as Error).message;
        console.error("[fb-create] falha ao criar pool de rodízio (campanha mantida):", msg);
        await notifyConsultant(
          auth.id,
          "warning",
          "Rodízio não configurado",
          `Sua campanha foi criada normalmente, mas não conseguimos ligar o rodízio de leads desta vez (${msg}). Os leads vão para o número padrão. Tente editar a campanha mais tarde ou avise o suporte.`,
        );
      }
    }

    // Telemetria de uso do template (gallery → consultor → campanha).
    if (templateRow?.id) {
      await admin.from("ad_template_usages").insert({
        template_id: templateRow.id,
        consultant_id: auth.id,
        campaign_id: campaignRowId,
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

    // RATEIO ANTI-PREJUÍZO (parte 2): realinha o spend_cap das campanhas existentes
    // pra cada uma respeitar a nova fatia. Roda em BACKGROUND (waitUntil) pra não
    // bloquear a resposta pro browser — o loop pode levar 15-20s quando Meta
    // rejeita com subcodes permanentes (1885058 pending charges / 2446474 lifetime
    // budget), o que causava "Failed to fetch" no cliente mesmo com campanha OK.
    const realignJob = (async () => {
      for (const ec of realignTargets) {
        try {
          const { data: spentRow } = await admin
            .from("facebook_metrics_daily")
            .select("gross_spend_cents")
            .eq("campaign_id", ec.id);
          const ecSpent = (spentRow || []).reduce((s: number, r: any) => s + Number(r.gross_spend_cents || 0), 0);
          const newEcCap = Math.max(30000, ecSpent + perCampaignExtra);
          await fbFetch(`/${ec.fb_campaign_id}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ spend_cap: String(newEcCap), access_token: conn.token }),
          });
          await admin.from("facebook_campaigns")
            .update({ lifetime_cap_cents: newEcCap, updated_at: new Date().toISOString() })
            .eq("id", ec.id);
        } catch (re) {
          const msg = (re as Error).message || "";
          // subcodes permanentes: nada a fazer automaticamente — loga como info
          if (/subcode=(1885058|2446474)/.test(msg)) {
            console.info("[fb-create] realign skip (permanente)", ec.fb_campaign_id, msg.slice(0, 120));
          } else {
            console.warn("[fb-create] realign existing cap failed", ec.fb_campaign_id, msg);
          }
        }
      }
    })();
    try {
      // @ts-ignore EdgeRuntime.waitUntil só existe no runtime Deno da Supabase
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(realignJob);
    } catch { /* ambiente sem waitUntil — deixa promise soltar */ }

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
