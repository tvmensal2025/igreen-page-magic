// Protocolo de rastreio: LIMPEZA, não injeção.
//
// O que esta função fazia antes (e não faz mais):
//   * appendava "📋 Protocolo: *2026-####*" na `initial_message` e no `?text=`
//     do wa.me — o lead via um código interno na primeira mensagem;
//   * para "consertar" campanhas já no ar, CRIAVA adcreative + ad novos e
//     pausava os antigos. Isso é criação de objeto na Meta (human-only na
//     policy), custa aprendizado do anúncio e mexe em campanha ativa.
//
// O que faz agora:
//   * garante que a campanha TEM um `tracking_protocol` no banco (o protocolo
//     é legítimo lá — é a chave de relatório/admin);
//   * REMOVE o protocolo da `initial_message` armazenada;
//   * apenas RELATA quais anúncios ainda carregam o protocolo no link, para
//     decisão humana. Não recria nem pausa nada.
//
// Atribuição preservada: a ordem forte continua AD ID → `fb_campaign_id` →
// `ctwa_clid` → UUID, e o fallback por frase exata já aplica
// `stripTrackingProtocol` nos DOIS lados (`resolveCampaignByExactInitialMessage`),
// então limpar o banco não quebra o casamento da frase.
import {
  adminClient,
  authConsultant,
  fbRead,
  loadPlatformAccount,
} from "../_shared/fb-graph.ts";
import { buildCors } from "../_shared/cors.ts";
import {
  ensureCampaignTrackingProtocol,
  normalizeTrackingProtocol,
  stripTrackingProtocol,
  TRACKING_PROTOCOL_LEGACY_RE,
  TRACKING_PROTOCOL_V2_RE,
} from "../_shared/campaign-tracking.ts";

type CampaignRow = {
  id: string;
  consultant_id: string;
  fb_campaign_id: string | null;
  fb_ad_ids: string[] | null;
  name: string;
  status: string;
  initial_message: string | null;
  tracking_protocol: string | null;
  tracking_protocol_channel: string | null;
};

async function isAdminUser(
  admin: ReturnType<typeof adminClient>,
  userId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

/** Procura protocolo em qualquer link wa.me/api.whatsapp dentro do criativo. */
function findProtocolInCreative(value: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      Object.values(node as Record<string, unknown>).forEach(walk);
      return;
    }
    if (typeof node !== "string") return;
    const v2 = node.match(TRACKING_PROTOCOL_V2_RE);
    if (v2) found.push(v2[0]);
    const legacy = node.match(TRACKING_PROTOCOL_LEGACY_RE);
    if (legacy) found.push(legacy[0]);
  };
  walk(value);
  return Array.from(new Set(found));
}

Deno.serve(async (req) => {
  const corsHeaders = buildCors(req, "x-service-secret");
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = adminClient();
  const serviceSecret = Deno.env.get("SERVICE_SHARED_SECRET") || "";
  const isService = !!serviceSecret &&
    req.headers.get("x-service-secret") === serviceSecret;
  if (!isService) {
    const auth = await authConsultant(req);
    if (!auth) return json({ error: "Unauthorized" }, 401);
    const isAdmin = await isAdminUser(admin, auth.id);
    if (!isAdmin) return json({ error: "Sem permissão." }, 403);
  }

  const body = await req.json().catch(() => ({})) as {
    consultant_id?: string;
    campaign_ids?: string[];
    dry_run?: boolean;
  };
  const dryRun = body.dry_run === true;

  let query = admin
    .from("facebook_campaigns")
    .select(
      "id, consultant_id, fb_campaign_id, fb_ad_ids, name, status, initial_message, tracking_protocol, tracking_protocol_channel",
    )
    .in("status", ["active", "pending_review"])
    .not("fb_campaign_id", "is", null)
    .limit(50);
  if (body.consultant_id) query = query.eq("consultant_id", body.consultant_id);
  if (Array.isArray(body.campaign_ids) && body.campaign_ids.length) {
    query = query.in("id", body.campaign_ids);
  }

  const { data: campaigns, error } = await query;
  if (error) return json({ error: error.message }, 500);

  // Inspeção do criativo é só leitura e depende do token da plataforma. Sem
  // token seguimos com a limpeza do banco e reportamos a inspeção como
  // indisponível — não é motivo para abortar.
  const platform = await loadPlatformAccount();

  const results: Array<Record<string, unknown>> = [];
  for (const c of ((campaigns || []) as CampaignRow[])) {
    const channel = c.tracking_protocol_channel || "FB";
    const protocol = normalizeTrackingProtocol(c.tracking_protocol) ||
      (dryRun ? null : await ensureCampaignTrackingProtocol(admin, channel));

    const currentMessage = c.initial_message || "";
    const cleanedMessage = stripTrackingProtocol(currentMessage);
    const messageHadProtocol = cleanedMessage !== currentMessage.trim();

    // Anúncios que ainda mandam o protocolo no link — só diagnóstico.
    const adsWithProtocol: Array<{ ad_id: string; protocols: string[] }> = [];
    if (platform?.token) {
      for (const adId of (c.fb_ad_ids || []).filter(Boolean)) {
        try {
          const ad = await fbRead(
            `/${adId}?fields=id,creative{object_story_spec,asset_feed_spec}&access_token=${
              encodeURIComponent(platform.token)
            }`,
          );
          const protocols = findProtocolInCreative(ad?.creative ?? {});
          if (protocols.length) {
            adsWithProtocol.push({ ad_id: adId, protocols });
          }
        } catch (e) {
          adsWithProtocol.push({
            ad_id: adId,
            protocols: [`erro_inspecao: ${(e as Error).message}`],
          });
        }
      }
    }

    if (!dryRun) {
      const patch: Record<string, unknown> = {
        tracking_protocol: protocol,
        tracking_protocol_channel: channel,
        updated_at: new Date().toISOString(),
      };
      // Só grava a mensagem quando havia protocolo para remover.
      if (messageHadProtocol) patch.initial_message = cleanedMessage;
      await admin.from("facebook_campaigns").update(patch).eq("id", c.id);
    }

    results.push({
      campaign_id: c.id,
      campaign_name: c.name,
      protocol,
      message_cleaned: messageHadProtocol,
      initial_message: cleanedMessage,
      // Requer republicação MANUAL do criativo se o consultor quiser tirar o
      // protocolo do link. Esta função não recria anúncio.
      ads_still_carrying_protocol: adsWithProtocol,
      creative_inspection: platform?.token ? "ok" : "sem_token_plataforma",
      dry_run: dryRun,
    });
  }

  return json({
    ok: true,
    mode: "strip_only",
    note:
      "Protocolo permanece apenas no banco. Anúncios com protocolo no link exigem republicação manual.",
    processed: results.length,
    results,
  });
});
