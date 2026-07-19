/**
 * Sync pontual de 1 lead → Custom Audience Meta (Graph).
 * Usado pelo cadence-tick (RETARGET_*) e pelo job facebook-retarget-sync.
 * Preferência: facebook_connections do consultor; fallback: platform_facebook_account.
 * NÃO liga toggles — o caller decide se pode chamar.
 */

import { decryptToken } from "./fb-crypto.ts";
import { loadPlatformAccount } from "./fb-graph.ts";

const GRAPH = "https://graph.facebook.com/v20.0";

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normPhone(p: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  if (d.length < 10) return null;
  return d.startsWith("55") ? d : "55" + d;
}

function normEmail(e: string | null): string | null {
  if (!e) return null;
  const t = e.trim().toLowerCase();
  return t.includes("@") ? t : null;
}

function phoneDdd(ph: string | null): string | null {
  if (!ph) return null;
  const d = ph.replace(/\D/g, "");
  const local = d.startsWith("55") ? d.slice(2) : d;
  if (local.length < 10) return null;
  return local.slice(0, 2);
}

async function loadDddAllowlist(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<number[] | null> {
  const { data } = await supabase
    .from("platform_facebook_account")
    .select("retarget_ddd_allowlist")
    .eq("id", true)
    .maybeSingle();
  const raw = (data as any)?.retarget_ddd_allowlist;
  if (!Array.isArray(raw) || raw.length === 0) return null; // null = sem filtro
  return raw.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n >= 11 && n <= 99);
}

async function writeSyncLog(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  row: {
    audience_id?: string | null;
    customer_id?: string | null;
    consultant_id?: string | null;
    source: string;
    ok: boolean;
    detail?: string;
    phone_ddd?: string | null;
  },
) {
  try {
    await supabase.from("meta_audience_sync_log").insert({
      audience_id: row.audience_id || null,
      customer_id: row.customer_id || null,
      consultant_id: row.consultant_id || null,
      source: row.source,
      ok: row.ok,
      detail: (row.detail || "").slice(0, 300),
      phone_ddd: row.phone_ddd || null,
    });
  } catch (e) {
    console.warn("[meta-audience-sync] log falhou:", (e as Error).message);
  }
}

export type MetaSyncResult = {
  ok: boolean;
  detail: string;
  audience_id?: string;
  dryRun?: boolean;
};

type AudienceCreds = {
  custom_audience_id: string;
  token: string;
  source: "consultant" | "platform";
  consultant_id?: string;
};

async function resolveAudienceCreds(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  consultantId: string,
): Promise<AudienceCreds | null> {
  const { data: conn } = await supabase
    .from("facebook_connections")
    .select("consultant_id, access_token_encrypted, custom_audience_id")
    .eq("consultant_id", consultantId)
    .eq("status", "active")
    .not("custom_audience_id", "is", null)
    .maybeSingle();

  if (conn?.custom_audience_id && conn.access_token_encrypted) {
    return {
      custom_audience_id: conn.custom_audience_id,
      token: await decryptToken(conn.access_token_encrypted),
      source: "consultant",
      consultant_id: consultantId,
    };
  }

  const platform = await loadPlatformAccount();
  if (platform?.token) {
    const { data: pf } = await supabase
      .from("platform_facebook_account")
      .select("custom_audience_id")
      .eq("id", true)
      .maybeSingle();
    if (pf?.custom_audience_id) {
      return {
        custom_audience_id: pf.custom_audience_id,
        token: platform.token,
        source: "platform",
      };
    }
  }

  return null;
}

/**
 * Sobe telefone/email (SHA256) do customer para a Custom Audience
 * (consultor ou plataforma).
 * Respeita do_not_contact. dryRun=true não chama Graph.
 */
