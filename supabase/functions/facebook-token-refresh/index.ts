// Renova tokens expirando em <7 dias. Roda diariamente via cron.
import { adminClient } from "../_shared/fb-graph.ts";
import {
  assertCronAuthStrict,
  cronAuthUnauthorized,
} from "../_shared/cron-auth.ts";
import { buildCors } from "../_shared/cors.ts";
import { decryptToken, encryptToken } from "../_shared/fb-crypto.ts";

const FB_GRAPH = "https://graph.facebook.com/v21.0";

Deno.serve(async (req) => {
  const corsHeaders = buildCors(req, "x-service-secret, x-internal-secret");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const admin = adminClient();
  const auth = await assertCronAuthStrict(req, admin);
  if (!auth.ok) return cronAuthUnauthorized(auth.reason, corsHeaders);
  const cutoff = new Date(Date.now() + 7 * 86400_000).toISOString();
  const { data } = await admin.from("facebook_connections").select(
    "id,consultant_id,access_token_encrypted",
  ).lt("token_expires_at", cutoff).eq("status", "active");
  let refreshed = 0;
  for (const c of data || []) {
    try {
      const token = await decryptToken(c.access_token_encrypted);
      const url = `${FB_GRAPH}/oauth/access_token?` + new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: Deno.env.get("FACEBOOK_APP_ID")!,
        client_secret: Deno.env.get("FACEBOOK_APP_SECRET")!,
        fb_exchange_token: token,
      });
      const r = await fetch(url);
      const j = await r.json();
      if (j.access_token) {
        const newExpires = new Date(
          Date.now() + (j.expires_in || 60 * 86400) * 1000,
        ).toISOString();
        await admin.from("facebook_connections").update({
          access_token_encrypted: await encryptToken(j.access_token),
          token_expires_at: newExpires,
        }).eq("id", c.id);
        refreshed++;
      } else {
        await admin.from("facebook_connections").update({ status: "expired" })
          .eq("id", c.id);
      }
    } catch (e) {
      console.error("[fb-refresh]", c.id, (e as Error).message);
    }
  }

  // Plataforma (conta-mãe) — se cair, TODAS as campanhas param.
  let platformRefreshed = false;
  try {
    const { data: pf } = await admin
      .from("platform_facebook_account")
      .select("access_token_encrypted, token_expires_at, status")
      .eq("id", true)
      .maybeSingle();
    if (pf?.access_token_encrypted) {
      const expSoon = !pf.token_expires_at ||
        new Date(pf.token_expires_at) < new Date(Date.now() + 7 * 86400_000);
      if (expSoon) {
        const tokenP = await decryptToken(pf.access_token_encrypted);
        const urlP = `${FB_GRAPH}/oauth/access_token?` + new URLSearchParams({
          grant_type: "fb_exchange_token",
          client_id: Deno.env.get("FACEBOOK_APP_ID")!,
          client_secret: Deno.env.get("FACEBOOK_APP_SECRET")!,
          fb_exchange_token: tokenP,
        });
        const rP = await fetch(urlP);
        const jP = await rP.json();
        if (jP.access_token) {
          await admin.from("platform_facebook_account").update({
            access_token_encrypted: await encryptToken(jP.access_token),
            token_expires_at: new Date(
              Date.now() + (jP.expires_in || 60 * 86400) * 1000,
            ).toISOString(),
            status: "active",
          }).eq("id", true);
          platformRefreshed = true;
        } else {
          await admin.from("platform_facebook_account").update({
            status: "expired",
          }).eq("id", true);
          console.error(
            "[fb-refresh platform] expirou e não renovou:",
            JSON.stringify(jP),
          );
        }
      }
    }
  } catch (e) {
    console.error("[fb-refresh platform]", (e as Error).message);
  }

  return new Response(
    JSON.stringify({ refreshed, platform_refreshed: platformRefreshed }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
