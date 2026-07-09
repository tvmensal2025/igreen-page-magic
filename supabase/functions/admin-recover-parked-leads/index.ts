/**
 * admin-recover-parked-leads
 *
 * Ferramenta administrativa para recuperar leads que ficaram parados
 * (captured_leads sem customer_id + customers whatsapp_lead sem estágio).
 *
 * Endpoints:
 *   GET  ?days=120&ddds=11,19,34&source=all|captured|customer&q=...
 *        → devolve a lista unificada (dedup por telefone normalizado + consultor).
 *
 *   POST { action: "promote", lead_keys: string[] }
 *        → promove captured_leads a customers (upsert por telefone + consultor)
 *          e marca customers existentes com pos_venda_stage=NULL (funil de conversão).
 *          Nunca toca em customer_origin='igreen_sync'.
 *
 *   POST { action: "mark_lost", lead_keys: string[] }
 *        → marca captured_leads como perdidos (status='lost') sem criar customer.
 *
 * `lead_keys` são strings no formato "captured:<uuid>" ou "customer:<uuid>".
 */

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PostSchema = z.object({
  action: z.enum(["promote", "mark_lost"]),
  lead_keys: z.array(z.string().regex(/^(captured|customer):[0-9a-f-]{36}$/i)).min(1).max(2000),
});

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 12 && digits.startsWith("55")) return digits;
  if (digits.length >= 10 && digits.length <= 11) return "55" + digits;
  return digits;
}

function extractDdd(phoneNorm: string | null): string | null {
  if (!phoneNorm) return null;
  const m = phoneNorm.match(/^55(\d{2})/);
  return m ? m[1] : null;
}