export async function syncCustomerToMetaAudience(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  opts: {
    customerId: string;
    consultantId: string | null;
    dryRun?: boolean;
    stage?: string;
  },
): Promise<MetaSyncResult> {
  const { customerId, dryRun = false, stage } = opts;
  let consultantId = opts.consultantId;

  const { data: cust } = await supabase
    .from("customers")
    .select("id, consultant_id, phone_whatsapp, email, do_not_contact")
    .eq("id", customerId)
    .maybeSingle();

  if (!cust) return { ok: false, detail: "customer_not_found" };
  if (cust.do_not_contact) return { ok: false, detail: "do_not_contact" };
  consultantId = consultantId || cust.consultant_id;
  if (!consultantId) return { ok: false, detail: "no_consultant" };

  const { data: flag } = await supabase
    .from("app_settings")
    .select("retarget_enabled")
    .limit(1)
    .maybeSingle();
  if (flag && flag.retarget_enabled === false) {
    return { ok: false, detail: "retarget_disabled_app_settings" };
  }

  const creds = await resolveAudienceCreds(supabase, consultantId);
  if (!creds) {
    await writeSyncLog(supabase, {
      customer_id: customerId,
      consultant_id: consultantId,
      source: stage || "sync",
      ok: false,
      detail: "no_active_custom_audience",
    });
    return { ok: false, detail: "no_active_custom_audience" };
  }

  const ph = normPhone(cust.phone_whatsapp ?? null);
  const em = normEmail(cust.email ?? null);
  const ddd = phoneDdd(ph);
  const allowlist = await loadDddAllowlist(supabase);
  if (allowlist && allowlist.length > 0) {
    const dddNum = ddd ? Number(ddd) : NaN;
    if (!Number.isFinite(dddNum) || !allowlist.includes(dddNum)) {
      await writeSyncLog(supabase, {
        audience_id: creds.custom_audience_id,
        customer_id: customerId,
        consultant_id: consultantId,
        source: stage || "sync",
        ok: false,
        detail: `ddd_filtered:${ddd || "none"}`,
        phone_ddd: ddd,
      });
      return { ok: false, detail: `ddd_filtered:${ddd || "none"}` };
    }
  }

  const phH = ph ? await sha256Hex(ph) : "";
  const emH = em ? await sha256Hex(em) : "";
  if (!phH && !emH) {
    await writeSyncLog(supabase, {
      audience_id: creds.custom_audience_id,
      customer_id: customerId,
      consultant_id: consultantId,
      source: stage || "sync",
      ok: false,
      detail: "no_phone_or_email",
      phone_ddd: ddd,
    });
    return { ok: false, detail: "no_phone_or_email" };
  }

  if (dryRun) {
    return {
      ok: true,
      detail: `dry_run_ok:${creds.source}`,
      audience_id: creds.custom_audience_id,
      dryRun: true,
    };
  }

  try {
    const payload = { schema: ["PHONE", "EMAIL"], data: [[phH, emH]] };
    const url = `${GRAPH}/${creds.custom_audience_id}/users?access_token=${encodeURIComponent(creds.token)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload }),
    });
    const body = await resp.json();
    if (!resp.ok) {
      const detail = `graph_error:${JSON.stringify(body).slice(0, 180)}`;
      await writeSyncLog(supabase, {
        audience_id: creds.custom_audience_id,
        customer_id: customerId,
        consultant_id: consultantId,
        source: stage || "sync",
        ok: false,
        detail,
        phone_ddd: ddd,
      });
      return {
        ok: false,
        detail,
        audience_id: creds.custom_audience_id,
      };
    }

    if (creds.source === "consultant" && creds.consultant_id) {
      await supabase.from("facebook_connections").update({
        audience_synced_at: new Date().toISOString(),
      }).eq("consultant_id", creds.consultant_id);
    } else {
      await supabase.from("platform_facebook_account").update({
        audience_synced_at: new Date().toISOString(),
      }).eq("id", true);
    }

    // Só promove CLOSE_LOST → RETARGET_META (não regride ADS_15D / recalls).
    if (stage === "CLOSE_LOST") {
      const retargetMetaDue = new Date(Date.now() + 24 * 3600_000).toISOString();
      await supabase.from("lead_cadence_state").update({
        stage: "RETARGET_META",
        next_action_at: retargetMetaDue,
      })
        .eq("customer_id", customerId)
        .eq("stage", "CLOSE_LOST");
    }

    await writeSyncLog(supabase, {
      audience_id: creds.custom_audience_id,
      customer_id: customerId,
      consultant_id: consultantId,
      source: stage || "sync",
      ok: true,
      detail: `synced:${creds.source}`,
      phone_ddd: ddd,
    });

    return {
      ok: true,
      detail: `synced:${creds.source}:${creds.custom_audience_id}`,
      audience_id: creds.custom_audience_id,
    };
  } catch (e) {
    const detail = `exception:${(e as Error).message}`.slice(0, 200);
    await writeSyncLog(supabase, {
      audience_id: creds.custom_audience_id,
      customer_id: customerId,
      consultant_id: consultantId,
      source: stage || "sync",
      ok: false,
      detail,
      phone_ddd: ddd,
    });
    return { ok: false, detail };
  }
}
