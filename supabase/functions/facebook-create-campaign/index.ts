// Cria Campaign + AdSet (Click-to-WhatsApp) + Ad com criativo a partir das fotos.
import {
  adminClient,
  authConsultant,
  fbFetch,
  getOrCreateWallet,
  loadConsultantAdSettings,
  loadPlatformAccount,
} from "../_shared/fb-graph.ts";
import {
  calculateCampaignBudgetRequirement,
  META_MIN_DAILY_BUDGET_CENTS,
} from "../_shared/campaign-budget.ts";
import {
  type MetaObjectState,
  resolveCampaignEffectiveStatus,
} from "../_shared/campaign-effective-status.ts";
import { resolveWabaPhone } from "../_shared/resolve-waba-phone.ts";
import { notifyConsultant } from "../_shared/notify-consultant.ts";
import {
  buildCtwaPageWelcomeMessage,
  detectTrackingChannel,
  ensureCampaignTrackingProtocol,
  stripTrackingProtocol,
} from "../_shared/campaign-tracking.ts";
import { normalizeRodizioPartnerIds } from "./rodizio-pool.ts";
import {
  mergePlatformRetargetDdds,
  resolveRetargetDdds,
} from "../_shared/city-to-ddd.ts";
import { isServiceRoleAuth } from "../_shared/service-role-auth.ts";
import { isAdsActionAllowedForConfig } from "../_shared/brain-config.ts";
import { buildCors } from "../_shared/cors.ts";
import {
  canProceedWithPublish,
  claimPublishSaga,
  claimRejectionResponse,
  completePublishSaga,
  failPublishSaga,
  recordPublishStage,
  requestHash,
  resolveClientRequestId,
} from "../_shared/ad-publish-saga.ts";

async function safeNotifyConsultant(
  consultantId: string,
  level: "info" | "warning" | "error",
  title: string,
  message: string,
) {
  try {
    await notifyConsultant(consultantId, level, title, message);
  } catch (e) {
    console.warn(
      "[fb-create] notify skipped",
      title,
      (e as Error)?.message || e,
    );
  }
}

interface Body {
  name: string;
  // Prefixo livre digitado pelo usuário. Vai NA FRENTE do nome padrão
  // gerado pelo sistema no Gerenciador da Meta, para diferenciar campanhas
  // no mesmo mercado (ex.: "Teste A", "Lote 2"). Máx 40 chars, sanitizado.
  name_prefix?: string;
  /** Remarketing: grava DDDs das cidades na allowlist de Custom Audience. */
  is_remarketing?: boolean;
  /** DDDs já inferidos no front (cidade + vizinhos). Servidor valida/merge. */
  retarget_ddds?: number[];
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
  photos?:
    ({ url: string; format: "square" | "vertical" | "story" } | string)[];
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
  /** Somente service_role: publica em nome deste consultor (automação interna). */
  consultant_id?: string;
  /**
   * Chave de idempotência da publicação. Se omitida, é derivada do payload —
   * duplo clique/retry da UI cai na mesma chave e não gera segunda campanha.
   */
  client_request_id?: string;
  /**
   * Somente service_role: cria na Meta JÁ PAUSADA (fila de rotação).
   * Não ativa, não notifica “campanha ativa”, e relaxa o piso de saldo
   * (ainda exige saldo líquido > 0 e sem débito).
   */
  queue_only?: boolean;
}

function buildInitialMessage(
  raw: string | undefined,
  distribuidora?: string,
): string {
  const clean = (raw || "").replace(/[\r\n]+/g, " ").trim();
  if (clean) return clean.slice(0, 160);
  const d = (distribuidora || "").trim();
  return d
    ? `Olá! Quero saber mais sobre a redução na conta de luz ${d}.`.slice(
      0,
      160,
    )
    : "Olá! Quero saber mais sobre a redução na minha conta de luz.";
}

const WA_BUSINESS_REQUIRED_SUBCODE = "2446885";
const WA_BUSINESS_REQUIRED_MESSAGE =
  "A Página selecionada está vinculada a um WhatsApp pessoal. Para publicar anúncio de WhatsApp, conecte uma conta WhatsApp Business à Página no Meta Business Suite e depois selecione os assets novamente.";
const WHATSAPP_FIX_LINKS = {
  whatsapp_manager: "https://business.facebook.com/wa/manage/phone-numbers/",
  whatsapp_accounts:
    "https://business.facebook.com/settings/whatsapp-business-accounts",
  pages: "https://business.facebook.com/settings/pages",
};

