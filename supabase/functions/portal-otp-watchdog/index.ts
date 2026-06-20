// portal-otp-watchdog: cron que garante que cadastros, OTPs e link facial
// sempre cheguem ao Portal 2. Executa 1x/min via pg_cron.
//
// Buckets:
//   A) cadastro_portal/portal_submitting/worker_offline/missing_documents
//      sem portal2_idcliente há >90s  → dispatchPortalWorker
//   B) otp_code presente, portal2_idcliente presente, sem portal2_otp_validated_at
//      e otp_received_at < now-30s     → reenvia /confirm-otp com payload correto
//   C) portal2_otp_validated_at presente mas link_facial nulo há >60s
//                                       → puxa contrato do worker e reenvia link
//
// Limite: 20 leads por bucket por execução; portal_retry_count gera backoff
// (max 10 tentativas → alerta no super-admin-alerts e para de retentar).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchPortalWorker, resolveWorker } from "../_shared/portal-worker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_RETRIES = 10;
const BATCH_LIMIT = 20;

function backoffOk(retryCount: number, lastAt: string | null): boolean {
  if (!lastAt) return true;
  const lastMs = new Date(lastAt).getTime();
  if (!Number.isFinite(lastMs)) return true;
  // exponencial: 30s, 60s, 120s, 240s, ... cap 10min
  const waitMs = Math.min(30_000 * Math.pow(2, Math.max(0, retryCount - 1)), 600_000);
  return Date.now() - lastMs >= waitMs;
}

async function resolveIds(supabase: any, customerId: string): Promise<{
  idconsultor: number | null;
  idcliente: number | null;
}> {
  const { data: c } = await supabase
    .from("customers")
    .select(`
      portal2_idcliente,
      consultants:consultant_id(igreen_id),
      referral_partners:referral_partner_id(partner_igreen_id)
    `)
    .eq("id", customerId)
    .maybeSingle();
  const dono = c?.consultants?.igreen_id ? Number(c.consultants.igreen_id) : null;
  const partner = c?.referral_partners?.partner_igreen_id
    ? Number(c.referral_partners.partner_igreen_id) : null;
  const idconsultor = Number.isFinite(partner as number) && (partner as number) > 0
    ? (partner as number) : dono;
  const idcliente = c?.portal2_idcliente ? Number(c.portal2_idcliente) : null;
  return { idconsultor, idcliente };
}

async function bucketA(supabase: any) {
  // Cadastro não chegou ao portal
  const cutoff = new Date(Date.now() - 90_000).toISOString();
  const { data: rows } = await supabase
    .from("customers")
    .select("id, status, portal_retry_count, last_portal_dispatch_at")
    .is("portal2_idcliente", null)
    .in("status", ["cadastro_portal", "portal_submitting", "worker_offline", "missing_documents"])
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(BATCH_LIMIT);

  let dispatched = 0;
  for (const r of rows ?? []) {
    const retries = Number(r.portal_retry_count || 0);
    if (retries >= MAX_RETRIES) continue;
    if (!backoffOk(retries, r.last_portal_dispatch_at)) continue;
    try {
      await supabase.from("customers").update({
        last_portal_dispatch_at: new Date().toISOString(),
        portal_retry_count: retries + 1,
      }).eq("id", r.id);
      const res = await dispatchPortalWorker(supabase, r.id);
      if (res.ok) {
        await supabase.from("customers").update({
          last_portal_dispatch_error: null,
        }).eq("id", r.id);
      } else {
        await supabase.from("customers").update({
          last_portal_dispatch_error: (res.error || res.mode).slice(0, 200),
        }).eq("id", r.id);
      }
      dispatched++;
    } catch (e: any) {
      console.warn(`[watchdog A] customer=${r.id} erro: ${e?.message || e}`);
    }
  }
  return { scanned: rows?.length ?? 0, dispatched };
}

