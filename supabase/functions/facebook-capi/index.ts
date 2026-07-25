// Conversions API: envia eventos server-side ao Pixel ou como Offline Conversion.
// Pode ser chamado por outras edge functions (lead, contact) ou diretamente.
import {
  adminClient,
  FB_GRAPH,
  fbFetch,
  loadPlatformAccount,
} from "../_shared/fb-graph.ts";
import { decryptToken } from "../_shared/fb-crypto.ts";
import { assertOwnership, resolveCaller } from "../_shared/caller-auth.ts";
import { buildCors } from "../_shared/cors.ts";
import {
  buildCapiEventKey,
  buildCapiEventPayload,
  buildHashedUserData,
  extractCapiError,
} from "../_shared/capi-event.ts";

interface CapiBody {
  consultant_id: string;
  event_name:
    | "Lead"
    | "Contact"
    | "SubmitApplication"
    | "Purchase"
    | "PageView"
    | "ViewContent"
    | "InitiateCheckout"
    | "CompleteRegistration";
  event_id?: string;
  customer_id?: string | null;
  // PII (será hasheado)
  email?: string | null;
  phone?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null; // ISO-2 (BR)
  external_id?: string | null;
  // Contexto
  value?: number | null;
  currency?: string;
  source_url?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  client_user_agent?: string | null;
  client_ip?: string | null;
  // Offline conversion (status virou cliente): se true, envia para /offline_conversions em vez de /events
  offline?: boolean;
  offline_event_set_id?: string | null;
}

Deno.serve(async (req) => {
  const corsHeaders = buildCors(req, "x-service-secret");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const body = await req.json() as CapiBody;
    if (!body?.consultant_id || !body?.event_name) {
      return new Response(
        JSON.stringify({ error: "consultant_id e event_name obrigatórios" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const admin = adminClient();

    // Guarda IDOR (REQ 5): resolve o chamador e verifica posse ANTES de qualquer
    // leitura/gravação ou outbound à Meta CAPI. Modo `service` (x-service-secret)
    // dispensa posse; JWT não-admin precisa ser dono do recurso-alvo.
    // Prefere customerId quando presente; senão usa consultantId (sempre presente aqui).
    const caller = await resolveCaller(req, admin);
    if (caller instanceof Response) return caller;
    const deny = await assertOwnership(
      caller,
      body.customer_id
        ? { customerId: body.customer_id }
        : { consultantId: body.consultant_id },
      admin,
    );
    if (deny) return deny;

    // Modelo centralizado: Pixel oficial da plataforma (igreen-oficial-remarketing).
    const GLOBAL_TOKEN = Deno.env.get("FACEBOOK_CAPI_ACCESS_TOKEN") ?? "";
    const envPixel = Deno.env.get("FACEBOOK_CAPI_PIXEL_ID") ?? "";
    const platform = await loadPlatformAccount();
    const GLOBAL_PIXEL = envPixel || platform?.pixel_id || "708759256921383";
    const platformToken = platform?.token || "";

    let token = "";
    let pixelId = "";
    let tokenSource: "oauth" | "global" | "platform" = "global";

    if (GLOBAL_TOKEN && GLOBAL_PIXEL) {
      token = GLOBAL_TOKEN;
      pixelId = GLOBAL_PIXEL;
      tokenSource = "global";
    } else if (platformToken && GLOBAL_PIXEL) {
      token = platformToken;
      pixelId = GLOBAL_PIXEL;
      tokenSource = "platform";
    } else {
      // Fallback raro: OAuth individual (caso o secret global não esteja configurado)
      const { data: conn } = await admin.from("facebook_connections").select(
        "pixel_id,access_token_encrypted",
      ).eq("consultant_id", body.consultant_id).maybeSingle();
      if (conn?.access_token_encrypted && conn?.pixel_id) {
        token = await decryptToken(conn.access_token_encrypted);
        pixelId = conn.pixel_id;
        tokenSource = "oauth";
      } else {
        return new Response(
          JSON.stringify({ skipped: true, reason: "no_global_capi_secret" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // `event_id` ESTÁVEL. Antes, sem `customer_id`, virava `crypto.randomUUID()`
    // e cada retry contava como conversão nova (relatório inflado).
    const eventId = body.event_id ||
      buildCapiEventKey({
        eventName: body.event_name,
        consultantId: body.consultant_id,
        customerId: body.customer_id ?? null,
      });

    const userData = await buildHashedUserData({
      email: body.email,
      phone: body.phone,
      firstName: body.first_name,
      lastName: body.last_name,
      city: body.city,
      state: body.state,
      zip: body.zip,
      country: body.country,
      externalId: body.external_id || body.customer_id || null,
      fbp: body.fbp,
      fbc: body.fbc,
      clientUserAgent: body.client_user_agent,
      clientIp: body.client_ip,
    });

    // Enfileira ANTES de falar com a Meta: se o envio inline falhar (ou a função
    // morrer), o despachante retenta com o MESMO event_id, sem duplicar.
    const { error: enqueueError } = await admin.rpc(
      "enqueue_facebook_capi_event",
      {
        _event_key: eventId,
        _consultant_id: body.consultant_id,
        _event_name: body.event_name,
        _customer_id: body.customer_id ?? null,
        _value: body.value ?? null,
        _currency: body.currency ?? "BRL",
        _hashed_user_data: userData,
        _context: {
          source: "http",
          offline: Boolean(body.offline),
          offline_event_set_id: body.offline_event_set_id ?? null,
          source_url: body.source_url ?? null,
        },
      },
    );
    if (enqueueError) {
      console.error("[fb-capi] enqueue falhou", enqueueError.message);
    }

    const event = buildCapiEventPayload({
      eventName: body.event_name,
      eventId,
      userData,
      offline: Boolean(body.offline),
      sourceUrl: body.source_url ?? null,
      value: body.value ?? null,
      currency: body.currency ?? null,
    });

    // Offline conversion vai pro Offline Event Set (precisa do ID); fallback pro pixel se não tiver set.
    const targetId = body.offline && body.offline_event_set_id
      ? body.offline_event_set_id
      : pixelId;

    const fbRes = await fbFetch(
      `${FB_GRAPH}/${targetId}/events?access_token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: [event] }),
      },
    ).catch((e) => ({ error: (e as Error).message }));

    // A Meta pode responder 200 com `error` no corpo. Antes isso virava
    // `ok:true` e a perda de conversão ficava invisível.
    const capiError = extractCapiError(fbRes);

    await admin.from("facebook_capi_events").insert({
      consultant_id: body.consultant_id,
      customer_id: body.customer_id ?? null,
      event_name: body.event_name,
      event_id: eventId,
      fb_response: {
        ...(fbRes as object),
        _token_source: tokenSource,
        _pixel_id: pixelId,
      },
      status: capiError ? "failed" : "sent",
    });

    if (capiError) {
      // Fica na fila para o despachante retentar com o mesmo event_id.
      return new Response(
        JSON.stringify({
          ok: false,
          error: capiError,
          event_id: eventId,
          queued_for_retry: true,
          token_source: tokenSource,
          pixel_id: pixelId,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Envio inline deu certo: baixa a linha da fila para o despachante não
    // reenviar (a Meta deduplicaria, mas gera ruído desnecessário).
    const { error: markError } = await admin.rpc(
      "mark_facebook_capi_sent_by_key",
      { _event_key: eventId, _response: fbRes as Record<string, unknown> },
    );
    if (markError) {
      console.warn("[fb-capi] baixa na fila falhou", markError.message);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        event_id: eventId,
        token_source: tokenSource,
        pixel_id: pixelId,
        fb: fbRes,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[fb-capi]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
