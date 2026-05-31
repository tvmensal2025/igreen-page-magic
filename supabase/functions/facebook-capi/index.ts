// Conversions API: envia eventos server-side ao Pixel ou como Offline Conversion.
// Pode ser chamado por outras edge functions (lead, contact) ou diretamente.
import { adminClient, fbFetch, FB_GRAPH, sha256Hex } from "../_shared/fb-graph.ts";
import { decryptToken } from "../_shared/fb-crypto.ts";
import { resolveCaller, assertOwnership } from "../_shared/caller-auth.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

interface CapiBody {
  consultant_id: string;
  event_name: "Lead" | "Contact" | "SubmitApplication" | "Purchase" | "PageView" | "ViewContent" | "InitiateCheckout" | "CompleteRegistration";
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

function norm(v: string) { return v.trim().toLowerCase(); }
function digitsOnly(v: string) { return v.replace(/\D/g, ""); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json() as CapiBody;
    if (!body?.consultant_id || !body?.event_name) {
      return new Response(JSON.stringify({ error: "consultant_id e event_name obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
      body.customer_id ? { customerId: body.customer_id } : { consultantId: body.consultant_id },
      admin,
    );
    if (deny) return deny;

    // Modelo centralizado: TODOS os consultores enviam para o Pixel global da plataforma (igreen-app-oficial).
    // Token + Pixel globais têm prioridade sobre OAuth individual.
    const GLOBAL_TOKEN = Deno.env.get("FACEBOOK_CAPI_ACCESS_TOKEN") ?? "";
    const GLOBAL_PIXEL = Deno.env.get("FACEBOOK_CAPI_PIXEL_ID") ?? "1521037349653769";

    let token = "";
    let pixelId = "";
    let tokenSource: "oauth" | "global" = "global";

    if (GLOBAL_TOKEN && GLOBAL_PIXEL) {
      token = GLOBAL_TOKEN;
      pixelId = GLOBAL_PIXEL;
      tokenSource = "global";
    } else {
      // Fallback raro: OAuth individual (caso o secret global não esteja configurado)
      const { data: conn } = await admin.from("facebook_connections").select("pixel_id,access_token_encrypted").eq("consultant_id", body.consultant_id).maybeSingle();
      if (conn?.access_token_encrypted && conn?.pixel_id) {
        token = await decryptToken(conn.access_token_encrypted);
        pixelId = conn.pixel_id;
        tokenSource = "oauth";
      } else {
        return new Response(JSON.stringify({ skipped: true, reason: "no_global_capi_secret" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }


    const eventId = body.event_id || (body.customer_id ? `${body.event_name}:${body.customer_id}` : crypto.randomUUID());

    const userData: Record<string, unknown> = {};
    if (body.email) userData.em = [await sha256Hex(norm(body.email))];
    if (body.phone) userData.ph = [await sha256Hex(digitsOnly(body.phone))];
    if (body.first_name) userData.fn = [await sha256Hex(norm(body.first_name))];
    if (body.last_name) userData.ln = [await sha256Hex(norm(body.last_name))];
    if (body.city) userData.ct = [await sha256Hex(norm(body.city).replace(/\s+/g, ""))];
    if (body.state) userData.st = [await sha256Hex(norm(body.state))];
    if (body.zip) userData.zp = [await sha256Hex(digitsOnly(body.zip))];
    if (body.country) userData.country = [await sha256Hex(norm(body.country))];
    if (body.external_id || body.customer_id) userData.external_id = [await sha256Hex(String(body.external_id || body.customer_id))];
    if (body.fbp) userData.fbp = body.fbp;
    if (body.fbc) userData.fbc = body.fbc;
    if (body.client_user_agent) userData.client_user_agent = body.client_user_agent;
    if (body.client_ip) userData.client_ip_address = body.client_ip;

    const event = {
      event_name: body.event_name,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: body.offline ? "physical_store" : "website",
      event_source_url: body.source_url || "https://igreen.institutodossonhos.com.br",
      user_data: userData,
      ...(body.value ? { custom_data: { value: body.value, currency: body.currency || "BRL" } } : {}),
    };

    // Offline conversion vai pro Offline Event Set (precisa do ID); fallback pro pixel se não tiver set.
    const targetId = body.offline && body.offline_event_set_id
      ? body.offline_event_set_id
      : pixelId;

    const fbRes = await fbFetch(`${FB_GRAPH}/${targetId}/events?access_token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [event] }),
    }).catch((e) => ({ error: (e as Error).message }));

    await admin.from("facebook_capi_events").insert({
      consultant_id: body.consultant_id,
      customer_id: body.customer_id ?? null,
      event_name: body.event_name,
      event_id: eventId,
      fb_response: { ...(fbRes as object), _token_source: tokenSource, _pixel_id: pixelId },
      status: (fbRes as any).error ? "failed" : "sent",
    });

    return new Response(JSON.stringify({ ok: true, event_id: eventId, token_source: tokenSource, pixel_id: pixelId, fb: fbRes }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[fb-capi]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
