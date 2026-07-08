import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, authConsultant, FB_GRAPH, loadPlatformAccount } from "../_shared/fb-graph.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function graph(path: string, token: string) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${FB_GRAPH}${path}${sep}access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

function cleanPageId(v: unknown): string | null {
  const d = String(v || "").replace(/\D/g, "");
  return d.length >= 6 ? d : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!["GET", "POST"].includes(req.method)) return json({ error: "Method not allowed" }, 405);

  try {
    const auth = await authConsultant(req);
    if (!auth) return json({ error: "Unauthorized" }, 401);

    const admin = adminClient();
    const { data: isAdmin } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.id)
      .in("role", ["admin", "super_admin"])
      .maybeSingle();
    if (!isAdmin) return json({ error: "Apenas admin pode diagnosticar Página/WABA" }, 403);

    const platform = await loadPlatformAccount();
    if (!platform) return json({ error: "Conta Facebook da plataforma não configurada" }, 400);

    let requestedPageId: string | null = null;
    if (req.method === "GET") {
      requestedPageId = cleanPageId(new URL(req.url).searchParams.get("page_id"));
    } else {
      const body = await req.json().catch(() => ({}));
      requestedPageId = cleanPageId((body as any)?.page_id);
    }
    const pageId = requestedPageId || platform.page_id;
    if (!pageId) return json({ error: "page_id ausente" }, 400);

    const tk = platform.token;
    const page_fields = [
      "id,name,category",
      "whatsapp_business_account",
      "connected_whatsapp_business_account",
      "page_backed_whatsapp_business_account",
    ];

    const page_checks: Record<string, unknown> = {};
    for (const fields of page_fields) {
      page_checks[fields] = await graph(`/${pageId}?fields=${encodeURIComponent(fields)}`, tk);
    }

    const debug_token = await graph(`/debug_token?input_token=${encodeURIComponent(tk)}`, tk);
    const businesses = await graph(`/me/businesses?fields=id,name`, tk);

    const business_wabas: unknown[] = [];
    for (const biz of ((businesses.body as any)?.data || [])) {
      const owned = await graph(`/${biz.id}/owned_whatsapp_business_accounts?fields=id,name`, tk);
      const client = await graph(`/${biz.id}/client_whatsapp_business_accounts?fields=id,name`, tk);
      const pages = await graph(`/${biz.id}/owned_pages?fields=id,name&limit=200`, tk);
      business_wabas.push({ business: biz, owned, client, owned_pages: pages });
    }

    return json({
      ok: true,
      page_id: pageId,
      platform: {
        page_id: platform.page_id,
        ad_account_id: platform.ad_account_id,
        ig_account_id: platform.ig_account_id,
        business_id: platform.business_id,
        token_expires_at: platform.token_expires_at,
      },
      page_checks,
      debug_token,
      businesses,
      business_wabas,
      diagnosis_hint: "Se page_checks não retornar WABA e business_wabas não listar o número, vincule a WABA à Página ou reconecte a conta plataforma com permissões business_management/whatsapp_business_management.",
    });
  } catch (e) {
    console.error("[facebook-diagnose-page] exception", e);
    return json({ error: (e as Error).message || "unexpected" }, 500);
  }
});