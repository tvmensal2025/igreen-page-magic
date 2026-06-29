// captacao-backfill-ctwa
// ──────────────────────
// Roda sob demanda (chamado pelo admin). Varre `customers` dos últimos N dias
// que vieram de anúncio (lead_source ~ meta/ad/face/insta OU ctwa_clid não-nulo
// OU customer_origin = 'whatsapp_lead' com referral conhecido) e espelha em
// `captured_leads` via `ingestLead`. Idempotente — o dedup_key impede duplicar.
//
// Por que existir: leads de tráfego que chegam via WhatsApp (CTWA, Meta Ads)
// hoje só viram `customers`. O painel de Captação lê `captured_leads`, então
// fica vazio. Este backfill preenche o histórico até a ponte definitiva nos
// webhooks ser instalada.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { ingestLead } from "../_shared/captation/lead-ingest.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface CustomerRow {
  id: string;
  consultant_id: string | null;
  name: string | null;
  phone_whatsapp: string | null;
  email: string | null;
  address_city: string | null;
  lead_source: unknown;
  ctwa_clid: string | null;
  source_ctwa_clid: string | null;
  source_ad_id: string | null;
  source_campaign_id: string | null;
  customer_origin: string | null;
  origin_channel: string | null;
  created_at: string;
}

function looksLikeAd(r: CustomerRow): boolean {
  if (r.ctwa_clid || r.source_ctwa_clid || r.source_ad_id || r.source_campaign_id) return true;
  const s = JSON.stringify(r.lead_source || "").toLowerCase();
  return /(meta|face|insta|ctwa|ad_|ads|leadads|leadgen)/.test(s);
}

function shouldMirror(r: CustomerRow, includeWhatsappLeads: boolean): boolean {
  if (!r.consultant_id) return false;
  if (!r.phone_whatsapp && !r.email) return false;
  if (looksLikeAd(r)) return true;
  if (!includeWhatsappLeads) return false;
  // Qualquer customer que tenha entrado por canal de WhatsApp.
  if (r.origin_channel === "evolution" || r.origin_channel === "whapi") return true;
  if (r.customer_origin === "whatsapp_lead" || r.customer_origin === "meta_ads" || r.customer_origin === "ctwa") return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const days = Math.min(365, Math.max(1, Number(body.days ?? 90)));
  const consultantId = (body.consultantId as string | undefined) || null;
  const dryRun = body.dryRun === true;
  const includeWhatsappLeads = body.includeWhatsappLeads !== false; // default true

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();

  // Paginação para cobrir consultor com >1000 customers.
  const PAGE = 1000;
  let from = 0;
  const all: CustomerRow[] = [];
  for (let p = 0; p < 20; p++) {
    let q = supabase
      .from("customers")
      .select("id, consultant_id, name, phone_whatsapp, email, address_city, lead_source, ctwa_clid, source_ctwa_clid, source_ad_id, source_campaign_id, customer_origin, origin_channel, created_at")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (consultantId) q = q.eq("consultant_id", consultantId);
    const { data, error } = await q;
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const rows = (data as CustomerRow[]) || [];
    all.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  const rows = all.filter((r) => shouldMirror(r, includeWhatsappLeads));

  let ingested = 0;
  let deduped = 0;
  let skipped = 0;

  if (dryRun) {
    return new Response(JSON.stringify({ ok: true, dryRun: true, candidates: rows.length, scanned: all.length, days }), {
      status: 200, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  for (const r of rows) {
    if (!r.phone_whatsapp && !r.email) { skipped++; continue; }
    const isAd = looksLikeAd(r);
    const r2 = await ingestLead(supabase, {
      consultantId: r.consultant_id!,
      channel: isAd ? "ctwa" : "manual",
      personType: "pf",
      fullName: r.name,
      phone: r.phone_whatsapp,
      email: r.email,
      city: r.address_city,
      consentSource: "backfill_customers_whatsapp",
      sourceCampaignId: r.source_campaign_id ?? null,
      ctwaClid: r.ctwa_clid || r.source_ctwa_clid || null,
      rawPayload: {
        backfill: true,
        customer_id: r.id,
        lead_source: r.lead_source,
        origin_channel: r.origin_channel,
        customer_origin: r.customer_origin,
        source_ad_id: r.source_ad_id,
        created_at: r.created_at,
      },
    });
    if (!r2.ok) skipped++;
    else if (r2.deduped) deduped++;
    else ingested++;
  }

  return new Response(JSON.stringify({ ok: true, days, scanned: all.length, candidates: rows.length, ingested, deduped, skipped }), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
});
