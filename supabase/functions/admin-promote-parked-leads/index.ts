/**
 * admin-promote-parked-leads (limpeza do Conversão)
 *
 * Varre customers do consultor autenticado e marca `pos_venda_stage='cliente_ativo'`
 * em todos que já são cliente/licenciada, para saírem do funil de Conversão.
 *
 * Um customer é considerado "cliente ativo" se QUALQUER sinal for verdadeiro:
 *   - customer_origin = 'igreen_sync'
 *   - igreen_code preenchido
 *   - data_ativo OU data_validado OU data_cadastro preenchidos
 *   - andamento_igreen ∈ (ativo, aprovado, validado, licenciada, licenciado)
 *   - assinatura_cliente = true
 *   - telefone normalizado coincide com outro customer (qualquer consultor) que satisfaça 1–5
 *
 * NÃO toca em `captured_leads`.
 *
 * POST body opcional: { days?: number } (default 365 — retroativo amplo)
 * Retorno: { scanned, cleaned }
 */

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CLIENT_STATUSES = ["ativo", "aprovado", "validado", "licenciada", "licenciado"];

function normPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  return d || null;
}

function isActiveClient(c: any): boolean {
  if (c.customer_origin === "igreen_sync") return true;
  if (c.igreen_code && String(c.igreen_code).trim()) return true;
  if (c.data_ativo || c.data_validado || c.data_cadastro) return true;
  if (c.andamento_igreen && CLIENT_STATUSES.includes(String(c.andamento_igreen).toLowerCase())) return true;
  if (c.assinatura_cliente === true) return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) {
    return new Response(JSON.stringify({ error: "missing auth" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return new Response(JSON.stringify({ error: "invalid auth" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: consultant } = await admin
    .from("consultants")
    .select("id")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!consultant) {
    return new Response(JSON.stringify({ error: "consultant not found" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const consultantId = (consultant as any).id as string;

  try {
    // 1) Carrega todos os customers do consultor que HOJE estariam no funil
    //    de Conversão (mesmos filtros do cockpit) — só precisamos avaliar esses.
    const { data: rows, error } = await admin
      .from("customers")
      .select("id, name, phone_whatsapp, customer_origin, igreen_code, data_ativo, data_validado, data_cadastro, andamento_igreen, assinatura_cliente, pos_venda_stage")
      .eq("consultant_id", consultantId)
      .or("customer_origin.in.(whatsapp_lead,manual),customer_origin.is.null")
      .is("pos_venda_stage", null)
      .limit(5000);
    if (error) throw error;

    const scanned = (rows ?? []).length;
    const idsToClean = new Set<string>();

    // 2) Sinais diretos (1–5)
    const phonesToCheck = new Set<string>();
    for (const r of (rows ?? []) as any[]) {
      if (isActiveClient(r)) {
        idsToClean.add(r.id);
      } else {
        const p = normPhone(r.phone_whatsapp);
        if (p) phonesToCheck.add(p);
      }
    }

    // 3) Dedup por telefone: procura customers ativos com o mesmo telefone
    //    (qualquer consultor). Vasculha em lotes de 200 telefones.
    if (phonesToCheck.size > 0) {
      const phoneList = Array.from(phonesToCheck);
      const CHUNK = 200;
      const activePhones = new Set<string>();
      for (let i = 0; i < phoneList.length; i += CHUNK) {
        const chunk = phoneList.slice(i, i + CHUNK);
        // Gera variantes com e sem 55 para bater com dados heterogêneos.
        const variants = new Set<string>();
        for (const p of chunk) {
          variants.add(p);
          variants.add("55" + p);
        }
        const { data: matches, error: matchErr } = await admin
          .from("customers")
          .select("phone_whatsapp, customer_origin, igreen_code, data_ativo, data_validado, data_cadastro, andamento_igreen, assinatura_cliente")
          .in("phone_whatsapp", Array.from(variants))
          .limit(2000);
        if (matchErr) throw matchErr;
        for (const m of (matches ?? []) as any[]) {
          if (isActiveClient(m)) {
            const np = normPhone(m.phone_whatsapp);
            if (np) activePhones.add(np);
          }
        }
      }
      // Marca linhas do consultor cujo telefone bate com um cliente ativo.
      for (const r of (rows ?? []) as any[]) {
        if (idsToClean.has(r.id)) continue;
        const p = normPhone(r.phone_whatsapp);
        if (p && activePhones.has(p)) idsToClean.add(r.id);
      }
    }

    let cleaned = 0;
    if (idsToClean.size > 0) {
      const ids = Array.from(idsToClean);
      const CHUNK = 500;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const { error: updErr, count } = await admin
          .from("customers")
          .update({ pos_venda_stage: "cliente_ativo" }, { count: "exact" })
          .in("id", chunk);
        if (updErr) throw updErr;
        cleaned += count ?? 0;
      }
    }

    await admin.from("admin_audit_log").insert({
      admin_user_id: userData.user.id,
      action: "conversao.clean_active_clients",
      target_type: "customers",
      target_id: null,
      metadata: { scanned, cleaned },
    }).then(({ error }) => { if (error) console.warn("audit:", error.message); });

    return new Response(
      JSON.stringify({ ok: true, scanned, cleaned }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[admin-promote-parked-leads] error:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
