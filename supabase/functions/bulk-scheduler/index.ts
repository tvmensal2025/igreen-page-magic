// Worker server-side de Disparo PRO
// Roda via pg_cron a cada 1 min. Processa campanhas agendadas e/ou em andamento
// que não estão sendo tocadas pelo cliente, mandando mensagens direto na Evolution API.
//
// Estratégia: cada execução pega até MAX_CAMPAIGNS_PER_TICK campanhas elegíveis,
// dispara até MAX_MSGS_PER_TICK por campanha respeitando intervalos, e sai.
// O próximo tick retoma de onde parou (sempre lendo targets status='queued').

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkSendQuota, registerSend, simulateTyping, typingDurationMs } from "../_shared/anti-ban.ts";
import { canSendProactive, logProactiveBlock } from "../_shared/proactive-send-guard.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import { assertBotOutboundAllowed } from "../_shared/bot/outbound-gate.ts";

const cronCorsHeaders = {
  ...corsHeaders,
  "Access-Control-Allow-Headers":
    `${corsHeaders["Access-Control-Allow-Headers"] || "authorization, x-client-info, apikey, content-type"}, x-service-secret, x-internal-secret`,
};
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";


const MAX_CAMPAIGNS_PER_TICK = 5;
const MAX_MSGS_PER_TICK = 25; // por campanha por execução
const MAX_EXEC_MS = 50_000;   // sair antes do timeout

interface CampaignRow {
  id: string;
  consultant_id: string;
  message_text: string | null;
  media_url: string | null;
  media_type: string | null;
  media_filename: string | null;
  config: any;
  status: string;
  total: number;
  sent: number;
  failed: number;
}

interface TargetRow {
  id: string;
  phone: string;
  name: string | null;
  vars: any;
}

function renderText(tpl: string, vars: { name?: string; bill?: number | null; city?: string | null }) {
  if (!tpl) return "";
  let out = tpl;
  const first = (vars.name || "").trim().split(/\s+/)[0] || "";
  const billStr = vars.bill != null
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(vars.bill))
    : "";
  const replacements: Record<string, string> = {
    nome: vars.name || "",
    primeiro_nome: first,
    valor_conta: billStr,
    cidade: vars.city || "",
  };
  for (const [k, v] of Object.entries(replacements)) {
    out = out.replace(new RegExp(`\\{\\s*${k}\\s*\\}`, "gi"), v);
  }
  // Spintax {a|b|c}
  out = out.replace(/\{([^{}]+)\}/g, (m, group) => {
    if (!group.includes("|")) return m;
    const opts = group.split("|");
    return opts[Math.floor(Math.random() * opts.length)];
  });
  return out;
}

function inWindow(cfg: any, at: Date = new Date()): boolean {
  if (!cfg) return true;
  // Horário oficial de Brasília via Intl (não assume offset fixo).
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(at).reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
  if (cfg.weekdaysOnly && (parts.weekday === "Sat" || parts.weekday === "Sun")) return false;
  const start = cfg.windowStart || "00:00";
  const end = cfg.windowEnd || "23:59";
  const [sH, sM] = String(start).split(":").map(Number);
  const [eH, eM] = String(end).split(":").map(Number);
  const startMin = sH * 60 + sM;
  const endMin = eH * 60 + eM;
  const cur = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  if (endMin < startMin) return cur >= startMin || cur <= endMin;
  return cur >= startMin && cur <= endMin;
}

