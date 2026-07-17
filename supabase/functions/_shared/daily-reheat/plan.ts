/**
 * daily-reheat — seleção de candidatos + fila due (máquina de estados).
 * Este módulo NÃO envia; o cron/dispatch decide live vs dry.
 */

import { firstStep, stepDef, type CycleQueue } from "./cycle.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export type DailyReheatSettings = {
  id: string;
  enabled: boolean;
  live_dispatch_enabled: boolean;
  daily_whapi_cap: number;
  queue_a_wait_minutes: number;
  queue_a_silence_hours: number;
  cooldown_hours: number;
  cold_min_age_hours: number;
  window_start_brt: string;
  window_end_brt: string;
  weekdays_only: boolean;
  flow_variant: string;
  priority_queue: "A_then_B" | "B_then_A" | "A_only" | "B_only";
  pilot_consultant_ids: string[];
};

export type PlannedAction =
  | "open_attendance"
  | "send_audio"
  | "start_flow"
  | "call"
  | "sms"
  | "close_rating"
  | "wait";

export type CandidatePlan = {
  customer_id: string;
  consultant_id: string | null;
  queue: "A" | "B";
  step: string;
  phone_tail: string;
  name: string | null;
  planned_actions: PlannedAction[];
  would_consume_whapi: boolean;
  would_call: boolean;
  would_sms: boolean;
  reason: string;
  guards: string[];
};

const TERMINAL_STEPS = new Set([
  "complete",
  "portal_submitting",
  "portal_submitted",
  "registered_igreen",
  "awaiting_signature",
  "finalizando",
  "validando_otp",
  "aguardando_humano",
  "aguardando_avaliacao_atendimento",
  "atendimento_finalizado",
]);

