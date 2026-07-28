/**
 * Pré-gera TTS dos agendamentos pós-venda (atrasados + próximos 48h).
 * Saudação = bucket do slot planejado (clampToPosVendaSendWindow).
 */
import { applyOutboundTemplateVars } from "./outbound-template-vars.ts";
import { clampToPosVendaSendWindow } from "./pos-venda-send-window.ts";
import {
  saudacaoBucketBRT,
  type SaudacaoBucket,
} from "./pos-venda-tts.ts";
import { renderPosVendaStitchedAudio } from "./pos-venda-audio-stitch.ts";

const MS_DAY = 24 * 60 * 60 * 1000;
const HORIZON_MS = 48 * 60 * 60 * 1000;

const MILESTONES = [
  { days: 0, stage: "aprovado", stageKey: "pv_aprovado" },
  { days: 30, stage: "d30", stageKey: "pv_d30" },
  { days: 60, stage: "d60", stageKey: "pv_d60" },
  { days: 90, stage: "d90", stageKey: "pv_d90" },
  { days: 120, stage: "d120", stageKey: "pv_d120" },
  { days: 150, stage: "d150", stageKey: "pv_d150" },
  { days: 180, stage: "d180", stageKey: "pv_d180" },
  { days: 210, stage: "d210", stageKey: "pv_d210" },
] as const;

export interface PrepDueItem {
  customerId: string;
  consultantId: string;
  customerName: string | null;
  nameSource: string | null;
  phone: string | null;
  stageKey: string;
  stage: string;
  plannedSendAt: Date;
  saudacaoBucket: SaudacaoBucket;
  overdue: boolean;
}

function findTargetMilestone(daysSince: number): (typeof MILESTONES)[number] | null {
  // Igual findBucket do auto-progress: maior marco atingido; se <30 → aprovado.
  if (daysSince < 30) return MILESTONES[0];
  for (let i = MILESTONES.length - 1; i >= 1; i--) {
    if (daysSince >= MILESTONES[i].days) return MILESTONES[i];
  }
  return MILESTONES[0];
}

/** Lista itens a preparar: marco atual due (atrasado ou ≤48h), ainda não sent. */
export async function listPosVendaPrepDue(
  supabase: any,
  now: Date = new Date(),
): Promise<PrepDueItem[]> {
  const { data: customers, error } = await supabase
    .from("customers")
    .select(
      "id, name, name_source, phone_whatsapp, consultant_id, pos_venda_stage, pos_venda_approved_at",
    )
    .eq("customer_origin", "igreen_sync")
    .eq("pos_venda_manual", true)
    .in("pos_venda_stage", ["aprovado", "d30", "d60", "d90", "d120", "d150", "d180", "d210"])
    .not("pos_venda_approved_at", "is", null);

  if (error) {
    console.error("[pos-venda-audio-prep] list customers", error.message);
    return [];
  }

  const ids = (customers || []).map((c: any) => String(c.id));
  const sentKeys = new Set<string>();
  if (ids.length > 0) {
    // chunk to avoid URL limits
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data: logs } = await supabase
        .from("customer_auto_message_log")
        .select("customer_id, stage_key, status")
        .in("customer_id", chunk)
        .like("stage_key", "pv_%");
      for (const l of logs || []) {
        const st = String(l.status || "");
        if (st === "sent" || st.startsWith("sent") || st === "skipped_prior" || st === "disabled_no_send") {
          sentKeys.add(`${l.customer_id}:${l.stage_key}`);
        }
      }
    }
  }

  const out: PrepDueItem[] = [];
  const nowMs = now.getTime();

  for (const c of customers || []) {
    const approvedAt = new Date(c.pos_venda_approved_at);
    if (!Number.isFinite(approvedAt.getTime())) continue;
    const daysSince = Math.floor((nowMs - approvedAt.getTime()) / MS_DAY);
    const m = findTargetMilestone(daysSince);
    if (!m) continue;
    if (sentKeys.has(`${c.id}:${m.stageKey}`)) continue;

    const rawDue = new Date(approvedAt.getTime() + m.days * MS_DAY);
    const planned = clampToPosVendaSendWindow(rawDue, now);
    const plannedMs = planned.getTime();
    // Só atrasados ou dentro de 48h do slot planejado.
    if (plannedMs > nowMs + HORIZON_MS) continue;

    out.push({
      customerId: String(c.id),
      consultantId: String(c.consultant_id),
      customerName: c.name ?? null,
      nameSource: c.name_source ?? null,
      phone: c.phone_whatsapp ?? null,
      stageKey: m.stageKey,
      stage: m.stage,
      plannedSendAt: planned,
      saudacaoBucket: saudacaoBucketBRT(planned),
      overdue: plannedMs <= nowMs,
    });
  }

  // Overdue primeiro, depois por planned_send_at.
  out.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return a.plannedSendAt.getTime() - b.plannedSendAt.getTime();
  });
  return out;
}