async function sendViaEvolution(opts: {
  baseUrl: string; apiKey: string; instance: string;
  phone: string; text?: string; mediaUrl?: string | null;
  mediaType?: string | null; fileName?: string | null;
  mediaOrder: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { baseUrl, apiKey, instance, phone, text, mediaUrl, mediaType, fileName, mediaOrder } = opts;
  const headers = { "Content-Type": "application/json", apikey: apiKey };
  const base = baseUrl.replace(/\/+$/, "");

  async function post(path: string, body: any) {
    const r = await fetch(`${base}/${path}/${instance}`, {
      method: "POST", headers, body: JSON.stringify(body),
    });
    const txt = await r.text();
    if (!r.ok) return { ok: false, error: `${r.status} ${txt.slice(0, 200)}` };
    return { ok: true };
  }

  try {
    if (mediaUrl && mediaType && mediaType !== "text") {
      const isImg = mediaType === "image";
      const isVid = mediaType === "video";
      const isAud = mediaType === "audio";
      // text_first → manda texto antes
      if (mediaOrder === "text_first" && text?.trim()) {
        const r = await post("message/sendText", { number: phone, text });
        if (!r.ok) return r;
        await new Promise(rs => setTimeout(rs, 1500));
      }
      if (isAud) {
        const r = await post("message/sendWhatsAppAudio", { number: phone, audio: mediaUrl });
        if (!r.ok) return r;
      } else if (isImg || isVid) {
        const caption = (mediaOrder === "caption_only" || mediaOrder === "media_first") ? (text || "") : "";
        const r = await post("message/sendMedia", { number: phone, mediatype: isImg ? "image" : "video", media: mediaUrl, caption });
        if (!r.ok) return r;
      } else {
        // document
        const r = await post("message/sendMedia", { number: phone, mediatype: "document", media: mediaUrl, fileName: fileName || "documento" });
        if (!r.ok) return r;
      }
      // media_first + áudio/doc → manda texto depois
      if (mediaOrder === "media_first" && text?.trim() && (isAud || (!isImg && !isVid))) {
        await new Promise(rs => setTimeout(rs, 1500));
        const r = await post("message/sendText", { number: phone, text });
        if (!r.ok) return r;
      }
      return { ok: true };
    }
    if (!text?.trim()) return { ok: false, error: "Mensagem vazia" };
    return await post("message/sendText", { number: phone, text });
  } catch (e: any) {
    return { ok: false, error: e?.message || "Erro de rede" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const evoUrl = Deno.env.get("EVOLUTION_API_URL");
  const evoKey = Deno.env.get("EVOLUTION_API_KEY");

  if (!evoUrl || !evoKey) {
    return new Response(JSON.stringify({ error: "EVOLUTION_API_URL/KEY ausentes" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const cronAuth = await assertCronAuth(req, supabase);
  if (!cronAuth.ok) return cronAuthUnauthorized(cronAuth.reason, cronCorsHeaders);

    if (!(await isAutomationEnabled(supabase, "bulk_campaigns_runner"))) {
      await logSkipped(supabase, "bulk_campaigns_runner");
      return new Response(JSON.stringify({ skipped: "automation_disabled", key: "bulk_campaigns_runner" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

  const report: any[] = [];

  // 0) Destrava alvos presos em 'sending' (worker anterior morreu no meio).
  const { data: reconciled, error: reconcileError } = await supabase
    .rpc("reconcile_stuck_bulk_targets");
  if (reconcileError) console.warn("[bulk] reconcile falhou:", reconcileError.message);
  else if (reconciled) console.log(`[bulk] ${reconciled} alvo(s) destravado(s) de sending`);

  // 1) Promove campanhas agendadas cujo horário já chegou
  const nowIso = new Date().toISOString();
  await supabase
    .from("bulk_campaigns")
    .update({ status: "running", started_at: nowIso })
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso);

  // 2) Busca campanhas em andamento (incluindo as recém-promovidas)
  const { data: camps, error: e1 } = await supabase
    .from("bulk_campaigns")
    .select("id,consultant_id,message_text,media_url,media_type,media_filename,config,status,total,sent,failed")
    .eq("status", "running")
    .order("created_at", { ascending: true })
    .limit(MAX_CAMPAIGNS_PER_TICK);

  if (e1) {
    return new Response(JSON.stringify({ error: e1.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  for (const camp of (camps as CampaignRow[]) || []) {
    if (Date.now() - startedAt > MAX_EXEC_MS) break;
    const cfg = camp.config || {};

    // Janela horária
    if (!inWindow(cfg)) {
      report.push({ id: camp.id, skipped: "outside_window" });
      continue;
    }

    // Instância do consultor
    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("instance_name")
      .eq("consultant_id", camp.consultant_id)
      .maybeSingle();
    const instance = inst?.instance_name;
    if (!instance) {
      report.push({ id: camp.id, skipped: "no_instance" });
      continue;
    }

    // 🛡️ Trava de proteção: phone do consultor precisa bater com instância
    const guard = await canSendProactive(supabase, { consultantId: camp.consultant_id, instanceName: instance });
    if (!guard.allowed) {
      await logProactiveBlock(supabase, {
        consultantId: camp.consultant_id,
        instanceName: instance,
        reason: guard.reason,
        context: { source: "bulk-scheduler", campaign_id: camp.id, detail: guard.detail },
      });
      // Pausa a campanha para o consultor reabrir o cadastro
      await supabase.from("bulk_campaigns").update({ status: "paused" }).eq("id", camp.id);
      report.push({ id: camp.id, paused: "phone_guard", reason: guard.reason, detail: guard.detail });
      continue;
    }


    // Pega próximos targets
    const { data: targets } = await supabase
      .from("bulk_campaign_targets")
      .select("id,phone,name,vars")
      .eq("campaign_id", camp.id)
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(MAX_MSGS_PER_TICK);

    const list = (targets as TargetRow[]) || [];
    if (list.length === 0) {
      // Acabou? Marca done.
      const { data: stats } = await supabase
        .from("bulk_campaign_targets")
        .select("status")
        .eq("campaign_id", camp.id);
      const sent = (stats || []).filter((s: any) => s.status === "sent").length;
      const failed = (stats || []).filter((s: any) => s.status === "failed").length;
      await supabase.from("bulk_campaigns").update({
        status: "done", sent, failed, finished_at: new Date().toISOString(),
      }).eq("id", camp.id);
      report.push({ id: camp.id, finalized: true, sent, failed });
      continue;
    }

    // Opt-out: não enviar para phones com do_not_contact neste consultor
    const phoneDigits = list.map((t) => t.phone.replace(/\D/g, "")).filter(Boolean);
    const suppressedPhones = new Set<string>();
    if (phoneDigits.length) {
      const { data: dncCust } = await supabase
        .from("customers")
        .select("phone_whatsapp")
        .eq("consultant_id", camp.consultant_id)
        .eq("do_not_contact", true)
        .in("phone_whatsapp", list.map((t) => t.phone));
      for (const row of dncCust || []) {
        const d = String((row as { phone_whatsapp?: string }).phone_whatsapp || "").replace(/\D/g, "");
        if (d) suppressedPhones.add(d);
      }
      // Também tenta match pelos últimos 11 dígitos via like — phones podem diferir de formato
      const { data: dncAll } = await supabase
        .from("customers")
        .select("phone_whatsapp")
        .eq("consultant_id", camp.consultant_id)
        .eq("do_not_contact", true)
        .limit(5000);
      const dncSet = new Set(
        (dncAll || []).map((r: { phone_whatsapp?: string }) =>
          String(r.phone_whatsapp || "").replace(/\D/g, ""),
        ).filter(Boolean),
      );
      for (const d of phoneDigits) {
        if ([...dncSet].some((b) => b === d || d.endsWith(b) || b.endsWith(d))) {
          suppressedPhones.add(d);
        }
      }
    }

    const mediaOrder = String(cfg.mediaOrder || "media_first");

    let processed = 0;
    let consecutiveFailures = 0;
    let quotaBlocked = false;
    for (const t of list) {
      if (Date.now() - startedAt > MAX_EXEC_MS) break;

      const tDigits = t.phone.replace(/\D/g, "");
      if (suppressedPhones.has(tDigits) || [...suppressedPhones].some((b) => tDigits.endsWith(b) || b.endsWith(tDigits))) {
        await supabase.from("bulk_campaign_targets").update({
          status: "failed",
          error: "do_not_contact",
          sent_at: new Date().toISOString(),
        }).eq("id", t.id).eq("status", "queued");
        continue;
      }

      const gate = await assertBotOutboundAllowed(supabase, {
        phone: t.phone,
        consultantId: camp.consultant_id,
      });
      if (!gate.allowed) {
        await supabase.from("bulk_campaign_targets").update({
          status: "failed",
          error: gate.reason || "suppressed",
          sent_at: new Date().toISOString(),
        }).eq("id", t.id).eq("status", "queued");
        continue;
      }

      // 🛡️ Anti-ban guard: warmup + recovery + circuit breaker.
      const quota = await checkSendQuota(supabase, instance);
      if (!quota.allowed) {
        report.push({
          id: camp.id, paused: "anti_ban_guard",
          reason: quota.reason, warmup_day: quota.warmup_day,
          cap: quota.cap, sent: quota.sent,
        });
        quotaBlocked = true;
        break;
      }

      // Claim atômico: só prossegue se ESTE worker mudou queued→sending.
      // Se outro tick concorrente já reivindicou o alvo, data volta vazio.
      const { data: claimed, error: claimError } = await supabase
        .from("bulk_campaign_targets")
        .update({ status: "sending", claimed_at: new Date().toISOString() })
        .eq("id", t.id)
        .eq("status", "queued")
        .select("id");
      if (claimError || !claimed || claimed.length === 0) {
        continue;
      }
      const finalMsg = renderText(camp.message_text || "", {
        name: t.name || undefined,
        bill: t.vars?.bill ?? null,
        city: t.vars?.city ?? null,
      });

      // Humaniza: "digitando..." antes do envio (proporcional ao tamanho)
      if (finalMsg) {
        await simulateTyping({
          baseUrl: evoUrl, apiKey: evoKey, instance,
          remoteJid: t.phone, durationMs: typingDurationMs(finalMsg),
        });
      }

      const r = await sendViaEvolution({
        baseUrl: evoUrl, apiKey: evoKey, instance,
        phone: t.phone, text: finalMsg,
        mediaUrl: camp.media_url, mediaType: camp.media_type, fileName: camp.media_filename,
        mediaOrder,
      });

      const patch: any = {
        status: r.ok ? "sent" : "failed",
        final_message: finalMsg.slice(0, 4000),
        sent_at: new Date().toISOString(),
      };
      if (!r.ok) patch.error = r.error?.slice(0, 500);
      await supabase.from("bulk_campaign_targets").update(patch).eq("id", t.id);

      if (r.ok) {
        processed++;
        consecutiveFailures = 0;
        await registerSend(supabase, instance);
      } else {
        consecutiveFailures++;
      }

      if (consecutiveFailures >= 5) {
        report.push({ id: camp.id, paused: "5_consecutive_failures" });
        break;
      }

      // Intervalo respeita o mínimo do warmup (do quota check)
      const minS = Math.max(
        Math.ceil((quota.min_interval_ms ?? 18000) / 1000),
        Number(cfg.intervalMinS ?? 18),
      );
      const maxS = Math.max(minS + 4, Number(cfg.intervalMaxS ?? 32));
      const secs = minS + Math.random() * (maxS - minS);
      await new Promise(rs => setTimeout(rs, Math.round(secs * 1000)));
    }
    if (quotaBlocked) continue;

    // Recalcula contadores ao final do lote
    const { data: stats2 } = await supabase
      .from("bulk_campaign_targets")
      .select("status")
      .eq("campaign_id", camp.id);
    const sentN = (stats2 || []).filter((s: any) => s.status === "sent").length;
    const failedN = (stats2 || []).filter((s: any) => s.status === "failed").length;
    await supabase.from("bulk_campaigns")
      .update({ sent: sentN, failed: failedN })
      .eq("id", camp.id);

    report.push({ id: camp.id, processed, sent: sentN, failed: failedN });
  }

  return new Response(JSON.stringify({ ok: true, elapsed_ms: Date.now() - startedAt, report }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});