function campaignErrorResponse(
  err: unknown,
  corsHeaders: Record<string, string>,
) {
  const message = (err as Error)?.message ||
    "Erro inesperado ao criar campanha.";
  if (message.includes("1487079") || /targeting_relaxation/i.test(message)) {
    return new Response(
      JSON.stringify({
        error:
          "Configuração de público inválida. Removemos o campo de segmentação rejeitado pela Meta; tente publicar novamente.",
        code: "META_TARGETING_INVALID",
        meta_error: message,
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
  // Advantage+: age_max hard < 65 é rejeitado pela Meta.
  if (
    /idade máxima|age.?max|menos de 65/i.test(message) ||
    message.includes("1870189") || message.includes("1870190")
  ) {
    return new Response(
      JSON.stringify({
        error:
          "A Meta exige idade máxima 65 no público Advantage+. Já corrigimos o sistema — publique de novo.",
        code: "META_AGE_MAX_ADVANTAGE",
        meta_error: message,
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
  if (
    message.includes(WA_BUSINESS_REQUIRED_SUBCODE) ||
    message.includes("conta pessoal")
  ) {
    return new Response(
      JSON.stringify({
        error: WA_BUSINESS_REQUIRED_MESSAGE,
        code: "WHATSAPP_BUSINESS_REQUIRED",
        meta_error: message,
        links: WHATSAPP_FIX_LINKS,
        next_steps: [
          "Abra Contas WhatsApp Business e vincule a WABA à Página usada nos anúncios",
          "Abra WhatsApp Manager e confirme o phone_number_id real do número",
          "Volte no Admin e clique em Validar e corrigir WhatsApp automaticamente",
        ],
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
  return new Response(JSON.stringify({ error: message }), {
    status: 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const corsHeaders = buildCors(req, "x-service-secret");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  let consultantIdForAlert: string | null = null;
  // Saga da publicação: precisa ser visível no catch para marcar o caso
  // "objeto existe na Meta, portal não sabe" como pendente de conferência.
  let publishSagaId: string | undefined;
  try {
    const body = await req.json() as Body;
    let auth = await authConsultant(req);
    if (!auth && isServiceRoleAuth(req)) {
      // Seed do Cérebro (queue_only): service_role pode criar 1 exploradora
      // pausada na fila. Qualquer outro create automático continua bloqueado.
      const queueOnly = Boolean(body.queue_only);
      const cid = typeof body.consultant_id === "string"
        ? body.consultant_id.trim()
        : "";
      const uuidOk =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
          .test(cid);
      if (!queueOnly || !uuidOk) {
        return new Response(
          JSON.stringify({
            ok: true,
            skipped: "automatic_campaign_creation_disabled",
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      const adminGate = adminClient();
      const { data: settings } = await adminGate
        .from("consultant_ad_settings")
        .select("brain_config")
        .eq("consultant_id", cid)
        .maybeSingle();
      if (!isAdsActionAllowedForConfig(settings?.brain_config, "seed_explorer")) {
        return new Response(
          JSON.stringify({
            ok: true,
            skipped: "seed_explorer_not_allowed",
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      auth = { id: cid, supabase: adminGate };
    }
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    consultantIdForAlert = auth.id;

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
        return new Response(
          JSON.stringify({ error: "Template indisponível ou despublicado." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
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
      const fill = (s: string) =>
        (s || "")
          .replaceAll("{cidade}", firstCity)
          .replaceAll("{distribuidora}", distrib)
          .replaceAll("{nome_consultor}", consultantName);

      if (!body.photos?.length && Array.isArray(t.photos)) {
        body.photos = t.photos as any;
      }
      if (!body.headline) body.headline = fill(t.headline);
      else body.headline = fill(body.headline);
      if (!body.primary_text) body.primary_text = fill(t.primary_text);
      else body.primary_text = fill(body.primary_text);
      if (!body.description && t.description_text) {
        body.description = fill(t.description_text);
      }
      if (body.age_min == null) body.age_min = t.age_min;
      if (body.age_max == null) body.age_max = t.age_max;
      if (!body.daily_budget_cents) {
        body.daily_budget_cents = t.suggested_daily_budget_cents;
      }

      // A/B test: empilha variações do template (placeholders preenchidos) no body
      const hvar = Array.isArray(t.headline_variants)
        ? t.headline_variants
        : [];
      const pvar = Array.isArray(t.primary_text_variants)
        ? t.primary_text_variants
        : [];
      (body as any).__variants = {
        headlines: hvar.map(fill).filter(Boolean),
        primary_texts: pvar.map(fill).filter(Boolean),
      };
    }

    const creativeMode: "photo" | "video" = body.creative_mode === "video"
      ? "video"
      : "photo";
    const hasCustomLocations = Array.isArray(body.custom_locations) &&
      body.custom_locations.length > 0;
    const hasCities = Array.isArray(body.cities) && body.cities.length > 0;
    const hasCreative = creativeMode === "video"
      ? !!(body.video && body.video.url)
      : !!(body.photos && body.photos.length);
    if (
      (!hasCities && !hasCustomLocations) || !body.daily_budget_cents ||
      !hasCreative || !body.headline || !body.primary_text
    ) {
      return new Response(
        JSON.stringify({
          error:
            "Campos obrigatórios faltando (localização, criativo, headline ou texto).",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    // CPL: no máximo 2 municípios por campanha. 1 é o ideal.
    const MAX_CITIES = 2;
    if (hasCities && body.cities.length > MAX_CITIES) {
      console.warn(
        `[fb-create] truncando ${body.cities.length} cidades → ${MAX_CITIES} (CPL)`,
      );
      body.cities = body.cities.slice(0, MAX_CITIES);
    }
    if (hasCustomLocations && body.custom_locations!.length > MAX_CITIES) {
      console.warn(
        `[fb-create] truncando ${
          body.custom_locations!.length
        } raios → ${MAX_CITIES} (CPL)`,
      );
      body.custom_locations = body.custom_locations!.slice(0, MAX_CITIES);
    }
    // Orçamento mínimo operacional; não há teto artificial. O saldo e o prazo
    // continuam limitando o gasto total antes de qualquer chamada à Meta.
    if (body.daily_budget_cents < META_MIN_DAILY_BUDGET_CENTS) {
      return new Response(
        JSON.stringify({
          error: "Orçamento mínimo é R$ 5,17/dia (mínimo da Meta).",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (
      body.duration_days != null &&
      (body.duration_days < 1 || body.duration_days > 30)
    ) {
      return new Response(
        JSON.stringify({
          error: "A duração deve ficar entre 1 e 30 dias, ou sem prazo final.",
          code: "INVALID_DURATION",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Valida o rodízio antes de qualquer chamada mutável à Meta. A criação é
    // fail-closed: participante inválido/inativo bloqueia toda a publicação.
    const requestedRodizioIds = normalizeRodizioPartnerIds(body);
    const rodizioRequested = body.rodizio_enabled === true;
    if (rodizioRequested && requestedRodizioIds.length < 1) {
      return new Response(
        JSON.stringify({
          error:
            "Selecione pelo menos 1 participante ativo para publicar com rodízio.",
          code: "RODIZIO_PARTNER_REQUIRED",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (rodizioRequested) {
      const validationAdmin = adminClient();
      const { data: partners, error: partnersError } = await validationAdmin
        .from("referral_partners")
        .select("id, consultant_id, is_active")
        .in("id", requestedRodizioIds);
      if (partnersError) {
        return new Response(
          JSON.stringify({
            error: "Não foi possível validar os participantes do rodízio.",
            code: "RODIZIO_VALIDATION_FAILED",
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      const allowed = new Set(
        ((partners as any[]) || [])
          .filter((partner) =>
            partner.consultant_id === auth.id && partner.is_active === true
          )
          .map((partner) => String(partner.id)),
      );
      const invalidIds = requestedRodizioIds.filter((id) => !allowed.has(id));
      if (invalidIds.length > 0) {
        return new Response(
          JSON.stringify({
            error:
              `${invalidIds.length} participante(s) do rodízio não pertence(m) a você ou está(ão) inativo(s).`,
            code: "RODIZIO_INVALID_PARTNERS",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // ─── Protocolo interno (só no banco) + frase limpa no WhatsApp ───────
    // tracking_protocol fica em facebook_campaigns pra relatório/admin.
    // O lead NÃO vê protocolo — só a frase comercial (única por consultor).
    // Atribuição: AD ID / ctwa_clid (Meta) → frase exata → protocolo legado.
    const trackingChannel = detectTrackingChannel({
      placement_mode: body.placement_mode,
      placements: body.placements,
    });
    const trackingProtocol = await ensureCampaignTrackingProtocol(
      adminClient(),
      trackingChannel,
    );
    const trackedInitialMessage = stripTrackingProtocol(
      buildInitialMessage(body.initial_message, body.distribuidora),
    ).trim().slice(0, 280);
    if (trackedInitialMessage.length < 5) {
      return new Response(
        JSON.stringify({
          error: "A mensagem inicial do WhatsApp está vazia demais.",
          code: "MISSING_INITIAL_MESSAGE",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ─── BLOQUEIO: primeira mensagem CTWA precisa ser ÚNICA por consultor ───
    // Sem protocolo na frase, a unicidade é o fallback quando a Meta não manda AD ID.
    {
      const norm = (s: string) =>
        (s || "")
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
      const normNew = norm(trackedInitialMessage);
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
        const isDup = (dupRows || []).some((r: any) =>
          norm(r.initial_message) === normNew
        );
        if (isDup) {
          return new Response(
            JSON.stringify({
              error:
                "Essa primeira mensagem do WhatsApp já está em uso em outra campanha sua. Mude um pouco a frase (tem o botão 'Variar com IA') para conseguirmos medir cada campanha com precisão.",
              code: "DUPLICATE_INITIAL_MESSAGE",
            }),
            {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
      }
    }

    // ─── GUARDA ANTI-DUPLO-CLIQUE ───────────────────────────────────────────
    // Se o mesmo consultor publicou uma campanha com mesmo nome + mesmo daily
    // budget nos últimos 3 minutos, bloqueia. Cobre o caso do usuário clicar
    // "Publicar" duas vezes por engano (aconteceu com Horácio: 2026-0007 e
    // 2026-0008 criadas com 43s de diferença).
    {
      const adminDup = adminClient();
      const cutoffIso = new Date(Date.now() - 3 * 60_000).toISOString();
      const { data: recent } = await adminDup
        .from("facebook_campaigns")
        .select("id, name, daily_budget_cents, created_at")
        .eq("consultant_id", auth.id)
        .gte("created_at", cutoffIso)
        .limit(20);
      const nameNorm = (body.name || "").trim().toLowerCase();
      const expectedNameSegment = nameNorm ? ` · ${nameNorm} · ` : null;
      const clash = expectedNameSegment
        ? (recent || []).find((r: any) =>
          ` ${String(r.name || "").trim().toLowerCase()} `.includes(
            expectedNameSegment,
          ) &&
          Number(r.daily_budget_cents) === Number(body.daily_budget_cents)
        )
        : null;
      if (clash) {
        return new Response(
          JSON.stringify({
            error:
              "Você acabou de publicar uma campanha idêntica há menos de 3 minutos. Recarregue a lista — ela já foi criada.",
            code: "DUPLICATE_RECENT_CAMPAIGN",
            existing_id: clash.id,
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // A mesma trava de carteira vale para qualquer usuário, inclusive admin,
    // porque o gasto ocorre na conta Meta compartilhada da plataforma.
    const adminDb = adminClient();

    // GUARDRAIL: campanhas com prazo exigem cobertura do orçamento total + taxa.
    // Campanhas contínuas mantêm a proteção mínima de dias configurada.
    const admin = adminDb;
    const queueOnly = Boolean(body.queue_only) && isServiceRoleAuth(req);
    const { data: ps } = await admin.from("platform_settings").select("*").eq(
      "id",
      true,
    ).maybeSingle();
    const budgetRequirement = calculateCampaignBudgetRequirement({
      dailyBudgetCents: body.daily_budget_cents,
      durationDays: body.duration_days,
      platformFeePercent: Number(ps?.platform_fee_percent ?? 20),
      safetyMultiplier: Number(ps?.campaign_safety_multiplier ?? 1),
      // Fila de rotação: campanhas nascem pausadas — piso baixo (1 dia + taxa).
      minBalanceCents: queueOnly
        ? Math.max(
          META_MIN_DAILY_BUDGET_CENTS,
          Math.round(body.daily_budget_cents * 1.2),
        )
        : Number(ps?.min_balance_to_create_campaign_cents ?? 3000),
    });
    const feePct = Number(ps?.platform_fee_percent ?? 20) / 100;
    const requiredCents = budgetRequirement.requiredCents;
    const { data: w } = await admin.from("consultant_wallet")
      .select("balance_cents,debt_cents").eq("consultant_id", auth.id)
      .maybeSingle();
    const balance = Number(w?.balance_cents ?? 0);
    const debt = Number((w as any)?.debt_cents ?? 0);
    const liquid = Math.max(0, balance - debt);
    if (liquid < requiredCents) {
      return new Response(
        JSON.stringify({
          error: `Saldo insuficiente. Mínimo para esta campanha: R$ ${
            (requiredCents / 100).toFixed(2)
          } (você tem R$ ${
            (liquid / 100).toFixed(2)
          }). Recarregue na carteira.`,
          code: "INSUFFICIENT_WALLET_BALANCE",
          required_cents: requiredCents,
          balance_cents: liquid,
        }),
        {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ─── Reserva a intenção ANTES de qualquer escrita na Meta ─────────────
    // Sem isso, um timeout na UI + novo clique cria uma SEGUNDA campanha real
    // gastando dinheiro, e uma falha depois da criação deixa campanha órfã
    // (sem teto, sem waste guard, sem pausa por saldo).
    // Precisa conter TUDO que muda a campanha publicada. Campo de fora vira
    // colisão: duas publicações diferentes cairiam na mesma chave e a segunda
    // receberia o resultado da primeira sem publicar nada.
    const publishIntent = {
      name: body.name,
      name_prefix: body.name_prefix ?? null,
      cities: body.cities ?? null,
      custom_locations: body.custom_locations ?? null,
      daily_budget_cents: body.daily_budget_cents,
      duration_days: body.duration_days ?? null,
      age_min: body.age_min ?? null,
      age_max: body.age_max ?? null,
      headline: body.headline,
      primary_text: body.primary_text,
      description: body.description ?? null,
      initial_message: body.initial_message ?? null,
      creative_mode: body.creative_mode ?? null,
      photos: body.photos ?? null,
      video: body.video ?? null,
      distribuidora: body.distribuidora ?? null,
      template_id: body.template_id ?? null,
      placement_mode: body.placement_mode ?? null,
      placements: body.placements ?? null,
      is_remarketing: body.is_remarketing ?? null,
      retarget_ddds: body.retarget_ddds ?? null,
      rodizio_enabled: body.rodizio_enabled ?? null,
      rodizio_partner_ids: body.rodizio_partner_ids ?? null,
      queue_only: queueOnly,
    };
    const clientRequestId = await resolveClientRequestId(
      auth.id,
      body.client_request_id,
      publishIntent,
    );
    const claim = await claimPublishSaga(admin, {
      clientRequestId,
      consultantId: auth.id,
      requestHash: await requestHash(publishIntent),
    });
    if (!canProceedWithPublish(claim.outcome)) {
      const rejection = claimRejectionResponse(claim);
      return new Response(JSON.stringify(rejection.body), {
        status: rejection.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    publishSagaId = claim.sagaId;
    // RATEIO ANTI-PREJUÍZO: divide o saldo entre TODAS as campanhas ativas/pendentes
    // do consultor + a nova. Sem isso, N campanhas ativas teriam cada uma cap = saldo,
    // permitindo gasto potencial = N × saldo na Meta.
    // Para cada campanha existente, descontamos o que ela JÁ gastou (não conta como reserva).
    const { data: existingCamps } = await admin
      .from("facebook_campaigns")
      .select("id, fb_campaign_id, status, duration_days")
      .eq("consultant_id", auth.id)
      // Pausadas não entram no rateio/realinhamento: não devem consumir vaga
      // nem receber spend_cap novo enquanto uma campanha ativa é publicada.
      .in("status", ["active", "pending_review"]);
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
    const lifetimeCapCents = Math.max(
      30000,
      Math.min(exactBudgetCents, perCampaignExtra || exactBudgetCents),
    );
    // realinha o cap das existentes pra elas também respeitarem o rateio
    // Só campanhas sem duração fixa usam spend_cap. Campanhas com lifetime_budget
    // NÃO podem receber spend_cap na Meta (subcode 2446474), então ficam fora do
    // realinhamento para não gerar erro falso na publicação das próximas.
    const realignTargets = (existingCamps || []).filter((c: any) =>
      c.fb_campaign_id && !(Number(c.duration_days || 0) > 0)
    );

    // Carrega a conta Facebook ÚNICA da plataforma (admin) — todos consultores
    // rodam ads na mesma ad account/página/pixel, mudando só o telefone do CTA.
    const platform = await loadPlatformAccount();
    if (!platform?.ad_account_id || !platform.page_id) {
      return new Response(
        JSON.stringify({
          error:
            "A conta Facebook da plataforma ainda não foi configurada. Peça ao Super Admin para conectar.",
          code: "PLATFORM_FB_NOT_CONFIGURED",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
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
      const msg = waba.reason === "no_waba"
        ? (waba.hint ||
          "A Página da plataforma não tem WhatsApp Business (WABA) vinculado. Vincule em Meta Business Suite → WhatsApp → Contas.")
        : waba.reason === "no_numbers"
        ? "Nenhum telefone está registrado na WABA. Registre um número em Meta Business Suite → WhatsApp Manager."
        : waba.reason === "no_match"
        ? `Seu número não bate com nenhum registrado na WABA. Números disponíveis: ${opts}. Escolha um em Anúncios → Configurações.`
        : (waba.hint ||
          "Não foi possível resolver o número WhatsApp Business.");
      return new Response(
        JSON.stringify({
          error: msg,
          code: "WHATSAPP_BUSINESS_REQUIRED",
          waba_numbers: waba.numbers,
          detected_paths_tried: waba.detected_paths_tried || [],
          discovered_via: waba.discovered_via || null,
          next_steps: waba.next_steps || [],
          links: WHATSAPP_FIX_LINKS,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    // Número oficial: precisa vir da WABA/Graph ou de phone_number_id real salvo.
    // Não publicamos mais com fallback permission_limited porque a Meta recusa
    // no AdSet e deixa campanha órfã quando Página↔WABA não está vinculado.
    const authoritativeDigits = waba.chosen.digits;
    const authoritativePhoneId = waba.chosen.id;
    const authoritativeDisplay = waba.chosen.display;
    const hasRealPhoneNumberId = /^\d+$/.test(authoritativePhoneId);
    if (!hasRealPhoneNumberId) {
      return new Response(
        JSON.stringify({
          error:
            `O número ${authoritativeDigits} está salvo, mas o phone_number_id (${authoritativePhoneId}) não é um ID numérico real da Meta. Copie o phone_number_id no WhatsApp Manager ou vincule a WABA correta à Página ${
              waba.page_id || "da plataforma"
            }.`,
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
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    console.log(
      "[fb-create] waba resolved id=",
      authoritativePhoneId,
      "display=",
      authoritativeDisplay,
      "digits=",
      authoritativeDigits,
    );

    // Trava de saldo já validada acima (linha ~165) com fee e safety. Aqui só
    // garantimos a wallet existe; remoção do bypass admin pra zero prejuízo.
    const wallet = await getOrCreateWallet(auth.id);
    void wallet;
    // PIXEL: sempre o oficial salvo na plataforma (igreen-oficial-remarketing).
    // Fallback só se o campo estiver vazio (não deve acontecer após ensure-pixel).
    const OFFICIAL_PIXEL_FALLBACK = "708759256921383";
    const pixelId = platform.pixel_id || OFFICIAL_PIXEL_FALLBACK;
    if (!platform.pixel_id) {
      console.warn(
        `[fb-create-campaign] platform.pixel_id vazio; usando fallback ${OFFICIAL_PIXEL_FALLBACK}`,
      );
    }
    const conn = {
      token: platform.token,
      ad_account_id: platform.ad_account_id,
      page_id: platform.page_id,
      pixel_id: pixelId,
      ig_account_id: platform.ig_account_id,
      whatsapp_phone_number_id: authoritativePhoneId,
      whatsapp_destination_number: authoritativeDigits,
    };
    const accId = conn.ad_account_id; // já vem com prefixo act_
    // Idade mínima: regra de negócio iGreen prefere 28+, mas a partir de 2026 a Meta
    // passou a REJEITAR age_min > 25 quando o adset usa público Advantage+
    // (subcode 1870188: "controle de idade mínima do público não pode ser definido
    // como mais de 25 anos"). Solução oficial da Meta: manter age_min=25 no targeting
    // e passar a idade preferida (28) como SUGESTÃO via targeting_automation. Assim
    // continuamos priorizando 28+ sem quebrar a criação do adset.
    const REQUESTED_AGE_MIN = body.age_min ?? 30;
    const ageMin = Math.min(REQUESTED_AGE_MIN, 25); // hard cap Meta Advantage+
    const ageMinSuggested = REQUESTED_AGE_MIN > 25 ? REQUESTED_AGE_MIN : null;
    // Advantage+ (2026): age_max hard NÃO pode ser < 65 (subcode Meta).
    // Preferência de negócio (ex.: 60) fica só como sugestão/telemetria.
    const REQUESTED_AGE_MAX = body.age_max ?? 60;
    const ageMax = 65;
    const ageMaxSuggested = REQUESTED_AGE_MAX < 65 ? REQUESTED_AGE_MAX : null;
    const today = new Date().toISOString().slice(0, 10);
    const cityNames = (body.cities || []).map((c) => c.name).slice(0, 3).join(
      ", ",
    );
    const locLabel = hasCustomLocations
      ? (body.custom_locations![0].name ||
        body.custom_locations![0].address_string ||
        `${body.custom_locations!.length} ponto(s)`)
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
    const consultantName = consultantRow?.name || settings?.display_name ||
      "Consultor";
    const consultantTag = `CONS-${consultantLicense}`;
    const distribTag = body.distribuidora ||
      (hasCustomLocations ? locLabel : (cityNames || "iGreen"));
    const cityPrincipal = body.cities[0]?.name ||
      (hasCustomLocations ? locLabel : cityNames);
    // Prefixo livre do usuário — sanitiza e limita 40 chars, sempre NA FRENTE.
    // Remarketing: força apelido "remarketing" se o front não mandou outro.
    const wantsRemarketing = body.is_remarketing === true ||
      String(body.name_prefix || "").toLowerCase().includes("remarketing");
    const rawPrefix = String(
      body.name_prefix || (wantsRemarketing ? "remarketing" : ""),
    ).trim();
    const namePrefix = rawPrefix
      ? rawPrefix.replace(/[\[\]·|\r\n\t]/g, " ").replace(/\s+/g, " ").trim()
        .slice(0, 40)
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
        const labelName = `consultor:${consultantLicense}:${consultantName}`
          .slice(0, 100);
        const lr = await fbFetch(`/${accId}/adlabels`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            name: labelName,
            access_token: conn.token,
          }),
        });
        if (lr?.id) {
          consultantLabelId = lr.id;
          await adminDb2.from("consultants").update({
            facebook_label_id: consultantLabelId,
          }).eq("id", auth.id);
        }
      } catch (e) {
        console.warn(
          "[fb-create] criar adlabel falhou (segue sem):",
          (e as Error).message,
        );
      }
    }
    const adlabelsParam = consultantLabelId
      ? JSON.stringify([{ id: consultantLabelId }])
      : null;

    // CTWA OFICIAL via WABA — número precisa estar conectado à Página no Meta Business
    // Suite (WhatsApp Business API). Otimiza por CONVERSATIONS (mais barato que LINK_CLICKS),
    // atribuição nativa anúncio ↔ primeira mensagem, casa com pixel + CAPI via promoted_object.
    // Pixel oficial da plataforma (igreen-oficial-remarketing) — não depende do pixel do consultor.
    const hasPixel = !!pixelId;
    const objective = "OUTCOME_ENGAGEMENT";
    const optimizationGoal = "CONVERSATIONS";
    const pixelEvent = hasPixel ? "LEAD" : null;
    if (!conn.whatsapp_destination_number) {
      throw new Error(
        "WHATSAPP_BUSINESS_REQUIRED: número WhatsApp Business (WABA) não configurado para esta Página.",
      );
    }

    // ─── Pré-check reachestimate: valida promoted_object antes de gastar POSTs ───
    // Se Meta rejeitar aqui, aborta sem criar campanha órfã PAUSED no Ads Manager.
    try {
      const precheckGeo: Record<string, unknown> = hasCustomLocations
        ? {
          custom_locations: body.custom_locations!.slice(0, 5).map((p) => ({
            latitude: p.latitude,
            longitude: p.longitude,
            radius: Math.max(1, Math.min(50, Math.round(p.radius))),
            distance_unit: "kilometer",
          })),
          location_types: ["home", "recent"],
        }
        : {
          cities: body.cities.map((c) => ({ key: c.key })),
          location_types: ["home", "recent"],
        };
      const precheckTargeting: Record<string, unknown> = {
        geo_locations: precheckGeo,
        age_min: ageMin,
        age_max: ageMax,
        targeting_automation: { advantage_audience: 1 },
      };
      if (ageMinSuggested != null || ageMaxSuggested != null) {
        precheckTargeting.age_range = [
          ageMinSuggested ?? ageMin,
          ageMaxSuggested ?? ageMax,
        ];
      }
      const precheckPromoted = {
        page_id: conn.page_id,
        whatsapp_phone_number: authoritativeDigits,
      };
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
      console.warn(
        "[fb-create] precheck reachestimate falhou:",
        msg.slice(0, 300),
      );
      const isWabaMismatch = msg.includes("1487246") ||
        msg.includes("2446885") || /not linked to your account/i.test(msg);
      if (isWabaMismatch) {
        return new Response(
          JSON.stringify({
            error:
              `A Meta rejeitou o número ${authoritativeDisplay} (${authoritativeDigits}, id ${authoritativePhoneId}) no reachestimate. Confirme se este phone_number_id pertence à WABA vinculada à Página ${conn.page_id}.`,
            code: "WHATSAPP_BUSINESS_REQUIRED",
            phone_used: authoritativeDigits,
            phone_number_id: authoritativePhoneId,
            phone_display: authoritativeDisplay,
            waba_numbers: waba.numbers,
            detected_paths_tried: waba.detected_paths_tried || [],
            discovered_via: waba.discovered_via || null,
            meta_message: msg,
            next_steps: [
              `Vincule a WABA ${
                waba.waba_id || "do número"
              } à Página ${conn.page_id}`,
              "Confirme no WhatsApp Manager se o phone_number_id é o real do número",
              "Volte no Admin e clique em Validar e corrigir WhatsApp automaticamente",
            ],
            links: WHATSAPP_FIX_LINKS,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
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
      : {
        daily_budget: String(body.daily_budget_cents),
        spend_cap: String(lifetimeCapCents),
      };
    console.log(
      "[fb-create] step=campaign_create budget=",
      campaignBudgetParams,
    );
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
    // A partir daqui existe objeto na Meta. Registrar já garante que uma falha
    // adiante seja marcada para conferência em vez de virar campanha órfã.
    await recordPublishStage(admin, publishSagaId, "campaign_created", {
      fbCampaignId: campaignId,
    });

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
      // Advantage+ Audience (Marketing API): hard age_min ≤25 + age_max 65.
      // Preferência de negócio (ex. 30+) vai em age_range — sugestão oficial Meta.
      // Docs: targeting-expansion/advantage-audience (age_range + advantage_audience: 1).
      targeting_automation: { advantage_audience: 1 },
    };
    if (ageMinSuggested != null || ageMaxSuggested != null) {
      const rangeMin = ageMinSuggested ?? ageMin;
      const rangeMax = ageMaxSuggested ?? ageMax;
      (targeting as any).age_range = [rangeMin, rangeMax];
      console.log(
        `[fb-create] age preference age_range=[${rangeMin},${rangeMax}] hard_min=${ageMin} hard_max=${ageMax}`,
      );
    }
    // Placements: por padrão omite tudo → Meta aplica Advantage+ Placements
    // (recomendação oficial p/ CTWA, distribui em TODOS os elegíveis e otimiza CPL).
    // Modo manual: respeita lista do usuário (formato "fb:feed", "ig:reels", ...).
    const placementMode = body.placement_mode || "auto";
    if (
      placementMode === "manual" && Array.isArray(body.placements) &&
      body.placements.length
    ) {
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
    // Vídeo 9:16: positions Reels/Stories DEVEM ir no AdSet (antes do POST), não depois.
    if (creativeMode === "video") {
      (targeting as any).publisher_platforms = ["facebook", "instagram"];
      (targeting as any).facebook_positions = ["facebook_reels", "story"];
      (targeting as any).instagram_positions = ["reels", "story"];
    }
    // Lookalike + Custom Audience:
    // - Captação: LAL como âncora; exclui CRM (já clientes/leads ativos) pra não gastar verba.
    // - Remarketing: INCLUI CRM (leads frios do motor) + LAL; não exclui a lista.
    if (platformLalId) {
      (targeting as any).custom_audiences = [{ id: platformLalId }];
    }
    if (platformCustomAudId) {
      if (wantsRemarketing) {
        const existing = Array.isArray((targeting as any).custom_audiences)
          ? (targeting as any).custom_audiences
          : [];
        if (
          !existing.some((a: any) =>
            String(a?.id) === String(platformCustomAudId)
          )
        ) {
          (targeting as any).custom_audiences = [...existing, {
            id: platformCustomAudId,
          }];
        }
        delete (targeting as any).excluded_custom_audiences;
      } else {
        (targeting as any).excluded_custom_audiences = [{
          id: platformCustomAudId,
        }];
      }
    }
    // CTWA WABA: destination=WHATSAPP + promoted_object liga anúncio ↔ número WABA.
    // Tracking specs: messaging_first_reply (Meta nativo) + offsite_conversion via pixel/CAPI.
    let waNumberClean = String(conn.whatsapp_destination_number).replace(
      /\D/g,
      "",
    );
    const promotedObject: Record<string, string> = {
      page_id: conn.page_id,
      whatsapp_phone_number: waNumberClean,
    };
    const trackingSpecs: any[] = [
      { "action.type": ["onsite_conversion.messaging_first_reply"] },
    ];
    if (hasPixel) {
      trackingSpecs.push({
        "action.type": ["offsite_conversion"],
        fb_pixel: [pixelId],
      });
    }
    const adsetParams: Record<string, string> = {
      name:
        `[${consultantTag}] ${distribTag} · Conjunto Principal · ${cityPrincipal}`,
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
    // Campanhas contínuas não recebem encerramento oculto. Para campanhas de
    // prazo fixo, a janela do conjunto precisa ser ≥ 24 h (Meta 1487793).
    const startAt = Date.now() + 60_000;
    adsetParams.start_time = new Date(startAt).toISOString();
    if (hasFixedDuration) {
      const days = Math.max(1, body.duration_days as number);
      adsetParams.end_time = new Date(startAt + days * 86400_000 + 3_600_000)
        .toISOString();
    }
    console.log(
      "[fb-create] step=adset_create campaign=",
      campaignId,
      "phone_authoritative=",
      waNumberClean,
      "phone_id=",
      authoritativePhoneId,
    );
    let adset: any = null;
    try {
      adset = await fbFetch(`/${accId}/adsets`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(adsetParams),
      });
    } catch (e) {
      const msg = String((e as Error)?.message || "");
      console.warn(
        `[fb-create] adset falhou phone=${waNumberClean} phone_id=${authoritativePhoneId} err=${
          msg.slice(0, 300)
        }`,
      );
      // Evita órfã PAUSED na Meta quando o adset falha depois da campaign.
      try {
        await fbFetch(`/${campaignId}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            status: "DELETED",
            access_token: conn.token,
          }),
        });
        console.info(
          "[fb-create] orphan campaign deleted after adset failure",
          campaignId,
        );
      } catch (delErr) {
        console.warn(
          "[fb-create] orphan campaign delete failed",
          campaignId,
          String((delErr as Error)?.message || "").slice(0, 160),
        );
      }
      const isWabaMismatch = msg.includes("1487246") ||
        msg.includes("2446885") ||
        /not linked to your account/i.test(msg) ||
        /whatsapp/i.test(msg);
      if (isWabaMismatch) {
        return new Response(
          JSON.stringify({
            error:
              "Número WhatsApp Business não vinculado à Página/conta Meta usada no anúncio.",
            code: "WHATSAPP_BUSINESS_REQUIRED",
            message:
              `A Meta rejeitou o número autoritativo ${authoritativeDisplay} (${waNumberClean}, phone_number_id ${authoritativePhoneId}). Confirme se este phone_number_id pertence à WABA vinculada à Página ${conn.page_id}.`,
            phone_used: waNumberClean,
            phone_number_id: authoritativePhoneId,
            phone_display: authoritativeDisplay,
            waba_numbers: waba.numbers,
            meta_message: msg,
            next_steps: [
              `Vincule a WABA ${
                waba.waba_id || "do número"
              } à Página ${conn.page_id}`,
              "Confirme no WhatsApp Manager se o phone_number_id é o real do número",
              "Volte no Admin e clique em Validar e corrigir WhatsApp automaticamente",
            ],
            links: WHATSAPP_FIX_LINKS,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      throw e;
    }
    console.log(
      "[fb-create] adset OK phone_used=",
      waNumberClean,
      "phone_id=",
      authoritativePhoneId,
    );
    conn.whatsapp_destination_number = waNumberClean;
    const adsetId = adset.id as string;
    await recordPublishStage(admin, publishSagaId, "adset_created", {
      fbCampaignId: campaignId,
      fbAdsetIds: [adsetId],
    });

    const adIds: string[] = [];
    const rejectedImages: {
      url: string;
      issues: string[];
      suggestion?: string;
    }[] = [];
    // Mensagem inicial WhatsApp — hoisted pra que tanto modo foto quanto vídeo usem.
    const initialMessage = trackedInitialMessage;

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
          .from("ad_video_library").select(
            "id, fb_video_id, thumb_url, thumb_source, usage_count",
          )
          .eq("consultant_id", auth.id).eq("url", videoUrl).maybeSingle();
        if (cachedVid?.fb_video_id) {
          fbVideoId = cachedVid.fb_video_id;
          const cachedSource = (cachedVid as any).thumb_source || "user";
          if (
            !thumbUrl && cachedSource === "user" && (cachedVid as any).thumb_url
          ) {
            thumbUrl = (cachedVid as any).thumb_url;
          }
          await adminDb2.from("ad_video_library").update({
            usage_count: ((cachedVid as any).usage_count ?? 0) + 1,
            last_used_at: new Date().toISOString(),
          }).eq("id", cachedVid.id);
          console.log(
            "[fb-create] video CACHE HIT",
            fbVideoId,
            "thumb_source=",
            cachedSource,
          );
        }
      } catch (e) {
        console.warn("[fb-create] video cache lookup:", (e as Error).message);
      }

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
          throw new Error(
            `Falha ao enviar vídeo ao Facebook: ${(e as Error).message}`,
          );
        }

        // Polling de processamento (máx 50s, intervalos de 3s)
        const started = Date.now();
        let ready = false;
        while (Date.now() - started < 50_000) {
          try {
            const st = await fbFetch(
              `/${fbVideoId}?fields=status&access_token=${conn.token}`,
            );
            const phase = st?.status?.video_status as string | undefined;
            if (phase === "ready") {
              ready = true;
              break;
            }
            if (phase === "error") {
              throw new Error(
                `Vídeo rejeitado: ${st?.status?.error?.message || "erro"}`,
              );
            }
          } catch (_) { /* tenta de novo */ }
          await new Promise((r) => setTimeout(r, 3_000));
        }
        if (!ready) {
          console.warn(
            "[fb-create] vídeo não ficou pronto a tempo; ad fica PAUSED até processar",
          );
        }

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
        } catch (e) {
          console.warn("[fb-create] cache video falhou:", (e as Error).message);
        }
      }

      // Auto-resolve thumbnail se o usuário não enviou (Meta exige image_url/image_hash).
      if (!thumbUrl && fbVideoId) {
        const fetchThumb = async (): Promise<string | null> => {
          try {
            const tr = await fbFetch(
              `/${fbVideoId}/thumbnails?access_token=${conn.token}`,
            );
            const list = (tr?.data || []) as Array<
              { uri?: string; is_preferred?: boolean }
            >;
            if (!list.length) return null;
            const preferred = list.find((t) => t.is_preferred && t.uri);
            return (preferred?.uri || list[0]?.uri) ?? null;
          } catch (e) {
            console.warn(
              "[fb-create] thumbnails fetch falhou:",
              (e as Error).message,
            );
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
          throw new Error(
            "Meta ainda não gerou a miniatura do vídeo, tente novamente em alguns segundos.",
          );
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
            console.warn(
              "[fb-create] captions upload falhou:",
              cap.status,
              JSON.stringify(capJson).slice(0, 300),
            );
          } else {
            console.log(
              "[fb-create] captions anexadas pt_BR ao video",
              fbVideoId,
            );
          }
        } catch (e) {
          console.warn("[fb-create] captions error:", (e as Error).message);
        }
      }

      // Placements 9:16 já aplicados no AdSet (acima). Aqui só criativo.
      // Explore IG em descontinuação — não usar.
      const initialMessageV = trackedInitialMessage;
      const waNumberCleanV = String(conn.whatsapp_destination_number).replace(
        /\D/g,
        "",
      );
      const waLinkV =
        `https://api.whatsapp.com/send?phone=${waNumberCleanV}&text=${
          encodeURIComponent(initialMessageV)
        }`;
      const urlTagsV =
        `utm_source=facebook&utm_medium=cpc&utm_campaign={{campaign.id}}&utm_content=consultor_${consultantLicense}&utm_term={{adset.id}}`;

      // Headline curta pra não ser truncada em Reels (~40 chars visíveis) e Stories.
      const videoTitle = String(body.headline || "").slice(0, 27);

      // Meta exige image_url/image_hash explícito em video_data desde 2025
      // (subcode 1443226 "Seu anúncio precisa de uma miniatura de vídeo").
      // Reusamos a thumb já resolvida (preferred do próprio CDN da Meta),
      // que respeita 9:16 e não causa crop nos placements Reels/Stories.
      if (!thumbUrl) {
        throw new Error(
          "Miniatura do vídeo não disponível; tente publicar novamente em alguns segundos.",
        );
      }
      const videoData: Record<string, unknown> = {
        video_id: fbVideoId,
        title: videoTitle,
        message: body.primary_text,
        image_url: thumbUrl,
        call_to_action: { type: "WHATSAPP_MESSAGE", value: { link: waLinkV } },
        page_welcome_message: buildCtwaPageWelcomeMessage(initialMessageV),
      };

      console.log(
        "[fb-create] video ad: age_min=",
        ageMin,
        "age_max=",
        ageMax,
        "advantage=1 positions_fb=",
        (targeting as any).facebook_positions,
        "positions_ig=",
        (targeting as any).instagram_positions,
      );

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
        typeof p === "string" ? { url: p, format: "square" as const } : p
      );

      // 3.0) SEM validação Gemini síncrona aqui — estourava CPU da Edge Function (546).
      // A análise de imagem virou job assíncrono via ad-image-validator (preflight separado).
      const validated: Tagged[] = tagged;

      // base64 em chunks (não loop byte-a-byte) — reduz CPU em ~10x
      function bytesToBase64(buf: Uint8Array): string {
        const CHUNK = 0x8000;
        let bin = "";
        for (let i = 0; i < buf.length; i += CHUNK) {
          bin += String.fromCharCode.apply(
            null,
            Array.from(buf.subarray(i, i + CHUNK)) as any,
          );
        }
        return btoa(bin);
      }

      console.log("[fb-create] step=images_start count=", validated.length);
      const uploaded: {
        hash: string;
        format: "square" | "vertical" | "story";
      }[] = [];
      const uploadErrors: string[] = [];
      const adminImg = adminClient();
      const FB_GRAPH = "https://graph.facebook.com/v23.0";

      // Limita a 5 imagens por publicação pra ficar dentro do CPU budget.
      for (const item of validated.slice(0, 5)) {
        const url = item.url;
        const filename = url.split("/").pop()?.split("?")[0] ||
          `img_${Date.now()}.jpg`;
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
        } catch (e) {
          console.warn(
            "[fb-create] cache lookup falhou:",
            (e as Error).message,
          );
        }

        // Estratégia 1: multipart binário (oficial, mais confiável).
        if (!hash) {
          try {
            const imgResp = await fetch(url);
            if (!imgResp.ok) throw new Error(`download ${imgResp.status}`);
            const blob = await imgResp.blob();
            const fd = new FormData();
            fd.append("source", blob, filename);
            fd.append("access_token", conn.token);
            const r = await fetch(`${FB_GRAPH}/${accId}/adimages`, {
              method: "POST",
              body: fd,
            });
            const j = await r.json();
            if (!r.ok) {
              const msg = j?.error?.error_user_msg || j?.error?.message ||
                `HTTP ${r.status}`;
              throw new Error(msg);
            }
            hash = j?.images && Object.values(j.images)[0]
              ? (Object.values(j.images)[0] as any).hash
              : null;
            if (!hash) throw new Error("response sem hash");
          } catch (e1) {
            console.warn(
              "[fb-create] multipart falhou, fallback url:",
              filename,
              (e1 as Error).message,
            );
            // Estratégia 2: parâmetro url (Meta baixa direto).
            try {
              const r = await fbFetch(`/${accId}/adimages`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                  url,
                  name: filename,
                  access_token: conn.token,
                }),
              });
              hash = r?.images && Object.values(r.images)[0]
                ? (Object.values(r.images)[0] as any).hash
                : null;
              if (!hash) throw new Error("response sem hash");
            } catch (e2) {
              console.error(
                "[fb-create] upload imagem falhou em todas tentativas:",
                filename,
                (e2 as Error).message,
              );
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
        const detail = uploadErrors.length
          ? ` Detalhe Meta: ${uploadErrors.join(" | ")}`
          : "";
        throw new Error(
          `Nenhuma imagem pôde ser carregada no Facebook.${detail}`,
        );
      }
      const squareHashes = uploaded.filter((u) => u.format === "square").map((
        u,
      ) => u.hash);
      const verticalHashes = uploaded.filter((u) => u.format === "vertical")
        .map((u) => u.hash);
      const storyHashes = uploaded.filter((u) => u.format === "story").map((
        u,
      ) => u.hash);
      const allHashes = uploaded.map((u) => u.hash);

      // 4) Creative — Click-to-WhatsApp NATIVO (WABA). Meta abre conversa direto
      // no número da WABA conectado à Página, sem link wa.me intermediário.
      // initialMessage já declarado acima (hoisted pra modo foto e vídeo).
      console.log("[fb-create] initial WA message:", initialMessage);

      // CTWA oficial usa api.whatsapp.com/send com phone WABA (mesmo número do promoted_object).
      const waLink =
        `https://api.whatsapp.com/send?phone=${waNumberClean}&text=${
          encodeURIComponent(initialMessage)
        }`;
      // url_tags: macros do Meta substituem {{campaign.id}} / {{adset.id}} no clique.
      const urlTags =
        `utm_source=facebook&utm_medium=cpc&utm_campaign={{campaign.id}}&utm_content=consultor_${consultantLicense}&utm_term={{adset.id}}`;

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
        // Sem page_welcome_message a Meta usa o default "Can I get more info / saber mais"
        // e o lead NÃO envia o protocolo — matching fica só no ctwa_clid/ad_id.
        page_welcome_message: buildCtwaPageWelcomeMessage(initialMessage),
        image_hash,
      });

      // adIds já declarado acima (modo video pode ter populado).

      // Estratégia 1 (preferida): 1 Ad com asset_feed_spec + customization
      // por posicionamento. Reels/Stories pegam 9:16, Feed pega 1:1/4:5 → fim do corte.
      const hasMultiFormat =
        (squareHashes.length + verticalHashes.length > 0) &&
        storyHashes.length > 0;
      if (hasMultiFormat) {
        const images: any[] = [];
        if (squareHashes.length || verticalHashes.length) {
          for (const h of [...squareHashes, ...verticalHashes]) {
            images.push({ hash: h, adlabels: [{ name: "feed" }] });
          }
        }
        for (const h of storyHashes) {
          images.push({ hash: h, adlabels: [{ name: "story" }] });
        }
        const assetFeedSpec = {
          images,
          bodies: (() => {
            const v = (body as any).__variants?.primary_texts as
              | string[]
              | undefined;
            const all = [
              body.primary_text,
              ...((v || []).filter((x) => x && x !== body.primary_text)),
            ].slice(0, 5);
            return all.map((text) => ({ text }));
          })(),
          titles: (() => {
            const v = (body as any).__variants?.headlines as
              | string[]
              | undefined;
            const all = [
              body.headline,
              ...((v || []).filter((x) => x && x !== body.headline)),
            ].slice(0, 5);
            return all.map((text) => ({ text }));
          })(),
          descriptions: body.description ? [{ text: body.description }] : [],
          link_urls: [{ website_url: waLink }],
          call_to_action_types: ["WHATSAPP_MESSAGE"],
          ad_formats: ["SINGLE_IMAGE"],
          asset_customization_rules: [
            {
              customization_spec: {
                publisher_platforms: ["facebook"],
                facebook_positions: [
                  "feed",
                  "marketplace",
                  "search",
                  "video_feeds",
                ],
              },
              image_label: { name: "feed" },
            },
            {
              customization_spec: {
                publisher_platforms: ["instagram"],
                instagram_positions: ["stream", "explore"],
              },
              image_label: { name: "feed" },
            },
            {
              customization_spec: {
                publisher_platforms: ["facebook"],
                facebook_positions: ["story", "instream_video"],
              },
              image_label: { name: "story" },
            },
            {
              customization_spec: {
                publisher_platforms: ["facebook"],
                facebook_positions: ["facebook_reels"],
              },
              image_label: { name: "story" },
            },
            {
              customization_spec: {
                publisher_platforms: ["instagram"],
                instagram_positions: ["story", "reels"],
              },
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
              object_story_spec: JSON.stringify({
                page_id: conn.page_id,
                // Welcome CTWA também no caminho asset_feed (senão Meta usa default).
                link_data: {
                  link: waLink,
                  message: body.primary_text,
                  name: body.headline,
                  call_to_action: {
                    type: "WHATSAPP_MESSAGE",
                    value: { link: waLink },
                  },
                  page_welcome_message: buildCtwaPageWelcomeMessage(
                    initialMessage,
                  ),
                },
              }),
              asset_feed_spec: JSON.stringify(assetFeedSpec),
              degrees_of_freedom_spec: JSON.stringify({
                creative_features_spec: {
                  standard_enhancements: { enroll_status: "OPT_IN" },
                },
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
          console.warn(
            "[fb-create] asset_feed_spec falhou, caindo no fallback:",
            (e as Error).message,
          );
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
            console.warn(
              `[fb-create] criativo ${i + 1} falhou:`,
              (e as Error).message,
            );
          }
        }
      }
    } // fim do if (creativeMode === "photo")
    if (!adIds.length) {
      throw new Error("Nenhum anúncio pôde ser criado no Facebook.");
    }
    await recordPublishStage(admin, publishSagaId, "ads_created", {
      fbCampaignId: campaignId,
      fbAdsetIds: [adsetId],
      fbAdIds: adIds,
    });

    // 6) Persiste
    // Reusa o `admin` (adminClient) já criado na validação de saldo lá em cima —
    // redeclarar com `const admin` aqui causava SyntaxError ("Identifier 'admin'
    // has already been declared") e derrubava a função INTEIRA no boot.
    // Em modo raio, serializa os pontos em `cities` (key sintético "radius:lat,lng:r")
    // pra preservar geo na listagem local — assim o dashboard não fica "sem cidade".
    const citiesPersist = hasCustomLocations
      ? body.custom_locations!.map((p) => ({
        key: `radius:${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}:${
          Math.round(p.radius)
        }`,
        name: `${p.name || p.address_string || "Endereço"} (${
          Math.round(p.radius)
        }km)`,
      }))
      : (body.cities || []);
    // Captura o id (uuid) da linha recém-criada em facebook_campaigns. Esse id
    // é a chave usada pela pool de rodízio (rodizio_pools.campaign_id) e pela
    // telemetria de template. Antes era refeito um SELECT por fb_campaign_id;
    // agora o insert já devolve o id, evitando uma ida extra ao banco.
    const { data: insertedCampaign, error: insertCampaignError } = await admin
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
        // Preferência de negócio (ex. 30) — hard Meta fica em age_min/age_max.
        // Coluna opcional: se existir age_min_preferred no schema, gravamos; senão ignora via spread só se definido.
        ...(ageMinSuggested != null
          ? { age_min_preferred: ageMinSuggested } as any
          : {}),
        daily_budget_cents: body.daily_budget_cents,
        lifetime_cap_cents: lifetimeCapCents,
        duration_days: body.duration_days ?? null,
        end_time_utc: hasFixedDuration
          ? new Date(Date.now() + (body.duration_days as number) * 86400_000)
            .toISOString()
          : null,
        status: "pending_review",
        started_at: new Date().toISOString(),
        distribuidora: body.distribuidora ?? null,
        pixel_event_optimized: pixelEvent,
        initial_message: initialMessage,
        tracking_protocol: trackingProtocol,
        tracking_protocol_channel: trackingChannel,
      })
      .select("id")
      .maybeSingle();
    if (insertCampaignError) {
      console.error(
        "[fb-create] persist facebook_campaigns falhou:",
        insertCampaignError.message,
      );
      throw new Error(
        `Campanha criada na Meta, mas falhou ao salvar no portal: ${insertCampaignError.message}`,
      );
    }
    const campaignRowId = (insertedCampaign as { id?: string } | null)?.id ??
      null;
    if (!campaignRowId) {
      throw new Error(
        "Campanha criada na Meta, mas o portal não retornou o id interno.",
      );
    }
    // Meta e portal já estão em par: daqui pra frente uma falha não é órfã.
    await recordPublishStage(admin, publishSagaId, "persisted", {
      fbCampaignId: campaignId,
      fbAdsetIds: [adsetId],
      fbAdIds: adIds,
      campaignRowId,
    });

    // Remarketing: merge DDDs das cidades (e vizinhas) na allowlist da plataforma.
    let retargetDddsMerged: number[] = [];
    if (wantsRemarketing) {
      try {
        const resolved = resolveRetargetDdds({
          clientDdds: Array.isArray(body.retarget_ddds)
            ? body.retarget_ddds
            : null,
          cities: body.cities || [],
          customLocations: body.custom_locations || null,
        });
        retargetDddsMerged = await mergePlatformRetargetDdds(admin, resolved);
        console.log(
          "[fb-create] remarketing DDDs merged:",
          retargetDddsMerged.join(","),
        );
      } catch (e) {
        console.warn(
          "[fb-create] merge retarget DDDs falhou:",
          (e as Error).message,
        );
      }
    }

    // ─── Rodízio: configura pool + membros em uma única transação ────────
    // A campanha ainda está pausada/pending_review; a pool só fica operacional
    // quando o status local for confirmado como active pelo trigger do banco.
    let rodizioConfigured = false;
    let rodizioPoolId: string | null = null;
    let rodizioMembersCount = 0;
    let rodizioWarning: string | null = null;

    if (rodizioRequested) {
      const { data: configured, error: configureError } = await admin.rpc(
        "configure_rodizio_pool",
        {
          p_campaign_id: campaignRowId,
          p_enabled: true,
          p_partner_ids: requestedRodizioIds,
          p_label: campaignName,
        },
      );
      if (configureError) {
        const msg = configureError.message || "falha ao configurar o rodízio";
        await admin.from("facebook_campaigns").update({
          status: "pending_review",
          rejection_reason: `Rodízio não configurado: ${msg}`,
        }).eq("id", campaignRowId);
        console.error(
          "[fb-create] publicação bloqueada: rodízio não configurado:",
          msg,
        );
        return new Response(
          JSON.stringify({
            error:
              "A campanha foi criada pausada, mas o rodízio não pôde ser configurado. Nada foi ativado. Corrija o rodízio antes de tentar ativar.",
            code: "RODIZIO_CONFIGURATION_FAILED",
            portal_campaign_id: campaignRowId,
            campaign_id: campaignId,
            local_status: "pending_review",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      const result = Array.isArray(configured) ? configured[0] : configured;
      rodizioConfigured = result?.enabled === true;
      rodizioPoolId = result?.pool_id ?? null;
      rodizioMembersCount = Number(result?.members ?? 0);
      if (!rodizioConfigured || !rodizioPoolId || rodizioMembersCount < 1) {
        await admin.from("facebook_campaigns").update({
          status: "pending_review",
          rejection_reason: "Rodízio retornou configuração incompleta.",
        }).eq("id", campaignRowId);
        return new Response(
          JSON.stringify({
            error:
              "A campanha foi criada pausada, mas o rodízio ficou incompleto. Nada foi ativado.",
            code: "RODIZIO_CONFIGURATION_INCOMPLETE",
            portal_campaign_id: campaignRowId,
            campaign_id: campaignId,
            local_status: "pending_review",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      console.log(
        `[fb-create] rodízio: pool ${rodizioPoolId} configurada com ${rodizioMembersCount} membros`,
      );
    }

    // Telemetria de uso do template (gallery → consultor → campanha).
    if (templateRow?.id) {
      await admin.from("ad_template_usages").insert({
        template_id: templateRow.id,
        consultant_id: auth.id,
        campaign_id: campaignRowId,
      });
    }

    // 7) Ativação — ou deixa na fila (queue_only = pausada na Meta + DB).
    let activated = false;
    let activationError: string | null = null;
    let effectiveStatus = "UNKNOWN";
    let localStatus: "active" | "pending_review" | "rejected" | "paused" =
      "pending_review";

    if (queueOnly) {
      localStatus = "paused";
      effectiveStatus = "PAUSED";
      await admin.from("facebook_campaigns").update({
        status: "paused",
        rejection_reason:
          "ROTATION_QUEUE: na fila de rotação MG — só o rotator ativa o slot",
        updated_at: new Date().toISOString(),
      }).eq("fb_campaign_id", campaignId);
    } else {try {
        await fbFetch(`/${adsetId}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            status: "ACTIVE",
            access_token: conn.token,
          }),
        });
        for (const adId of adIds) {
          await fbFetch(`/${adId}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              status: "ACTIVE",
              access_token: conn.token,
            }),
          });
        }
        await fbFetch(`/${campaignId}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            status: "ACTIVE",
            access_token: conn.token,
          }),
        });

        const [campaignState, adsetState, ...adStates] = await Promise.all([
          fbFetch(
            `/${campaignId}?fields=effective_status,configured_status,issues_info&access_token=${
              encodeURIComponent(conn.token)
            }`,
          ),
          fbFetch(
            `/${adsetId}?fields=effective_status,configured_status,issues_info&access_token=${
              encodeURIComponent(conn.token)
            }`,
          ),
          ...adIds.map((adId) =>
            fbFetch(
              `/${adId}?fields=effective_status,configured_status,issues_info&access_token=${
                encodeURIComponent(conn.token)
              }`,
            )
          ),
        ]) as MetaObjectState[];
        const resolved = resolveCampaignEffectiveStatus(campaignState, [
          adsetState,
        ], adStates);
        effectiveStatus = resolved.campaignEffectiveStatus;
        localStatus = resolved.localStatus === "active"
          ? "active"
          : resolved.localStatus === "rejected"
          ? "rejected"
          : "pending_review";
        activated = localStatus === "active";
        activationError = resolved.issues.length > 0
          ? resolved.issues.join(" • ")
          : null;
        await admin.from("facebook_campaigns").update({
          status: localStatus,
          rejection_reason: localStatus === "rejected"
            ? activationError || "A Meta sinalizou problema na campanha."
            : null,
        }).eq("fb_campaign_id", campaignId);

        if (localStatus === "active") {
          await safeNotifyConsultant(
            auth.id,
            rejectedImages.length ? "warning" : "info",
            rejectedImages.length
              ? "Campanha ativa com alertas"
              : "Campanha ativa ✅",
            rejectedImages.length
              ? `${rejectedImages.length} foto(s) foram descartadas. A Meta confirmou a campanha como ativa.\nCampanha: ${campaignName}`
              : `A Meta confirmou sua campanha como ativa:\n${campaignName}\nOrçamento: R$ ${
                (body.daily_budget_cents / 100).toFixed(2)
              }/dia`,
          );
        } else {
          await safeNotifyConsultant(
            auth.id,
            localStatus === "rejected" ? "error" : "info",
            localStatus === "rejected"
              ? "Campanha com pendência na Meta"
              : "Campanha enviada à Meta",
            localStatus === "rejected"
              ? `A campanha "${campaignName}" precisa de correção.\n\n${
                activationError || "Consulte o painel para ver os detalhes."
              }`
              : `A campanha "${campaignName}" foi criada e está em análise ou processamento. O painel mostrará quando ficar ativa.`,
          );
        }
      } catch (e) {
        activationError = (e as Error).message;
        console.warn(
          "[fb-create] ativação/reconciliação adiada:",
          activationError,
        );
        await admin.from("facebook_campaigns").update({
          status: "pending_review",
          rejection_reason: activationError,
        }).eq("fb_campaign_id", campaignId);
        await safeNotifyConsultant(
          auth.id,
          "warning",
          "Campanha aguardando confirmação",
          `A campanha "${campaignName}" foi criada, mas não foi possível confirmar o estado final na Meta.\n\nMotivo: ${activationError}\n\nAtualize o painel antes de tentar qualquer nova publicação.`,
        );
      }}

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
          const ecSpent = (spentRow || []).reduce(
            (s: number, r: any) => s + Number(r.gross_spend_cents || 0),
            0,
          );
          const newEcCap = Math.max(30000, ecSpent + perCampaignExtra);
          await fbFetch(`/${ec.fb_campaign_id}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              spend_cap: String(newEcCap),
              access_token: conn.token,
            }),
          });
          await admin.from("facebook_campaigns")
            .update({
              lifetime_cap_cents: newEcCap,
              updated_at: new Date().toISOString(),
            })
            .eq("id", ec.id);
        } catch (re) {
          const msg = (re as Error).message || "";
          // subcodes permanentes: nada a fazer automaticamente — loga como info
          if (/subcode=(1885058|2446474)/.test(msg)) {
            console.info(
              "[fb-create] realign skip (permanente)",
              ec.fb_campaign_id,
              msg.slice(0, 120),
            );
          } else {
            console.warn(
              "[fb-create] realign existing cap failed",
              ec.fb_campaign_id,
              msg,
            );
          }
        }
      }
    })();
    try {
      const edgeRuntime = (globalThis as typeof globalThis & {
        EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
      }).EdgeRuntime;
      edgeRuntime?.waitUntil?.(realignJob);
    } catch { /* ambiente sem waitUntil — deixa promise soltar */ }

    const publishResult = {
      ok: true,
      campaign_id: campaignId,
      portal_campaign_id: campaignRowId,
      adset_id: adsetId,
      ad_ids: adIds,
      ads_count: adIds.length,
      tracking_protocol: trackingProtocol,
      activated,
      effective_status: effectiveStatus,
      local_status: localStatus,
    };
    // Guardado para replay: se a UI reenviar a mesma intenção, devolvemos isto
    // em vez de publicar outra campanha.
    await completePublishSaga(admin, publishSagaId, publishResult);

    return new Response(
      JSON.stringify({
        ok: true,
        campaign_id: campaignId,
        portal_campaign_id: campaignRowId,
        adset_id: adsetId,
        ad_ids: adIds,
        ads_count: adIds.length,
        tracking_protocol: trackingProtocol,
        activated,
        effective_status: effectiveStatus,
        local_status: localStatus,
        activation_error: activationError,
        rodizio_configured: rodizioConfigured,
        rodizio_pool_id: rodizioPoolId,
        rodizio_members: rodizioMembersCount,
        rodizio_warning: rodizioWarning,
        is_remarketing: wantsRemarketing,
        retarget_ddds: retargetDddsMerged,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[fb-create] step=fatal", err);
    // Encerra a saga. O RPC decide sozinho se exige conferência humana: exige
    // quando já havia objeto criado na Meta (gasto possível fora do portal).
    try {
      await failPublishSaga(
        adminClient(),
        publishSagaId,
        err instanceof Error ? err.message : String(err),
      );
    } catch (sagaError) {
      console.error("[fb-create] saga fail", (sagaError as Error).message);
    }
    // notifyConsultant removido daqui — chamada externa em catch pode estourar CPU
    // e a UI já mostra o erro retornado pela função.
    return campaignErrorResponse(err, corsHeaders);
  }
});
