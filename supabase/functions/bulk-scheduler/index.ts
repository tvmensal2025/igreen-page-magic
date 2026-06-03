// Worker server-side de Disparo PRO
// Roda via pg_cron a cada 1 min. Processa campanhas agendadas e/ou em andamento
// que não estão sendo tocadas pelo cliente, mandando mensagens direto na Evolution API.
//
// Estratégia: cada execução pega até MAX_CAMPAIGNS_PER_TICK campanhas elegíveis,
// dispara até MAX_MSGS_PER_TICK por campanha respeitando intervalos, e sai.
// O próximo tick retoma de onde parou (sempre lendo targets status='queued').

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

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

function inWindow(cfg: any): boolean {
  if (!cfg) return true;
  // Considera America/Sao_Paulo (UTC-3) sem DST atualmente
  const now = new Date(Date.now() - 3 * 3600_000);
  if (cfg.weekdaysOnly) {
    const d = now.getUTCDay();
    if (d === 0 || d === 6) return false;
  }
  const start = cfg.windowStart || "00:00";
  const end = cfg.windowEnd || "23:59";
  const [sH, sM] = String(start).split(":").map(Number);
  const [eH, eM] = String(end).split(":").map(Number);
  const startMin = sH * 60 + sM;
  const endMin = eH * 60 + eM;
  const cur = now.getUTCHours() * 60 + now.getUTCMinutes();
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
  const report: any[] = [];

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

    const minS = Math.max(1, Number(cfg.intervalMinS ?? 18));
    const maxS = Math.max(minS, Number(cfg.intervalMaxS ?? 32));
    const mediaOrder = String(cfg.mediaOrder || "media_first");

    let processed = 0;
    let consecutiveFailures = 0;
    for (const t of list) {
      if (Date.now() - startedAt > MAX_EXEC_MS) break;

      // Marca sending
      await supabase.from("bulk_campaign_targets").update({ status: "sending" }).eq("id", t.id);
      const finalMsg = renderText(camp.message_text || "", {
        name: t.name || undefined,
        bill: t.vars?.bill ?? null,
        city: t.vars?.city ?? null,
      });

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

      // Incrementa contador na campanha
      if (r.ok) {
        processed++;
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
      }

      if (consecutiveFailures >= 5) {
        report.push({ id: camp.id, paused: "5_consecutive_failures" });
        break;
      }

      // Intervalo aleatório
      const secs = minS + Math.random() * (maxS - minS);
      await new Promise(rs => setTimeout(rs, Math.round(secs * 1000)));
    }

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
