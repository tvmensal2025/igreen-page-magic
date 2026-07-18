/**
 * Sync pontual de 1 lead → Custom Audience Meta (Graph).
 * Usado pelo cadence-tick (RETARGET_*) e pelo job facebook-retarget-sync.
 * NÃO liga toggles — o caller decide se pode chamar.
 */

import { decryptToken } from "./fb-crypto.ts";

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

export type MetaSyncResult = {
  ok: boolean;
  detail: string;
  audience_id?: string;
  dryRun?: boolean;
};

/**
 * Sobe telefone/email (SHA256) do customer para a Custom Audience do consultor.
 * Respeita do_not_contact. dryRun=true não chama Graph.
 */
export async function syncCustomerToMetaAudience(
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

  const { data: conn } = await supabase
    .from("facebook_connections")
    .select("consultant_id, access_token_encrypted, custom_audience_id")
    .eq("consultant_id", consultantId)
    .eq("status", "active")
    .not("custom_audience_id", "is", null)
    .maybeSingle();

  if (!conn?.custom_audience_id || !conn.access_token_encrypted) {
    return { ok: false, detail: "no_active_custom_audience" };
  }

  const ph = normPhone(cust.phone_whatsapp ?? null);
  const em = normEmail(cust.email ?? null);
  const phH = ph ? await sha256Hex(ph) : "";
  const emH = em ? await sha256Hex(em) : "";
  if (!phH && !emH) return { ok: false, detail: "no_phone_or_email" };

  if (dryRun) {
    return {
      ok: true,
      detail: "dry_run_ok",
      audience_id: conn.custom_audience_id,
      dryRun: true,
    };
  }

  try {
    const token = await decryptToken(conn.access_token_encrypted);
    const payload = { schema: ["PHONE", "EMAIL"], data: [[phH, emH]] };
    const url = `${GRAPH}/${conn.custom_audience_id}/users?access_token=${encodeURIComponent(token)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload }),
    });
    const body = await resp.json();
    if (!resp.ok) {
      return {
        ok: false,
        detail: `graph_error:${JSON.stringify(body).slice(0, 180)}`,
        audience_id: conn.custom_audience_id,
      };
    }

    await supabase.from("facebook_connections").update({
      audience_synced_at: new Date().toISOString(),
    }).eq("consultant_id", consultantId);

    // Só promove CLOSE_LOST → RETARGET_META (não regride ADS_15D / recalls).
    // Agenda +24h (delay de RETARGET_META) para o tick não pular a espera.
    if (stage === "CLOSE_LOST") {
      const retargetMetaDue = new Date(Date.now() + 24 * 3600_000).toISOString();
      await supabase.from("lead_cadence_state").update({
        stage: "RETARGET_META",
        next_action_at: retargetMetaDue,
      })
        .eq("customer_id", customerId)
        .eq("stage", "CLOSE_LOST");
    }

    return {
      ok: true,
      detail: `synced:${conn.custom_audience_id}`,
      audience_id: conn.custom_audience_id,
    };
  } catch (e) {
    return { ok: false, detail: `exception:${(e as Error).message}`.slice(0, 200) };
  }
}