async function resolveMessageText(
  supabase: any,
  consultantId: string,
  stage: string,
  defaults: Record<string, { message_text?: string | null }>,
): Promise<string | null> {
  const stageKey = stage === "aprovado" ? "pv_aprovado" : `pv_${stage}`;
  const { data: ks } = await supabase
    .from("kanban_stages")
    .select("id, auto_message_text")
    .eq("consultant_id", consultantId)
    .eq("stage_key", stageKey)
    .eq("stage_scope", "pos_venda")
    .maybeSingle();

  if (ks?.id) {
    const { data: msgs } = await supabase
      .from("stage_auto_messages")
      .select("message_text")
      .eq("stage_id", ks.id)
      .order("position", { ascending: true })
      .limit(1);
    const t = msgs?.[0]?.message_text;
    if (t && String(t).trim()) return String(t);
  }
  if (ks?.auto_message_text && String(ks.auto_message_text).trim()) {
    return String(ks.auto_message_text);
  }
  const def = defaults[stage]?.message_text;
  return def && String(def).trim() ? String(def) : null;
}

export interface PrepTickResult {
  considered: number;
  prepared: number;
  skipped_existing: number;
  skipped_no_text: number;
  failed: number;
}

export async function runPosVendaAudioPrepTick(
  supabase: any,
  opts: { limit?: number; now?: Date } = {},
): Promise<PrepTickResult> {
  const limit = Math.max(1, Math.min(80, opts.limit ?? 40));
  const now = opts.now ?? new Date();
  const due = await listPosVendaPrepDue(supabase, now);
  const batch = due.slice(0, limit);

  const { data: defaultRows } = await supabase
    .from("pos_venda_default_media")
    .select("stage, message_text");
  const defaults: Record<string, { message_text?: string | null }> = {};
  for (const d of defaultRows || []) defaults[d.stage] = d;

  const result: PrepTickResult = {
    considered: batch.length,
    prepared: 0,
    skipped_existing: 0,
    skipped_no_text: 0,
    failed: 0,
  };

  for (const item of batch) {
    const { data: existing } = await supabase
      .from("pos_venda_prepared_audio")
      .select("audio_url, saudacao_bucket, spoken_text")
      .eq("customer_id", item.customerId)
      .eq("stage_key", item.stageKey)
      .maybeSingle();

    if (
      existing?.audio_url &&
      existing.saudacao_bucket === item.saudacaoBucket
    ) {
      result.skipped_existing++;
      continue;
    }

    const rawTemplate = await resolveMessageText(
      supabase,
      item.consultantId,
      item.stage,
      defaults,
    );
    if (!rawTemplate) {
      result.skipped_no_text++;
      continue;
    }

    const spokenPersonalized = applyOutboundTemplateVars(rawTemplate, {
      customerName: item.customerName,
      nameSource: item.nameSource,
      phone: item.phone,
      now: item.plannedSendAt,
    });
    if (String(spokenPersonalized || "").trim().length < 8) {
      result.skipped_no_text++;
      continue;
    }

    // Stitch: intro nome (reuso) + saudação fixa + corpo fixo — sem TTS do roteiro inteiro.
    const stitched = await renderPosVendaStitchedAudio(supabase, {
      consultantId: item.consultantId,
      customerName: item.customerName,
      nameSource: item.nameSource,
      stage: item.stage,
      rawTemplate,
      now: item.plannedSendAt,
    });
    const url = stitched.ok ? stitched.url : null;
    if (!url) {
      result.failed++;
      continue;
    }

    const { error: upErr } = await supabase.from("pos_venda_prepared_audio").upsert(
      {
        customer_id: item.customerId,
        consultant_id: item.consultantId,
        stage_key: item.stageKey,
        audio_url: url,
        spoken_text: String(spokenPersonalized).slice(0, 4000),
        saudacao_bucket: item.saudacaoBucket,
        planned_send_at: item.plannedSendAt.toISOString(),
        prepared_at: new Date().toISOString(),
      },
      { onConflict: "customer_id,stage_key" },
    );
    if (upErr) {
      console.error("[pos-venda-audio-prep] upsert", item.customerId, upErr.message);
      result.failed++;
      continue;
    }
    result.prepared++;
  }

  return result;
}

/** Busca áudio preparado se saudacao_bucket bater com o bucket atual (hora do envio). */
export async function getPreparedPosVendaAudio(
  supabase: any,
  customerId: string,
  stageKey: string,
  now: Date = new Date(),
): Promise<string | null> {
  const bucket = saudacaoBucketBRT(now);
  const { data } = await supabase
    .from("pos_venda_prepared_audio")
    .select("audio_url, saudacao_bucket")
    .eq("customer_id", customerId)
    .eq("stage_key", stageKey)
    .maybeSingle();
  if (!data?.audio_url) return null;
  if (String(data.saudacao_bucket) !== bucket) return null;
  return String(data.audio_url);
}
