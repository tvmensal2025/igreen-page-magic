/**
 * platform-sales-dispatch — SuperAdmin (self-contained deploy).
 * dryRun default. Isolado de cadência/Cérebro/pós-venda.
 * Após WA D0 LIVE: CTA demo pós-venda (botões ≤3; menu 1–8 no webhook).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  PS_DEMO_CTA_PROMPT,
  buildPsDemoCtaButtonsOutbound,
  buildPsDemoMenuText,
} from "../_shared/platform-sales-demo.ts";
import { assertCanContact } from "../_shared/contact-suppression.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const VELIP_BASE = "https://vox.velip.com.br/api/v2";

type DayKey = "d0" | "d1";
type Channel = "whatsapp" | "sms" | "call";

type ScriptRow = {
  bloco_nome_com: string;
  bloco_nome_sem: string;
  saudacao_manha: string;
  saudacao_tarde: string;
  saudacao_noite: string;
  corpo_wa_d0: string;
  corpo_wa_d1: string;
  corpo_sms_d0: string;
  corpo_sms_d1: string;
  corpo_call_d0: string;
  corpo_call_d1: string;
};

function cors(req: Request): Record<string, string> {
  const o = req.headers.get("Origin") || "";
  const ok =
    !o ||
    /igreen\.cloud$/i.test(new URL(o).host) ||
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/i.test(o) ||
    /lovable\.(app|dev|project\.com)$/i.test(new URL(o).host);
  return {
    "Access-Control-Allow-Origin": ok ? (o || "https://igreen.cloud") : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function hourBRT(now = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false,
    }).format(now),
  ) % 24;
}

function usableName(raw: string | null | undefined): string {
  const full = String(raw || "").trim();
  if (!full) return "";
  const digits = full.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length >= full.replace(/\s/g, "").length * 0.7) return "";
  const bad = /^(ixi|kkk|oi|ola|olá|cliente|lead|teste)$/i;
  const first = full.split(/\s+/)[0] || "";
  if (bad.test(first)) return "";
  if (!/[A-Za-zÀ-ÿ]/.test(first) || first.length < 2) return "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function compose(scripts: ScriptRow, name: string | null | undefined, day: DayKey, channel: Channel): string {
  const n = usableName(name);
  const nomePlain = n
    ? (scripts.bloco_nome_com || "{{nome}}, tudo bem?").replace(/\{\{\s*nome\s*\}\}/gi, n)
    : (scripts.bloco_nome_sem || "Tudo bem?");
  const h = hourBRT();
  const saudacao =
    h < 12
      ? scripts.saudacao_manha || "Muito bom dia!"
      : h < 18
        ? scripts.saudacao_tarde || "Muito boa tarde!"
        : scripts.saudacao_noite || "Muito boa noite!";
  const corpo = (
    channel === "whatsapp"
      ? day === "d0"
        ? scripts.corpo_wa_d0
        : scripts.corpo_wa_d1
      : channel === "sms"
        ? day === "d0"
          ? scripts.corpo_sms_d0
          : scripts.corpo_sms_d1
        : day === "d0"
          ? scripts.corpo_call_d0
          : scripts.corpo_call_d1
  || "").trim();
  if (channel === "sms") return `${nomePlain} ${saudacao} ${corpo}`.replace(/\s{2,}/g, " ").trim();
  // WhatsApp: negrito + emoji na saudação (igual ao front).
  if (channel === "whatsapp") {
    const nomeWa = n ? `*${n}*, tudo bem?` : "*Tudo bem?*";
    return `${nomeWa}\n☀️ *${saudacao}*\n\n${corpo}`.trim();
  }
  return `${nomePlain}\n${saudacao}\n\n${corpo}`.trim();
}

function digitsPhone(raw: string): string {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}

function toVelip(raw: string): string | null {
  let d = digitsPhone(raw);
  if (!d.startsWith("55")) return null;
  if (d.length === 12 && /^55\d{2}[6-9]/.test(d)) d = `55${d.slice(2, 4)}9${d.slice(4)}`;
  return d.length === 12 || d.length === 13 ? d : null;
}

async function velipPost(path: string, form: URLSearchParams) {
  const token = (Deno.env.get("VELIP_API_TOKEN") || "").trim();
  if (!token) return { ok: false, error: "velip_not_configured" };
  form.set("token", token);
  const res = await fetch(`${VELIP_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const raw = await res.json().catch(() => ({}));
  const env = (raw?.return ?? raw ?? {}) as Record<string, unknown>;
  const status_code = Number(env.status_code ?? raw.status_code ?? -1);
  return { ok: status_code === 0 || status_code === 1, raw, env, error: String(env.status || env.error || "") };
}

async function whapiSendButtons(
  base: string,
  token: string,
  to: string,
  message: string,
  buttons: Array<{ id: string; title: string }>,
): Promise<boolean> {
  const safe = buttons.slice(0, 3).map((b) => ({
    type: "quick_reply",
    title: (b.title || "").substring(0, 25),
    id: b.id,
  }));
  const res = await fetch(`${base}/messages/interactive`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      to,
      type: "button",
      body: { text: message },
      footer: { text: "iGreen Energy" },
      action: { buttons: safe },
    }),
  });
  if (res.ok) return true;
  const numbered =
    `${message}\n\n` +
    buttons.map((b, i) => `*${i + 1}.* ${b.title}`).join("\n") +
    `\n\n_Digite o número da opção desejada._`;
  const fb = await fetch(`${base}/messages/text`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to, body: numbered }),
  });
  return fb.ok;
}

Deno.serve(async (req) => {
  const c = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: c });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...c, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const auth = req.headers.get("Authorization") || "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!jwt) return json(401, { error: "unauthorized" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const anon = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await anon.auth.getUser(jwt);
  if (userErr || !userData?.user?.id) return json(401, { error: "unauthorized" });
  const { data: isSa } = await admin.rpc("is_super_admin", { _user_id: userData.user.id });
  if (isSa !== true) return json(403, { error: "superadmin_only" });

  let body: {
    action?: string;
    campaign_id?: string;
    dry_run?: boolean;
    day?: DayKey;
    name?: string | null;
    channel?: Channel;
    channels?: Channel[];
    limit?: number;
    target_ids?: string[];
    force?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const { data: scriptRow } = await admin
    .from("platform_sales_script_settings")
    .select("*")
    .eq("id", "global")
    .maybeSingle();
  const scripts = (scriptRow || {
    bloco_nome_com: "{{nome}}, tudo bem?",
    bloco_nome_sem: "Tudo bem?",
    saudacao_manha: "Muito bom dia!",
    saudacao_tarde: "Muito boa tarde!",
    saudacao_noite: "Muito boa noite!",
    corpo_wa_d0: "",
    corpo_wa_d1: "",
    corpo_sms_d0: "",
    corpo_sms_d1: "",
    corpo_call_d0: "",
    corpo_call_d1: "",
  }) as ScriptRow;

  const action = body.action || "preview";
  if (action === "preview") {
    const channel = body.channel || "whatsapp";
    const day = body.day || "d0";
    return json(200, {
      ok: true,
      channel,
      day,
      text: compose(scripts, body.name, day, channel),
      dry_run: true,
    });
  }

  const campaignId = body.campaign_id;
  if (!campaignId) return json(400, { error: "campaign_id_required" });

  const { data: campaign } = await admin
    .from("platform_sales_campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return json(404, { error: "campaign_not_found" });

  const dryRun = body.dry_run !== undefined ? !!body.dry_run : campaign.dry_run !== false;
  const force = !!body.force;
  const day: DayKey = body.day || "d0";
  const campaignChannels = (Array.isArray(campaign.channels) ? campaign.channels : ["whatsapp", "sms", "call"]) as Channel[];
  const channels = (
    Array.isArray(body.channels) && body.channels.length > 0
      ? body.channels.filter((c): c is Channel => ["whatsapp", "sms", "call"].includes(c))
      : campaignChannels
  ) as Channel[];
  const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 50);

  if (!dryRun) {
    // Kill switch é FAIL-CLOSED: se não conseguirmos ler app_settings, não dispara.
    const { data: g, error: gErr } = await admin
      .from("app_settings").select("bot_global_enabled").eq("id", "global").maybeSingle();
    if (gErr) {
      console.error("[platform-sales-dispatch] falha ao ler bot_global_enabled", gErr);
      return json(503, { error: "kill_switch_unreadable" });
    }
    if (!g || g.bot_global_enabled === false) {
      return json(403, { error: "bot_global_disabled" });
    }
  }


  const { data: setRowsEarly } = await admin.from("settings").select("key, value").in("key", ["whapi_token", "whapi_api_url"]);
  const smapEarly: Record<string, string> = {};
  for (const r of setRowsEarly || []) {
    const v = typeof r.value === "string" ? r.value : String(r.value ?? "");
    if (v) smapEarly[r.key] = v.replace(/^"|"$/g, "");
  }
  const whapiTokenEarly = smapEarly.whapi_token || Deno.env.get("WHAPI_TOKEN") || "";
  const whapiBaseEarly = (smapEarly.whapi_api_url || Deno.env.get("WHAPI_API_URL") || "https://gate.whapi.cloud").replace(/\/$/, "");

  // Só reenvia os botões do demo pós-venda (sem texto D0/SMS/call).
  if (action === "cta_only") {
    const wantedIds = Array.isArray(body.target_ids)
      ? body.target_ids.map((x) => String(x)).filter(Boolean).slice(0, 50)
      : [];
    if (wantedIds.length === 0) return json(400, { error: "target_ids_required" });
    if (!whapiTokenEarly) return json(500, { error: "whapi_token_missing" });
    const { data: tlist } = await admin
      .from("platform_sales_targets")
      .select("*")
      .eq("campaign_id", campaignId)
      .in("id", wantedIds)
      .limit(50);
    const cta = buildPsDemoCtaButtonsOutbound();
    let sent = 0;
    let failed = 0;
    for (const t of tlist || []) {
      const phone = digitsPhone(t.phone);
      if (cta.type !== "buttons") continue;
      const ok = await whapiSendButtons(whapiBaseEarly, whapiTokenEarly, phone, cta.text, cta.buttons);
      await admin.from("platform_sales_dispatch_log").insert({
        campaign_id: campaignId,
        target_id: t.id,
        day_key: day,
        channel: "whatsapp",
        dry_run: false,
        rendered_text: `[BOTÕES DEMO]\n${cta.text}\n\n1. Sim, quero ouvir\n2. Agora não`,
        status: ok ? "ok" : "failed",
        error: ok ? null : "cta_send_failed",
      });
      if (ok) {
        sent++;
        await admin.from("platform_sales_targets").update({ demo_flow_state: "cta_sent" }).eq("id", t.id);
      } else {
        failed++;
      }
    }
    return json(200, { ok: true, action: "cta_only", sent, failed, processed: (tlist || []).length });
  }

  const statusFilter = day === "d0" ? ["queued"] : ["d1_queued"];
  const wantedIds = Array.isArray(body.target_ids)
    ? body.target_ids.map((x) => String(x)).filter(Boolean).slice(0, 50)
    : [];

  let q = admin
    .from("platform_sales_targets")
    .select("*")
    .eq("campaign_id", campaignId);

  // LIVE normal: só fila. force/reenvio: ignora status.
  if (!dryRun && !force) q = q.in("status", statusFilter);
  if (wantedIds.length > 0) q = q.in("id", wantedIds);

  const { data: targets } = await q
    .order("created_at", { ascending: true })
    .limit(limit);

  const list = targets || [];
  if (list.length === 0) {
    return json(200, {
      ok: true,
      dry_run: dryRun,
      day,
      processed: 0,
      results: [],
      reason: dryRun ? "no_targets" : "fila_vazia_ou_selecao_invalida",
    });
  }

  if (!dryRun) {
    await admin.from("platform_sales_campaigns").update({ status: "running", dry_run: false }).eq("id", campaignId);
  }

  const { data: setRows } = await admin.from("settings").select("key, value").in("key", ["whapi_token", "whapi_api_url"]);
  const smap: Record<string, string> = {};
  for (const r of setRows || []) {
    const v = typeof r.value === "string" ? r.value : String(r.value ?? "");
    if (v) smap[r.key] = v.replace(/^"|"$/g, "");
  }
  const whapiToken = smap.whapi_token || Deno.env.get("WHAPI_TOKEN") || "";
  const whapiBase = (smap.whapi_api_url || Deno.env.get("WHAPI_API_URL") || "https://gate.whapi.cloud").replace(/\/$/, "");

  let sent = 0;
  let failed = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const t of list) {
    // dryRun: não mexe em status do alvo (só loga texto) — senão trava o piloto
    if (!dryRun) {
      await admin.from("platform_sales_targets").update({ status: "sending" }).eq("id", t.id);
    }
    const phone = digitsPhone(t.phone);
    const channelResults: Array<Record<string, unknown>> = [];
    let anyFail = false;

    for (const channel of channels) {
      const text = compose(scripts, t.name, day, channel);
      let providerId: string | null = null;
      if (dryRun) {
        await admin.from("platform_sales_dispatch_log").insert({
          campaign_id: campaignId,
          target_id: t.id,
          day_key: day,
          channel,
          dry_run: true,
          rendered_text: text,
          status: "dry_run",
        });
        channelResults.push({ channel, status: "dry_run", text });
        if (channel === "whatsapp" && day === "d0") {
          const cta = buildPsDemoCtaButtonsOutbound();
          const ctaText =
            cta.type === "buttons"
              ? `${cta.text}\n\n*1.* ${cta.buttons[0]?.title}\n*2.* ${cta.buttons[1]?.title}`
              : PS_DEMO_CTA_PROMPT;
          await admin.from("platform_sales_dispatch_log").insert({
            campaign_id: campaignId,
            target_id: t.id,
            day_key: day,
            channel: "whatsapp",
            dry_run: true,
            rendered_text: `${ctaText}\n\n---\n${buildPsDemoMenuText()}`,
            status: "dry_run",
          });
          channelResults.push({ channel: "whatsapp", status: "dry_run_cta", text: ctaText });
        }
        continue;
      }

      // DNC / voice_dnc — nunca enviar venda da plataforma a número bloqueado.
      {
        const channelGate =
          channel === "whatsapp" ? "whatsapp" : channel === "sms" ? "sms" : "voice";
        const suppression = await assertCanContact(admin, {
          phone,
          channel: channelGate,
        });
        if (!suppression.allowed) {
          await admin.from("platform_sales_dispatch_log").insert({
            campaign_id: campaignId,
            target_id: t.id,
            day_key: day,
            channel,
            dry_run: false,
            rendered_text: text,
            status: "skipped_dnc",
            error: String(suppression.reason || "dnc").slice(0, 120),
          });
          channelResults.push({
            channel,
            status: "skipped_dnc",
            reason: suppression.reason,
          });
          continue;
        }
      }

      try {
        if (channel === "whatsapp") {
          if (!whapiToken) throw new Error("whapi_token_missing");
          const res = await fetch(`${whapiBase}/messages/text`, {
            method: "POST",
            headers: { Authorization: `Bearer ${whapiToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ to: phone, body: text }),
          });
          if (!res.ok) throw new Error(`whapi_${res.status}`);
          const whapiJson = await res.json().catch(() => ({})) as Record<string, unknown>;
          providerId = String(whapiJson.message?.id || whapiJson.id || "") || null;
          // Demo pós-venda: CTA após D0 — falha do CTA NÃO derruba o WA.
          if (day === "d0") {
            const cta = buildPsDemoCtaButtonsOutbound();
            if (cta.type === "buttons") {
              const okCta = await whapiSendButtons(
                whapiBase,
                whapiToken,
                phone,
                cta.text,
                cta.buttons,
              );
              await admin.from("platform_sales_dispatch_log").insert({
                campaign_id: campaignId,
                target_id: t.id,
                day_key: day,
                channel: "whatsapp",
                dry_run: false,
                rendered_text: `[BOTÕES DEMO]\n${cta.text}\n\n1. Sim, quero ouvir\n2. Agora não`,
                status: okCta ? "ok" : "failed",
                error: okCta ? null : "cta_send_failed",
              });
              if (okCta) {
                await admin
                  .from("platform_sales_targets")
                  .update({ demo_flow_state: "cta_sent" })
                  .eq("id", t.id);
              }
            }
          }
        } else if (channel === "sms") {
          const dest = toVelip(phone);
          if (!dest) throw new Error("invalid_sms_dest");
          const form = new URLSearchParams();
          form.set("dest", dest);
          form.set("message", text);
          form.set("cuttext", "1");
          form.set("ctid", `ps_${t.id}_${day}`);
          const r = await velipPost("/MakeSMS", form);
          if (!r.ok) throw new Error(r.error || "sms_failed");
          providerId = String((r.env as any)?.cdls_id ?? (r.raw as any)?.cdls_id ?? "") || null;
        } else {
          const dest = toVelip(phone);
          if (!dest) throw new Error("invalid_call_dest");
          const form = new URLSearchParams();
          form.set("dest", dest);
          form.set("text", text);
          form.set("encoding", "UTF-8");
          form.set("ctid", `ps_call_${t.id}_${day}`);
          const bina = Deno.env.get("VELIP_CALLER_ID")?.trim();
          if (bina) form.set("callerid", bina);
          const r = await velipPost("/MakeTTSCall", form);
          if (!r.ok) throw new Error(r.error || "call_failed");
          providerId = String((r.env as any)?.cdlo_id ?? (r.raw as any)?.cdlo_id ?? "") || null;
        }
        await admin.from("platform_sales_dispatch_log").insert({
          campaign_id: campaignId,
          target_id: t.id,
          day_key: day,
          channel,
          dry_run: false,
          rendered_text: text,
          status: "ok",
          provider_id: providerId,
        });
        channelResults.push({ channel, status: "ok", provider_id: providerId });
      } catch (e) {
        anyFail = true;
        const err = e instanceof Error ? e.message : String(e);
        await admin.from("platform_sales_dispatch_log").insert({
          campaign_id: campaignId,
          target_id: t.id,
          day_key: day,
          channel,
          dry_run: false,
          rendered_text: text,
          status: "failed",
          error: err,
        });
        channelResults.push({ channel, status: "failed", error: err });
      }
    }

    const nowIso = new Date().toISOString();
    if (dryRun) {
      // só contagem de simulação; alvo permanece queued / d1_queued
      sent++;
    } else if (force) {
      // Reenvio: não mexe no estágio da fila (já pode estar em d1_queued/done)
      sent++;
    } else if (anyFail) {
      failed++;
      await admin
        .from("platform_sales_targets")
        .update({
          status: "failed",
          last_error: "channel_fail",
          ...(day === "d0" ? { d0_sent_at: nowIso } : { d1_sent_at: nowIso }),
        })
        .eq("id", t.id);
    } else if (day === "d0") {
      sent++;
      await admin
        .from("platform_sales_targets")
        .update({ status: "d1_queued", d0_sent_at: nowIso, last_error: null })
        .eq("id", t.id);
    } else {
      sent++;
      await admin
        .from("platform_sales_targets")
        .update({ status: "done", d1_sent_at: nowIso, last_error: null })
        .eq("id", t.id);
    }
    results.push({ target_id: t.id, name: t.name, phone: phone.slice(-4), channels: channelResults });
  }

  if (dryRun) {
    await admin
      .from("platform_sales_campaigns")
      .update({ status: "queued", dry_run: true })
      .eq("id", campaignId);
  } else {
    const { count: left } = await admin
      .from("platform_sales_targets")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .in("status", ["queued", "d1_queued", "sending"]);

    await admin
      .from("platform_sales_campaigns")
      .update({
        sent: (campaign.sent || 0) + sent,
        failed: (campaign.failed || 0) + failed,
        status: (left || 0) > 0 ? "running" : "done",
        dry_run: false,
      })
      .eq("id", campaignId);
  }

  return json(200, { ok: true, dry_run: dryRun, day, processed: list.length, sent, failed, results });
});