async function bucketB(supabase: any) {
  // OTP pendente
  const cutoff = new Date(Date.now() - 30_000).toISOString();
  const { data: rows } = await supabase
    .from("customers")
    .select("id, otp_code, portal_retry_count, last_otp_dispatch_at")
    .not("otp_code", "is", null)
    .not("portal2_idcliente", "is", null)
    .is("portal2_otp_validated_at", null)
    .lt("otp_received_at", cutoff)
    .order("otp_received_at", { ascending: true })
    .limit(BATCH_LIMIT);

  let sent = 0;
  for (const r of rows ?? []) {
    const retries = Number(r.portal_retry_count || 0);
    if (retries >= MAX_RETRIES) continue;
    if (!backoffOk(retries, r.last_otp_dispatch_at)) continue;
    const { idconsultor, idcliente } = await resolveIds(supabase, r.id);
    if (!idconsultor || !idcliente) {
      await supabase.from("customers").update({
        last_otp_dispatch_at: new Date().toISOString(),
        last_otp_dispatch_error: !idcliente ? "missing_portal2_idcliente" : "missing_idconsultor",
      }).eq("id", r.id);
      continue;
    }
    const resolved = await resolveWorker(supabase, r.id).catch(() => null);
    if (!resolved) continue;
    try {
      const res = await fetch(`${resolved.url}/confirm-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${resolved.secret}`,
        },
        body: JSON.stringify({ idconsultor, idcliente, code: r.otp_code, customer_id: r.id }),
        signal: AbortSignal.timeout(45_000),
      });
      const txt = await res.text().catch(() => "");
      console.log(`[watchdog B] customer=${r.id} confirm-otp=${res.status} body=${txt.slice(0, 200)}`);
      if (res.ok) {
        await supabase.from("customers").update({
          status: "validating_otp",
          conversation_step: "aguardando_facial",
          last_otp_dispatch_at: new Date().toISOString(),
          last_otp_dispatch_error: null,
          portal_retry_count: 0,
        }).eq("id", r.id);
        sent++;
      } else {
        await supabase.from("customers").update({
          last_otp_dispatch_at: new Date().toISOString(),
          last_otp_dispatch_error: `HTTP ${res.status}: ${txt.slice(0, 200)}`,
          portal_retry_count: retries + 1,
        }).eq("id", r.id);
      }
    } catch (e: any) {
      await supabase.from("customers").update({
        last_otp_dispatch_at: new Date().toISOString(),
        last_otp_dispatch_error: (e?.message || String(e)).slice(0, 200),
        portal_retry_count: retries + 1,
      }).eq("id", r.id);
    }
  }
  return { scanned: rows?.length ?? 0, sent };
}

async function bucketC(supabase: any) {
  // OTP validado, link facial ausente
  const cutoff = new Date(Date.now() - 60_000).toISOString();
  const { data: rows } = await supabase
    .from("customers")
    .select("id, portal2_idcliente, updated_at")
    .not("portal2_otp_validated_at", "is", null)
    .is("link_facial", null)
    .lt("updated_at", cutoff)
    .limit(BATCH_LIMIT);

  let recovered = 0;
  for (const r of rows ?? []) {
    const { idconsultor, idcliente } = await resolveIds(supabase, r.id);
    if (!idconsultor || !idcliente) continue;
    const resolved = await resolveWorker(supabase, r.id).catch(() => null);
    if (!resolved) continue;
    try {
      const url = `${resolved.url}/lead/${idcliente}/status?idconsultor=${idconsultor}`;
      const res = await fetch(url, {
        headers: { "Authorization": `Bearer ${resolved.secret}` },
        signal: AbortSignal.timeout(20_000),
      });
      const json: any = await res.json().catch(() => ({}));
      const ctr = json?.contract || {};
      const link = ctr.linkassinatura || ctr.link_assinatura || ctr.linkAssinatura || null;
      if (link) {
        await supabase.from("customers").update({
          link_facial: link,
          link_assinatura: link,
          portal2_contract_link: link,
          status: "awaiting_signature",
          conversation_step: "aguardando_facial",
        }).eq("id", r.id);
        recovered++;
      }
    } catch (e: any) {
      console.warn(`[watchdog C] customer=${r.id}: ${e?.message || e}`);
    }
  }
  return { scanned: rows?.length ?? 0, recovered };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const started = Date.now();
  try {
    const [a, b, c] = await Promise.all([bucketA(supabase), bucketB(supabase), bucketC(supabase)]);
    const out = { ok: true, ms: Date.now() - started, a, b, c };
    console.log(`📊 watchdog ${JSON.stringify(out)}`);
    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("❌ watchdog erro:", e?.message || e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
