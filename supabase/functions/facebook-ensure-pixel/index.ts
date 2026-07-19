// Cria/garante o pixel "igreen-oficial-remarketing" na ad account da plataforma,
// grava em platform_facebook_account e tenta vincular à Página.
// Auth: Super Admin OU service_role.
import { adminClient, authConsultant, corsHeaders, FB_GRAPH, loadPlatformAccount } from "../_shared/fb-graph.ts";
import { isServiceRoleAuth } from "../_shared/service-role-auth.ts";

const PIXEL_NAME = "igreen-oficial-remarketing";

function actId(raw: string): string {
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

async function graph(
  path: string,
  token: string,
  init?: RequestInit & { form?: Record<string, string> },
): Promise<{ ok: boolean; status: number; body: any }> {
  const url = path.startsWith("http") ? path : `${FB_GRAPH}${path.startsWith("/") ? path : `/${path}`}`;
  let body: BodyInit | undefined = init?.body;
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> || {}) };
  if (init?.form) {
    const sp = new URLSearchParams({ ...init.form, access_token: token });
    body = sp;
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  const sep = url.includes("?") ? "&" : "?";
  const finalUrl = init?.form ? url : `${url}${sep}access_token=${encodeURIComponent(token)}`;
  const r = await fetch(finalUrl, { ...init, headers, body: init?.form ? body : init?.body });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: json };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = adminClient();
    const isCron = isServiceRoleAuth(req);
    if (!isCron) {
      const auth = await authConsultant(req);
      if (!auth) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: isAdmin } = await admin
        .from("user_roles").select("role")
        .eq("user_id", auth.id).in("role", ["admin", "super_admin"]).maybeSingle();
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Apenas super admin pode gerenciar o pixel global" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const platform = await loadPlatformAccount();
    if (!platform?.ad_account_id || !platform.page_id) {
      return new Response(JSON.stringify({ error: "Conta Facebook da plataforma não configurada (ad account + página)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const acc = actId(platform.ad_account_id);
    const pageId = String(platform.page_id);
    const token = platform.token;
    const steps: string[] = [];

    // 1) Lista pixels da conta
    const list = await graph(`/${acc}/adspixels?fields=id,name&limit=50`, token);
    if (!list.ok) {
      return new Response(JSON.stringify({
        error: `Falha ao listar pixels: ${list.body?.error?.message || list.status}`,
      }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const pixels: { id: string; name: string }[] = list.body?.data || [];
    steps.push(`listed:${pixels.length}`);

    let existing = pixels.find((p) => (p.name || "").trim().toLowerCase() === PIXEL_NAME.toLowerCase());
    let created = false;

    // 2) Cria se não existir
    if (!existing) {
      const create = await graph(`/${acc}/adspixels`, token, {
        method: "POST",
        form: { name: PIXEL_NAME },
      });
      if (create.ok && create.body?.id) {
        existing = { id: String(create.body.id), name: PIXEL_NAME };
        created = true;
        steps.push(`created:${existing.id}`);
      } else {
        // Conta pode já ter 1 pixel (6200/6202) — usa o existente e renomeia se possível
        const errMsg = create.body?.error?.message || String(create.status);
        steps.push(`create_fail:${errMsg}`);
        if (pixels.length === 1) {
          existing = pixels[0];
          steps.push(`reuse_single:${existing.id}`);
          // Tenta renomear
          const rename = await graph(`/${existing.id}`, token, {
            method: "POST",
            form: { name: PIXEL_NAME },
          });
          steps.push(rename.ok ? "renamed_ok" : `rename_fail:${rename.body?.error?.message || rename.status}`);
          if (rename.ok) existing = { id: existing.id, name: PIXEL_NAME };
        } else if (pixels.length > 0) {
          // Prefere pixel cujo nome contenha igreen
          existing = pixels.find((p) => /igreen/i.test(p.name || "")) || pixels[0];
          steps.push(`reuse_existing:${existing.id}:${existing.name}`);
        } else {
          return new Response(JSON.stringify({
            error: `Não foi possível criar o pixel ${PIXEL_NAME}: ${errMsg}`,
            steps,
          }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    } else {
      steps.push(`already_exists:${existing.id}`);
    }

    const pixelId = existing!.id;

    // 3) Vincula à Página (tenta edges conhecidos; Meta muda nomes com frequência)
    const pageLinkAttempts: Array<{ label: string; run: () => Promise<{ ok: boolean; detail: string }> }> = [
      {
        label: "pixel_connected_page_ids",
        run: async () => {
          const r = await graph(`/${pixelId}`, token, {
            method: "POST",
            form: { page_id: pageId },
          });
          return { ok: r.ok, detail: r.body?.error?.message || JSON.stringify(r.body).slice(0, 120) };
        },
      },
      {
        label: "page_assigned_pixels",
        run: async () => {
          const r = await graph(`/${pageId}/assigned_pixels`, token, {
            method: "POST",
            form: { pixel_id: pixelId },
          });
          return { ok: r.ok, detail: r.body?.error?.message || JSON.stringify(r.body).slice(0, 120) };
        },
      },
      {
        label: "pixel_shared_pages",
        run: async () => {
          const r = await graph(`/${pixelId}/shared_pages`, token, {
            method: "POST",
            form: { page_id: pageId },
          });
          return { ok: r.ok, detail: r.body?.error?.message || JSON.stringify(r.body).slice(0, 120) };
        },
      },
      {
        label: "business_client_pages_pixel",
        run: async () => {
          // Marca página como objeto conectado do dataset (quando suportado)
          const r = await graph(`/${pixelId}/connected_objects`, token, {
            method: "POST",
            form: { connection_object_id: pageId },
          });
          return { ok: r.ok, detail: r.body?.error?.message || JSON.stringify(r.body).slice(0, 120) };
        },
      },
    ];

    let pageLinked = false;
    let pageLinkDetail = "";
    for (const attempt of pageLinkAttempts) {
      const r = await attempt.run();
      steps.push(`${attempt.label}:${r.ok ? "ok" : r.detail}`);
      if (r.ok) {
        pageLinked = true;
        pageLinkDetail = attempt.label;
        break;
      }
      pageLinkDetail = r.detail;
    }

    // 4) Persiste como pixel oficial da plataforma
    await admin.from("platform_facebook_account").update({
      pixel_id: pixelId,
      pixel_name: PIXEL_NAME,
      updated_at: new Date().toISOString(),
    }).eq("id", true);

    // 5) Confirma que aparece na ad account
    const relist = await graph(`/${acc}/adspixels?fields=id,name&limit=50`, token);
    const onAccount = ((relist.body?.data || []) as Array<{ id: string }>).some((p) => p.id === pixelId);

    return new Response(JSON.stringify({
      ok: true,
      created,
      pixel_id: pixelId,
      pixel_name: PIXEL_NAME,
      ad_account_id: acc,
      page_id: pageId,
      on_ad_account: onAccount,
      page_linked: pageLinked,
      page_link_via: pageLinked ? pageLinkDetail : null,
      page_link_note: pageLinked
        ? "Pixel associado à Página."
        : `Pixel criado/salvo na ad account. Associação Página↔Pixel via API: ${pageLinkDetail || "não suportada neste token"}. No Ads Manager o pixel já pode ser usado nos anúncios da Página.`,
      message: created
        ? `Pixel ${PIXEL_NAME} criado (${pixelId}) e definido como oficial.`
        : `Pixel ${PIXEL_NAME} pronto (${pixelId}) e definido como oficial.`,
      steps,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[fb-ensure-pixel]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