export function cycleDateBRT(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isWithinCommercialWindow(
  settings: DailyReheatSettings,
  now = new Date(),
): { ok: boolean; reason?: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const minutes = hour * 60 + minute;

  if (settings.weekdays_only) {
    // en-GB short: Mon..Fri / Sat / Sun
    if (weekday === "Sat" || weekday === "Sun") {
      return { ok: false, reason: "weekend" };
    }
  }

  const [sh, sm] = settings.window_start_brt.slice(0, 5).split(":").map(Number);
  const [eh, em] = settings.window_end_brt.slice(0, 5).split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (minutes < start || minutes > end) {
    return { ok: false, reason: "outside_window" };
  }
  return { ok: true };
}

export async function loadDailyReheatSettings(supabase: SB): Promise<DailyReheatSettings> {
  const { data } = await supabase
    .from("daily_reheat_settings")
    .select("*")
    .eq("id", "global")
    .maybeSingle();

  return {
    id: "global",
    enabled: !!(data as any)?.enabled,
    live_dispatch_enabled: !!(data as any)?.live_dispatch_enabled,
    daily_whapi_cap: Number((data as any)?.daily_whapi_cap ?? 60),
    queue_a_wait_minutes: Number((data as any)?.queue_a_wait_minutes ?? 5),
    queue_a_silence_hours: Number((data as any)?.queue_a_silence_hours ?? 2),
    cooldown_hours: Number((data as any)?.cooldown_hours ?? 72),
    cold_min_age_hours: Number((data as any)?.cold_min_age_hours ?? 72),
    window_start_brt: String((data as any)?.window_start_brt ?? "09:00").slice(0, 8),
    window_end_brt: String((data as any)?.window_end_brt ?? "18:30").slice(0, 8),
    weekdays_only: (data as any)?.weekdays_only !== false,
    flow_variant: String((data as any)?.flow_variant ?? "F"),
    priority_queue: ((data as any)?.priority_queue ?? "A_then_B") as DailyReheatSettings["priority_queue"],
    pilot_consultant_ids: Array.isArray((data as any)?.pilot_consultant_ids)
      ? (data as any).pilot_consultant_ids.map(String)
      : [],
  };
}

function phoneTail(phone: string | null | undefined): string {
  const d = String(phone || "").replace(/\D/g, "");
  return d.slice(-4) || "????";
}

function baseGuards(c: any): string[] {
  const g: string[] = [];
  if (c.bot_paused) g.push("bot_paused");
  if (c.assigned_human_id) g.push("assigned_human");
  if (c.do_not_contact) g.push("do_not_contact");
  if (TERMINAL_STEPS.has(c.conversation_step || "")) g.push("terminal_step");
  if (c.capture_mode === "manual") g.push("capture_manual");
  return g;
}

/**
 * Seleciona candidatos Fila A (novo) e B (frio) e aplica teto diário Whapi.
 * Só planeja — nunca muta customers nem dispara canal.
 */
export async function planDailyReheat(
  supabase: SB,
  settings: DailyReheatSettings,
  opts: { cycleDate: string; limitScan?: number } = { cycleDate: cycleDateBRT() },
): Promise<{
  plans: CandidatePlan[];
  skippedGuards: number;
  skippedCap: number;
  scannedA: number;
  scannedB: number;
}> {
  const limitScan = opts.limitScan ?? 80;
  const now = Date.now();
  const waitMs = settings.queue_a_wait_minutes * 60_000;
  const coldAgeMs = settings.cold_min_age_hours * 3600_000;
  const cooldownMs = settings.cooldown_hours * 3600_000;
  const novoCutoff = new Date(now - waitMs).toISOString();
  const novoLookback = new Date(now - 24 * 3600_000).toISOString();
  const coldBefore = new Date(now - coldAgeMs).toISOString();
  const cooldownSince = new Date(now - cooldownMs).toISOString();

  let qA = supabase
    .from("customers")
    .select(
      "id, name, phone_whatsapp, consultant_id, created_at, welcome_sent_at, conversation_step, bot_paused, assigned_human_id, do_not_contact, capture_mode, customer_origin, last_bot_interaction_at",
    )
    .lte("created_at", novoCutoff)
    .gte("created_at", novoLookback)
    .is("welcome_sent_at", null)
    .eq("bot_paused", false)
    .is("assigned_human_id", null)
    .or("customer_origin.in.(whatsapp_lead,manual),customer_origin.is.null")
    .order("created_at", { ascending: true })
    .limit(limitScan);

  let qB = supabase
    .from("customers")
    .select(
      "id, name, phone_whatsapp, consultant_id, created_at, welcome_sent_at, conversation_step, bot_paused, assigned_human_id, do_not_contact, capture_mode, customer_origin, last_bot_interaction_at",
    )
    .lte("created_at", coldBefore)
    .eq("bot_paused", false)
    .is("assigned_human_id", null)
    .or("customer_origin.in.(whatsapp_lead,manual),customer_origin.is.null")
    .order("last_bot_interaction_at", { ascending: true, nullsFirst: true })
    .limit(limitScan);

  if (settings.pilot_consultant_ids.length > 0) {
    qA = qA.in("consultant_id", settings.pilot_consultant_ids);
    qB = qB.in("consultant_id", settings.pilot_consultant_ids);
  }

  const [{ data: rowsA }, { data: rowsB }] = await Promise.all([qA, qB]);

  // Já enfileirados hoje
  const { data: existing } = await supabase
    .from("daily_reheat_queue")
    .select("customer_id")
    .eq("cycle_date", opts.cycleDate);
  const already = new Set((existing || []).map((r: any) => r.customer_id));

  // Toques proativos recentes (cooldown)
  const idsForCooldown = [
    ...new Set([
      ...(rowsA || []).map((r: any) => r.id),
      ...(rowsB || []).map((r: any) => r.id),
    ]),
  ];
  const recentTouch = new Set<string>();
  if (idsForCooldown.length > 0) {
    const { data: touches } = await supabase
      .from("proactive_touch_log")
      .select("customer_id")
      .in("customer_id", idsForCooldown.slice(0, 200))
      .gte("created_at", cooldownSince);
    for (const t of touches || []) recentTouch.add((t as any).customer_id);
  }

  // DNC voz
  const phones = [
    ...new Set(
      [...(rowsA || []), ...(rowsB || [])]
        .map((r: any) => String(r.phone_whatsapp || "").replace(/\D/g, ""))
        .filter((p) => p.length >= 10),
    ),
  ];
  const dncPhones = new Set<string>();
  if (phones.length > 0) {
    const { data: dnc } = await supabase
      .from("voice_dnc_list")
      .select("phone")
      .in("phone", phones.slice(0, 200));
    for (const d of dnc || []) {
      dncPhones.add(String((d as any).phone || "").replace(/\D/g, ""));
    }
  }

  let skippedGuards = 0;
  const rawPlans: CandidatePlan[] = [];

  const consider = (c: any, queue: "A" | "B") => {
    if (already.has(c.id)) {
      skippedGuards++;
      return;
    }
    const guards = baseGuards(c);
    const digits = String(c.phone_whatsapp || "").replace(/\D/g, "");
    if (dncPhones.has(digits)) guards.push("voice_dnc");
    if (recentTouch.has(c.id)) guards.push("proactive_cooldown");
    if (!c.phone_whatsapp) guards.push("no_phone");

    if (guards.length > 0) {
      skippedGuards++;
      return;
    }

    const q = queue as CycleQueue;
    const first = firstStep(q);
    rawPlans.push({
      customer_id: c.id,
      consultant_id: c.consultant_id,
      queue: q,
      step: first.id,
      phone_tail: phoneTail(c.phone_whatsapp),
      name: c.name,
      planned_actions: [...first.actions],
      would_consume_whapi: first.would_consume_whapi,
      would_call: first.would_call,
      would_sms: first.would_sms,
      reason:
        q === "A"
          ? `novo_wait_${settings.queue_a_wait_minutes}min`
          : `frio_age_${settings.cold_min_age_hours}h`,
      guards: [],
    });
  };

  for (const c of rowsA || []) consider(c, "A");
  // Frio: exclui quem já entrou como A nesta rodada
  const takenA = new Set(rawPlans.filter((p) => p.queue === "A").map((p) => p.customer_id));
  for (const c of rowsB || []) {
    if (takenA.has(c.id)) continue;
    consider(c, "B");
  }

  // Prioridade + teto Whapi
  const order =
    settings.priority_queue === "B_then_A"
      ? [...rawPlans.filter((p) => p.queue === "B"), ...rawPlans.filter((p) => p.queue === "A")]
      : settings.priority_queue === "A_only"
        ? rawPlans.filter((p) => p.queue === "A")
        : settings.priority_queue === "B_only"
          ? rawPlans.filter((p) => p.queue === "B")
          : [...rawPlans.filter((p) => p.queue === "A"), ...rawPlans.filter((p) => p.queue === "B")];

  // Contar slots já "planejados" hoje que consumiriam Whapi
  const { count: usedToday } = await supabase
    .from("daily_reheat_queue")
    .select("id", { count: "exact", head: true })
    .eq("cycle_date", opts.cycleDate)
    .in("status", ["planned", "claimed", "done"]);

  let slotsLeft = Math.max(0, settings.daily_whapi_cap - (usedToday ?? 0));
  const plans: CandidatePlan[] = [];
  let skippedCap = 0;

  // Reserva ~30% do cap para Fila A ("sempre traz novos") quando A não é a única fila
  // e a prioridade não é A_only. Assim, mesmo com backlog frio, lead novo sempre entra.
  const reserveForA =
    settings.priority_queue === "A_only" || settings.priority_queue === "B_only"
      ? 0
      : Math.floor(settings.daily_whapi_cap * 0.3);
  let usedByB = 0;

  const remainingA = () => order.filter((p) => p.queue === "A" && !plans.includes(p)).length;

  for (const p of order) {
    if (!p.would_consume_whapi) {
      plans.push(p);
      continue;
    }
    if (slotsLeft <= 0) {
      skippedCap++;
      continue;
    }
    // Se este consome Whapi, é B, e ainda há leads A esperando + reserva não atendida → segura o slot
    if (p.queue === "B" && remainingA() > 0 && slotsLeft <= reserveForA - usedByB) {
      skippedCap++;
      continue;
    }
    plans.push(p);
    slotsLeft--;
    if (p.queue === "B") usedByB++;
  }

  return {
    plans,
    skippedGuards,
    skippedCap,
    scannedA: (rowsA || []).length,
    scannedB: (rowsB || []).length,
  };
}

/**
 * Itens da fila já inscritos cujo next_action_at chegou — um passo por tick.
 */
export async function loadDueQueuePlans(
  supabase: SB,
  opts: { cycleDate: string; limit?: number } = { cycleDate: cycleDateBRT() },
): Promise<CandidatePlan[]> {
  const limit = opts.limit ?? 40;
  const nowIso = new Date().toISOString();
  const { data: rows } = await supabase
    .from("daily_reheat_queue")
    .select(
      "customer_id, consultant_id, queue, step, planned_actions, status, next_action_at",
    )
    .eq("cycle_date", opts.cycleDate)
    .in("status", ["planned", "claimed"])
    .lte("next_action_at", nowIso)
    .order("next_action_at", { ascending: true })
    .limit(limit);

  if (!rows?.length) return [];

  const ids = rows.map((r: any) => r.customer_id);
  const { data: custs } = await supabase
    .from("customers")
    .select("id, name, phone_whatsapp, do_not_contact, bot_paused, assigned_human_id")
    .in("id", ids);
  const byId = new Map((custs || []).map((c: any) => [c.id, c]));

  const plans: CandidatePlan[] = [];
  for (const r of rows as any[]) {
    const c = byId.get(r.customer_id);
    if (!c) continue;
    if (c.do_not_contact || c.bot_paused || c.assigned_human_id) {
      await supabase
        .from("daily_reheat_queue")
        .update({
          status: "skipped",
          skip_reason: c.do_not_contact
            ? "do_not_contact"
            : c.bot_paused
              ? "bot_paused"
              : "assigned_human",
          updated_at: new Date().toISOString(),
        })
        .eq("customer_id", r.customer_id)
        .eq("cycle_date", opts.cycleDate);
      continue;
    }

    const queue = (r.queue === "B" ? "B" : "A") as CycleQueue;
    const def = stepDef(queue, String(r.step || "")) || firstStep(queue);
    const actions =
      Array.isArray(r.planned_actions) && r.planned_actions.length > 0
        ? (r.planned_actions as PlannedAction[])
        : [...def.actions];

    plans.push({
      customer_id: r.customer_id,
      consultant_id: r.consultant_id,
      queue,
      step: def.id,
      phone_tail: phoneTail(c.phone_whatsapp),
      name: c.name,
      planned_actions: actions,
      would_consume_whapi: def.would_consume_whapi,
      would_call: def.would_call,
      would_sms: def.would_sms,
      reason: `due_step_${def.id}`,
      guards: [],
    });
  }
  return plans;
}