async function requireConsultantAdmin(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return { error: "missing auth", status: 401 };
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error } = await userClient.auth.getUser();
  if (error || !userData.user) return { error: "invalid auth", status: 401 };
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: consultant } = await admin
    .from("consultants")
    .select("id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!consultant) return { error: "consultant not found", status: 403 };
  return { admin, userId: userData.user.id, consultantId: (consultant as any).id as string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireConsultantAdmin(req);
  if ("error" in auth) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { admin, userId, consultantId } = auth;

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get("days") ?? "120", 10)));
      const source = (url.searchParams.get("source") ?? "all") as "all" | "captured" | "customer";
      const ddds = (url.searchParams.get("ddds") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
      const scope = (url.searchParams.get("scope") ?? "mine") as "mine" | "all";

      const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

      type Row = {
        key: string;
        source: "captured" | "customer";
        id: string;
        consultant_id: string | null;
        name: string | null;
        phone_raw: string | null;
        phone_norm: string | null;
        ddd: string | null;
        city: string | null;
        uf: string | null;
        source_campaign_id: string | null;
        status: string | null;
        created_at: string;
        days_stuck: number;
      };

      const rows: Row[] = [];

      // captured_leads sem customer
      if (source === "all" || source === "captured") {
        let query = admin
          .from("captured_leads")
          .select("id, consultant_id, full_name, phone, city, uf, source_campaign_id, status, created_at")
          .is("customer_id", null)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(3000);
        if (scope === "mine") query = query.eq("consultant_id", consultantId);
        const { data, error } = await query;
        if (error) throw error;
        for (const r of (data ?? []) as any[]) {
          const norm = normalizePhone(r.phone);
          rows.push({
            key: `captured:${r.id}`,
            source: "captured",
            id: r.id,
            consultant_id: r.consultant_id,
            name: r.full_name,
            phone_raw: r.phone,
            phone_norm: norm,
            ddd: extractDdd(norm),
            city: r.city,
            uf: r.uf,
            source_campaign_id: r.source_campaign_id,
            status: r.status,
            created_at: r.created_at,
            days_stuck: Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000),
          });
        }
      }

      // customers whatsapp_lead sem consultor OU sem estágio de conversão
      if (source === "all" || source === "customer") {
        let query = admin
          .from("customers")
          .select("id, consultant_id, name, phone_whatsapp, address_city, source_campaign_id, pos_venda_stage, customer_origin, created_at")
          .neq("customer_origin", "igreen_sync")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(3000);
        if (scope === "mine") query = query.eq("consultant_id", consultantId);
        const { data, error } = await query;
        if (error) throw error;
        for (const r of (data ?? []) as any[]) {
          const norm = normalizePhone(r.phone_whatsapp);
          rows.push({
            key: `customer:${r.id}`,
            source: "customer",
            id: r.id,
            consultant_id: r.consultant_id,
            name: r.name,
            phone_raw: r.phone_whatsapp,
            phone_norm: norm,
            ddd: extractDdd(norm),
            city: r.address_city,
            uf: null,
            source_campaign_id: r.source_campaign_id,
            status: r.pos_venda_stage ?? "sem_estagio",
            created_at: r.created_at,
            days_stuck: Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000),
          });
        }
      }

      // Dedup por (phone_norm + consultant_id): prioriza a linha do tipo "customer".
      const seen = new Map<string, Row>();
      const bucket: Row[] = [];
      for (const r of rows) {
        const dedupKey = `${r.consultant_id ?? "none"}|${r.phone_norm ?? "no-phone:" + r.key}`;
        const prev = seen.get(dedupKey);
        if (!prev) {
          seen.set(dedupKey, r);
          bucket.push(r);
        } else if (prev.source === "captured" && r.source === "customer") {
          // Substitui a versão captured pela customer
          const idx = bucket.indexOf(prev);
          if (idx >= 0) bucket[idx] = r;
          seen.set(dedupKey, r);
        }
      }

      let filtered = bucket;
      if (ddds.length > 0) filtered = filtered.filter((r) => r.ddd && ddds.includes(r.ddd));
      if (q) {
        filtered = filtered.filter((r) => {
          const name = (r.name ?? "").toLowerCase();
          const phone = (r.phone_norm ?? "").toLowerCase();
          return name.includes(q) || phone.includes(q);
        });
      }

      filtered.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));

      // Agregados por DDD para o painel
      const dddCounts: Record<string, number> = {};
      for (const r of filtered) {
        const k = r.ddd ?? "??";
        dddCounts[k] = (dddCounts[k] ?? 0) + 1;
      }

      return new Response(
        JSON.stringify({ rows: filtered, total: filtered.length, dddCounts }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (req.method === "POST") {
      const parsed = PostSchema.safeParse(await req.json());
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { action, lead_keys } = parsed.data;

      const capturedIds = lead_keys
        .filter((k) => k.startsWith("captured:"))
        .map((k) => k.slice("captured:".length));
      const customerIds = lead_keys
        .filter((k) => k.startsWith("customer:"))
        .map((k) => k.slice("customer:".length));

      if (action === "mark_lost") {
        let updated = 0;
        if (capturedIds.length > 0) {
          const { error, count } = await admin
            .from("captured_leads")
            .update({ status: "lost", updated_at: new Date().toISOString() }, { count: "exact" })
            .in("id", capturedIds);
          if (error) throw error;
          updated += count ?? 0;
        }
        await admin.from("admin_audit_log").insert({
          user_id: userId,
          action: "recover_leads.mark_lost",
          entity_type: "captured_leads",
          entity_id: null,
          metadata: { captured_count: capturedIds.length, updated },
        }).then(({ error }) => { if (error) console.warn("audit:", error.message); });
        return new Response(JSON.stringify({ ok: true, updated }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // action = "promote"
      let promoted = 0;
      let linked = 0;
      let reactivatedCustomers = 0;

      // 1) captured_leads → customers
      if (capturedIds.length > 0) {
        const { data: leads, error } = await admin
          .from("captured_leads")
          .select("id, consultant_id, full_name, phone, city, uf, source_campaign_id, ctwa_clid, channel")
          .in("id", capturedIds);
        if (error) throw error;

        for (const lead of (leads ?? []) as any[]) {
          const phoneNorm = normalizePhone(lead.phone);
          if (!phoneNorm || !lead.consultant_id) continue;

          // Existe customer com esse telefone para este consultor?
          const { data: existing } = await admin
            .from("customers")
            .select("id, customer_origin, pos_venda_stage, name")
            .eq("consultant_id", lead.consultant_id)
            .eq("phone_whatsapp", phoneNorm)
            .neq("customer_origin", "igreen_sync")
            .maybeSingle();

          let customerId: string | null = existing?.id ?? null;

          if (!customerId) {
            const { data: inserted, error: insErr } = await admin
              .from("customers")
              .insert({
                consultant_id: lead.consultant_id,
                phone_whatsapp: phoneNorm,
                name: lead.full_name ?? null,
                address_city: lead.city ?? null,
                customer_origin: "whatsapp_lead",
                origin_channel: lead.channel ?? "meta_form",
                source_campaign_id: lead.source_campaign_id ?? null,
                source_ctwa_clid: lead.ctwa_clid ?? null,
                pos_venda_stage: null,
              })
              .select("id")
              .maybeSingle();
            if (insErr) {
              console.warn("[promote] insert customer falhou:", insErr.message, "phone:", phoneNorm);
              continue;
            }
            customerId = (inserted as any)?.id ?? null;
            if (customerId) promoted += 1;
          } else {
            // Já existia — garante que está no funil (sem pos_venda_stage) e complementa nome se faltava
            const patch: Record<string, any> = { pos_venda_stage: null };
            if (!existing?.name && lead.full_name) patch.name = lead.full_name;
            const { error: updErr } = await admin
              .from("customers")
              .update(patch)
              .eq("id", customerId);
            if (!updErr) reactivatedCustomers += 1;
          }

          if (customerId) {
            await admin
              .from("captured_leads")
              .update({ customer_id: customerId, status: "converted", updated_at: new Date().toISOString() })
              .eq("id", lead.id);
            linked += 1;
          }
        }
      }

      // 2) customers já existentes: garante que estão no funil de conversão
      if (customerIds.length > 0) {
        const { error: updErr, count } = await admin
          .from("customers")
          .update({ pos_venda_stage: null }, { count: "exact" })
          .in("id", customerIds)
          .neq("customer_origin", "igreen_sync");
        if (updErr) throw updErr;
        reactivatedCustomers += count ?? 0;
      }

      await admin.from("admin_audit_log").insert({
        user_id: userId,
        action: "recover_leads.promote",
        entity_type: "customers",
        entity_id: null,
        metadata: {
          captured_count: capturedIds.length,
          customer_count: customerIds.length,
          promoted,
          linked,
          reactivated: reactivatedCustomers,
        },
      }).then(({ error }) => { if (error) console.warn("audit:", error.message); });

      return new Response(
        JSON.stringify({ ok: true, promoted, linked, reactivated: reactivatedCustomers }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[admin-recover-parked-leads] error:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
