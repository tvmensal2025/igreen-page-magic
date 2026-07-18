import { useCallback, useEffect, useMemo, useState } from "react";
import { Mic, RefreshCw, Play, Settings2, MessageSquare, Loader2, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { CADENCE_CALENDAR } from "@/lib/cadenceCalendarMap";
import { isIgreenWalletOrigin } from "@/lib/customerOrigin";
import { normalizeBrazilPhone, validateBrazilPhone } from "@/lib/phone";

type CycleStep = { id: string; label: string; short: string };

type CycleLead = {
  id: string;
  name: string | null;
  phone: string | null;
  status: string | null;
};

type SlicePick = {
  group: "A" | "B" | "C";
  step: CycleStep;
  people: CycleLead[];
};

/**
 * Pizza A — Fila A do ciclo diário (NOVO_CYCLE) + GREETED/NEW de leads reais.
 * AI_QUALIFYING NÃO entra: é conversa/bot ou ruído (sync/cliente) — não é fatia de ciclo.
 */
const CYCLE_NOVO_STEPS: CycleStep[] = [
  { id: "quente", label: "Pré-onda", short: "Pré" },
  { id: "open", label: "Abre + áudio", short: "Abre" },
  { id: "flow", label: "Inicia fluxo", short: "Fluxo" },
  { id: "wait2h", label: "Silêncio ~2h", short: "Silêncio" },
  { id: "call1", label: "1ª ligação", short: "Liga" },
  { id: "retry", label: "Retry se NA", short: "Retry" },
  { id: "sms", label: "SMS se NA", short: "SMS" },
  { id: "close", label: "Fecha + nota", short: "Fecha" },
];

/** Só pré-onda de lead novo. AI_QUALIFYING fica de fora da pizza. */
const CADENCE_TO_NOVO: Record<string, string> = {
  NEW: "quente",
  GREETED: "quente",
};

/** Status que já passou do funil / não é lead de ciclo. */
const EXCLUDED_CYCLE_STATUSES = new Set([
  "approved",
  "registered_igreen",
  "cadastro_concluido",
  "rejected",
  "contato_incompleto",
]);

function isCycleLeadEligible(c: {
  customer_origin?: string | null;
  status?: string | null;
}): boolean {
  if (isIgreenWalletOrigin(c.customer_origin)) return false;
  const st = String(c.status || "").toLowerCase();
  if (EXCLUDED_CYCLE_STATUSES.has(st)) return false;
  return true;
}

/**
 * Pizza B — dias reais do calendário v5 (D+1 → D10).
 * Fonte: CADENCE_CALENDAR group B.
 */
const CYCLE_FRIO_STEPS: CycleStep[] = CADENCE_CALENDAR.filter((d) => d.group === "B").map((d) => ({
  id: d.id,
  label: d.label,
  short: d.id === "d1" ? "D+1" : d.id.replace("d", "D"),
}));

/** Estágio lead_cadence_state → dia da pizza B. */
const CADENCE_TO_FRIO: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const day of CADENCE_CALENDAR) {
    if (day.group !== "B") continue;
    for (const step of day.steps) map[step.stage] = day.id;
  }
  return map;
})();

/**
 * Fila B do daily-reheat (FRIO_CYCLE) → dia v5 mais próximo.
 * O motor unitário (COLD_*) é a fonte canônica; isto só evita “buraco” visual.
 */
const QUEUE_B_TO_FRIO: Record<string, string> = {
  call1: "d1",
  open: "d1",
  retry: "d4",
  sms: "d6",
  wait: "d7",
  close: "d10",
};

/**
 * Pizza C — Meta + marcos de recall (agrega WA/SMS/CALL do mesmo marco).
 */
const CYCLE_LONGO_STEPS: CycleStep[] = [
  { id: "meta", label: "Meta / audiência / ads", short: "Meta" },
  { id: "r30", label: "1º recall (~30d)", short: "~30d" },
  { id: "r90", label: "Recall ~90d", short: "90d" },
  { id: "r5m", label: "Recall ~5 meses", short: "5m" },
  { id: "r8m", label: "Recall ~8 meses", short: "8m" },
  { id: "r12m", label: "Recall ~12 meses", short: "12m" },
  { id: "ryear", label: "Recall anual", short: "Ano" },
];

const CADENCE_TO_LONGO: Record<string, string> = {
  CLOSE_LOST: "meta",
  RETARGET_META: "meta",
  RETARGET_ADS_15D: "meta",
  RECALL_60D: "r30",
  RECALL_60D_SMS: "r30",
  RECALL_60D_CALL: "r30",
  RECALL_90D: "r90",
  RECALL_90D_SMS: "r90",
  RECALL_90D_CALL: "r90",
  RECALL_5M: "r5m",
  RECALL_5M_SMS: "r5m",
  RECALL_5M_CALL: "r5m",
  RECALL_8M: "r8m",
  RECALL_8M_SMS: "r8m",
  RECALL_8M_CALL: "r8m",
  RECALL_12M: "r12m",
  RECALL_12M_SMS: "r12m",
  RECALL_12M_CALL: "r12m",
  RECALL_YEARLY: "ryear",
  RECALL_YEARLY_SMS: "ryear",
  RECALL_YEARLY_CALL: "ryear",
};

const ALL_CADENCE_STAGES = [
  ...Object.keys(CADENCE_TO_NOVO),
  ...Object.keys(CADENCE_TO_FRIO),
  ...Object.keys(CADENCE_TO_LONGO),
];

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function cycleDateBRT(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function modeStep(agg: Record<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [k, v] of Object.entries(agg)) {
    if (v > bestN) {
      best = k;
      bestN = v;
    }
  }
  return best;
}

function indexOfStep(steps: CycleStep[], id: string | null): number | null {
  if (!id) return null;
  const i = steps.findIndex((s) => s.id === id);
  return i >= 0 ? i : null;
}

function PizzaRing({
  title,
  subtitle,
  steps,
  activeIndex,
  peopleCount,
  perStep,
  compact,
  onSliceClick,
}: {
  title: string;
  subtitle: string;
  steps: CycleStep[];
  activeIndex: number;
  peopleCount: number;
  perStep: Record<string, number>;
  compact?: boolean;
  onSliceClick?: (step: CycleStep) => void;
}) {
  const n = steps.length;
  const size = compact ? 340 : 420;
  const cx = size / 2;
  const cy = size / 2;
  const r = compact ? 96 : 118;
  const hole = compact ? 48 : 58;
  const labelR = compact ? 138 : 168;
  const svgMax = compact ? 300 : 400;

  return (
    <div className="flex flex-col items-center gap-2.5 min-w-0 w-full">
      <div className="text-center px-1">
        <p className="font-heading font-bold text-base text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground leading-tight">{subtitle}</p>
        <p className="mt-1 text-sm font-semibold tabular-nums text-primary">
          {peopleCount === 1 ? "1 pessoa" : `${peopleCount} pessoas`} no ciclo
        </p>
        {onSliceClick && (
          <p className="text-[10px] text-muted-foreground mt-0.5">Clique na fatia pra ver quem é</p>
        )}
      </div>

      <svg
        width={svgMax}
        height={svgMax}
        viewBox={`0 0 ${size} ${size}`}
        className="shrink-0 w-full max-w-[min(100%,400px)] h-auto"
        role="img"
        aria-label={title}
      >
        {steps.map((s, i) => {
          const a0 = (360 / n) * i + 1;
          const a1 = (360 / n) * (i + 1) - 1;
          const p1 = polar(cx, cy, r, a0);
          const p2 = polar(cx, cy, r, a1);
          const large = a1 - a0 > 180 ? 1 : 0;
          const has = (perStep[s.id] || 0) > 0;
          const current = activeIndex >= 0 && i === activeIndex;
          const clickable = !!onSliceClick && has;
          return (
            <path
              key={s.id}
              d={`M ${cx} ${cy} L ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y} Z`}
              className={cn(
                "transition-all duration-500 ease-out",
                has ? "fill-primary" : "fill-muted",
                clickable && "cursor-pointer hover:brightness-110",
              )}
              style={{ opacity: current ? 1 : has ? 0.7 : 0.22 }}
              onClick={() => clickable && onSliceClick?.(s)}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={`${s.label}: ${perStep[s.id] || 0}`}
              onKeyDown={(e) => {
                if (clickable && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSliceClick?.(s);
                }
              }}
            />
          );
        })}

        <circle cx={cx} cy={cy} r={hole} className="fill-card pointer-events-none" />

        {steps.map((s, i) => {
          const ang = (360 / n) * i + 360 / n / 2;
          const p = polar(cx, cy, labelR, ang);
          const has = (perStep[s.id] || 0) > 0;
          const current = activeIndex >= 0 && i === activeIndex;
          const count = perStep[s.id] || 0;
          return (
            <g
              key={`l-${s.id}`}
              className={cn(has && onSliceClick && "cursor-pointer")}
              onClick={() => has && onSliceClick?.(s)}
            >
              <text
                x={p.x}
                y={p.y - 6}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  fontSize: current ? (compact ? 12 : 14) : compact ? 10 : 12,
                  fontWeight: current ? 700 : 500,
                  fill: current
                    ? "hsl(var(--foreground))"
                    : has
                      ? "hsl(var(--foreground) / 0.8)"
                      : "hsl(var(--muted-foreground))",
                }}
              >
                {s.short}
              </text>
              <text
                x={p.x}
                y={p.y + 10}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  fontSize: compact ? 10 : 11,
                  fontWeight: 700,
                  fill: has ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.5)",
                }}
              >
                {count}
              </text>
            </g>
          );
        })}

        <text
          x={cx}
          y={cy - 10}
          textAnchor="middle"
          className="pointer-events-none"
          style={{ fontSize: compact ? 22 : 28, fontWeight: 800, fill: "hsl(var(--foreground))" }}
        >
          {peopleCount}
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          className="pointer-events-none"
          style={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
        >
          {peopleCount === 1 ? "pessoa" : "pessoas"}
        </text>
        <text
          x={cx}
          y={cy + 28}
          textAnchor="middle"
          className="pointer-events-none"
          style={{ fontSize: 10, fontWeight: 600, fill: "hsl(var(--primary))" }}
        >
          {activeIndex >= 0 ? (steps[activeIndex]?.short ?? "—") : "—"}
        </text>
      </svg>

      <div className="flex flex-wrap justify-center gap-1 px-2 max-w-[380px]">
        {steps.map((s) => {
          const nStep = perStep[s.id] || 0;
          return (
            <button
              type="button"
              key={`b-${s.id}`}
              disabled={nStep <= 0 || !onSliceClick}
              onClick={() => onSliceClick?.(s)}
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-md tabular-nums border transition-colors",
                nStep > 0
                  ? "bg-primary/10 border-primary/30 text-foreground hover:bg-primary/20 cursor-pointer"
                  : "bg-muted/30 border-transparent text-muted-foreground cursor-default",
              )}
            >
              {s.short} {nStep}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type ToggleRow = { key: string; enabled: boolean };
type Settings = {
  enabled: boolean;
  live_dispatch_enabled: boolean;
  daily_whapi_cap: number;
  priority_queue: "A_then_B" | "B_then_A" | "A_only" | "B_only";
};

interface ReheatCyclePizzaProps {
  activeNovo?: number;
  activeFrio?: number;
  activeLongo?: number;
  demoSpin?: boolean;
  consultantId?: string;
  /** Mostrar cockpit administrativo (switches, cap, prioridade, botões de admin). */
  admin?: boolean;
  /** Abre conversa interna (WhatsApp da plataforma). */
  onOpenChat?: (phone: string, suggestedMessage?: string) => void;
}

export function ReheatCyclePizza({
  activeNovo,
  activeFrio,
  activeLongo,
  demoSpin = false,
  consultantId,
  admin = false,
  onOpenChat,
}: ReheatCyclePizzaProps) {
  const { toast } = useToast();
  const controlled = activeNovo != null || activeFrio != null || activeLongo != null;
  const [demoNovo, setDemoNovo] = useState(0);
  const [demoFrio, setDemoFrio] = useState(0);
  const [demoLongo, setDemoLongo] = useState(0);
  const [liveNovo, setLiveNovo] = useState<number | null>(null);
  const [liveFrio, setLiveFrio] = useState<number | null>(null);
  const [liveLongo, setLiveLongo] = useState<number | null>(null);
  const [perStepA, setPerStepA] = useState<Record<string, number>>({});
  const [perStepB, setPerStepB] = useState<Record<string, number>>({});
  const [perStepC, setPerStepC] = useState<Record<string, number>>({});
  const [peopleA, setPeopleA] = useState<Record<string, CycleLead[]>>({});
  const [peopleB, setPeopleB] = useState<Record<string, CycleLead[]>>({});
  const [peopleC, setPeopleC] = useState<Record<string, CycleLead[]>>({});
  const [slicePick, setSlicePick] = useState<SlicePick | null>(null);
  const [countNovo, setCountNovo] = useState(0);
  const [countFrio, setCountFrio] = useState(0);
  const [countLongo, setCountLongo] = useState(0);
  const [cadenceDueToday, setCadenceDueToday] = useState(0);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [toggleCadence, setToggleCadence] = useState(false);
  const [toggleReheat, setToggleReheat] = useState(false);
  const [toggleLive, setToggleLive] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    const cycleDate = cycleDateBRT();
    const counted = new Set<string>();

    const aggA: Record<string, number> = {};
    const aggB: Record<string, number> = {};
    const aggC: Record<string, number> = {};
    const idsA: Record<string, string[]> = {};
    const idsB: Record<string, string[]> = {};
    const idsC: Record<string, string[]> = {};

    const bump = (
      agg: Record<string, number>,
      ids: Record<string, string[]>,
      slice: string,
      customerId: string,
    ) => {
      if (!slice || counted.has(customerId)) return;
      counted.add(customerId);
      agg[slice] = (agg[slice] || 0) + 1;
      if (!ids[slice]) ids[slice] = [];
      ids[slice].push(customerId);
    };

    // 1) Fila diária (A/B) — prioridade sobre cadência no mesmo lead
    let q = (supabase as any)
      .from("daily_reheat_queue")
      .select("customer_id, queue, step, status, consultant_id")
      .eq("cycle_date", cycleDate)
      .in("status", ["planned", "claimed"])
      .limit(5000);
    if (consultantId) q = q.eq("consultant_id", consultantId);
    const { data: qRows } = await q;
    const rows =
      (qRows as { customer_id: string; queue: string; step: string }[]) || [];

    // 2) Motor unitário — B/C (+ GREETED/NEW em A). Sem AI_QUALIFYING na pizza.
    let qCad = (supabase as any)
      .from("lead_cadence_state")
      .select("customer_id, stage, consultant_id, next_action_at")
      .in("stage", ALL_CADENCE_STAGES)
      .limit(5000);
    if (consultantId) qCad = qCad.eq("consultant_id", consultantId);
    const { data: cadRows } = await qCad;
    const cadList =
      (cadRows as { customer_id: string; stage: string; next_action_at: string | null }[]) || [];

    // Elegibilidade: só lead WhatsApp/manual — exclui sync e quem já virou cliente / passou do funil
    const allIds = [...new Set([...rows.map((r) => r.customer_id), ...cadList.map((c) => c.customer_id)])];
    const eligible = new Set<string>();
    const custById = new Map<string, CycleLead>();
    if (allIds.length > 0) {
      const { data: custRows } = await (supabase as any)
        .from("customers")
        .select("id, name, phone_whatsapp, customer_origin, status")
        .in("id", allIds.slice(0, 5000));
      for (const c of (custRows as {
        id: string;
        name: string | null;
        phone_whatsapp: string | null;
        customer_origin: string | null;
        status: string | null;
      }[]) || []) {
        if (isCycleLeadEligible(c)) {
          eligible.add(c.id);
          custById.set(c.id, {
            id: c.id,
            name: c.name,
            phone: c.phone_whatsapp,
            status: c.status,
          });
        }
      }
    }

    for (const r of rows) {
      if (!eligible.has(r.customer_id)) continue;
      if (r.queue === "A") {
        bump(aggA, idsA, r.step, r.customer_id);
      } else if (r.queue === "B") {
        bump(aggB, idsB, QUEUE_B_TO_FRIO[r.step] || r.step, r.customer_id);
      }
    }

    for (const c of cadList) {
      if (!eligible.has(c.customer_id)) continue;
      const sliceA = CADENCE_TO_NOVO[c.stage];
      if (sliceA) {
        bump(aggA, idsA, sliceA, c.customer_id);
        continue;
      }
      const sliceB = CADENCE_TO_FRIO[c.stage];
      if (sliceB) {
        bump(aggB, idsB, sliceB, c.customer_id);
        continue;
      }
      const sliceC = CADENCE_TO_LONGO[c.stage];
      if (sliceC) bump(aggC, idsC, sliceC, c.customer_id);
    }

    const toPeople = (idsMap: Record<string, string[]>): Record<string, CycleLead[]> => {
      const out: Record<string, CycleLead[]> = {};
      for (const [slice, ids] of Object.entries(idsMap)) {
        out[slice] = ids
          .map((id) => custById.get(id))
          .filter((x): x is CycleLead => !!x)
          .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));
      }
      return out;
    };

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const due = cadList.filter(
      (c) => eligible.has(c.customer_id) && c.next_action_at && new Date(c.next_action_at) <= todayEnd,
    ).length;
    setCadenceDueToday(due);

    setPerStepA(aggA);
    setPerStepB(aggB);
    setPerStepC(aggC);
    setPeopleA(toPeople(idsA));
    setPeopleB(toPeople(idsB));
    setPeopleC(toPeople(idsC));
    setCountNovo(Object.values(aggA).reduce((a, b) => a + b, 0));
    setCountFrio(Object.values(aggB).reduce((a, b) => a + b, 0));
    setCountLongo(Object.values(aggC).reduce((a, b) => a + b, 0));

    setLiveNovo(indexOfStep(CYCLE_NOVO_STEPS, modeStep(aggA)));
    setLiveFrio(indexOfStep(CYCLE_FRIO_STEPS, modeStep(aggB)));
    setLiveLongo(indexOfStep(CYCLE_LONGO_STEPS, modeStep(aggC)));
    setLoading(false);
  }, [consultantId]);

  const loadAdmin = useCallback(async () => {
    if (!admin) return;
    const { data: s } = await (supabase as any)
      .from("daily_reheat_settings")
      .select("enabled, live_dispatch_enabled, daily_whapi_cap, priority_queue")
      .eq("id", "global")
      .maybeSingle();
    if (s) {
      setSettings(s as Settings);
      setToggleReheat(!!s.enabled);
      setToggleLive(!!s.live_dispatch_enabled);
    }
    const { data: tg } = await (supabase as any)
      .from("automation_toggles")
      .select("key, enabled")
      .in("key", ["cadence_engine", "daily_reheat"]);
    for (const t of (tg as ToggleRow[]) || []) {
      if (t.key === "cadence_engine") setToggleCadence(!!t.enabled);
      if (t.key === "daily_reheat") setToggleReheat((prev) => !!t.enabled || prev);
    }
  }, [admin]);

  useEffect(() => {
    void loadQueue();
    void loadAdmin();
    const t = setInterval(() => void loadQueue(), 30_000);
    return () => clearInterval(t);
  }, [loadQueue, loadAdmin]);

  useEffect(() => {
    if (controlled || !demoSpin || liveNovo != null || liveFrio != null || liveLongo != null) return;
    const t = setInterval(() => {
      setDemoNovo((i) => (i + 1) % CYCLE_NOVO_STEPS.length);
      setDemoFrio((i) => (i + 1) % CYCLE_FRIO_STEPS.length);
      setDemoLongo((i) => (i + 1) % CYCLE_LONGO_STEPS.length);
    }, 2400);
    return () => clearInterval(t);
  }, [controlled, demoSpin, liveNovo, liveFrio, liveLongo]);

  const idxNovo = activeNovo ?? liveNovo ?? (demoSpin ? demoNovo : -1);
  const idxFrio = activeFrio ?? liveFrio ?? (demoSpin ? demoFrio : -1);
  const idxLongo = activeLongo ?? liveLongo ?? (demoSpin ? demoLongo : -1);
  const total = countNovo + countFrio + countLongo;

  const statusBadge = useMemo(() => {
    if (!admin || !settings) return null;
    if (!settings.enabled || !toggleReheat) return { label: "Desligado", cls: "bg-muted text-muted-foreground" };
    if (!settings.live_dispatch_enabled) return { label: "Só planejando", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" };
    return { label: "Ao vivo", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" };
  }, [admin, settings, toggleReheat]);

  const saveToggle = async (key: "cadence_engine" | "daily_reheat", value: boolean) => {
    setSavingKey(key);
    try {
      await (supabase as any)
        .from("automation_toggles")
        .update({ enabled: value, updated_at: new Date().toISOString() })
        .eq("key", key);
      if (key === "cadence_engine") setToggleCadence(value);
      if (key === "daily_reheat") {
        setToggleReheat(value);
        await (supabase as any)
          .from("daily_reheat_settings")
          .update({ enabled: value, updated_at: new Date().toISOString() })
          .eq("id", "global");
        setSettings((prev) => (prev ? { ...prev, enabled: value } : prev));
      }
      toast({ title: value ? "Ligado" : "Desligado", description: key });
    } catch (e: any) {
      toast({ title: "Falha ao salvar", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setSavingKey(null);
    }
  };

  const saveSettings = async (patch: Partial<Settings>) => {
    setSavingKey("settings");
    try {
      await (supabase as any)
        .from("daily_reheat_settings")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", "global");
      setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
      if (patch.live_dispatch_enabled != null) setToggleLive(!!patch.live_dispatch_enabled);
      toast({ title: "Salvo" });
    } catch (e: any) {
      toast({ title: "Falha ao salvar", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setSavingKey(null);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const { data, error } = await (supabase as any).functions.invoke("daily-reheat-cron", {
        body: { source: "admin-cockpit" },
      });
      if (error) throw error;
      toast({
        title: "Ciclo executado",
        description: `Planejados: ${data?.planned ?? 0} · Despachados: ${data?.dispatched ?? 0}`,
      });
      await loadQueue();
    } catch (e: any) {
      toast({ title: "Falha ao rodar", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="premium-card h-full">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="font-heading font-bold text-foreground flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-primary shrink-0" />
            Ciclo A · B · C
            {statusBadge && (
              <Badge className={cn("ml-1 text-[10px] font-semibold", statusBadge.cls)}>
                {statusBadge.label}
              </Badge>
            )}
          </h3>
          <p className="text-xs text-muted-foreground">
            {loading
              ? "Carregando filas…"
              : total > 0
                ? `${total} no radar · A ${countNovo} · B ${countFrio} · C ${countLongo}${
                    admin ? ` · cadência devida hoje: ${cadenceDueToday}` : ""
                  }`
                : "Ninguém no ciclo A/B/C agora"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {admin && (
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => void runNow()}
              disabled={running}
            >
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Rodar ciclo agora
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            onClick={() => {
              try { sessionStorage.setItem("igreen-voz-subtab", "multichannel"); } catch { /* noop */ }
              window.dispatchEvent(new CustomEvent("igreen-admin-nav", { detail: { tab: "voz" } }));
              window.dispatchEvent(new CustomEvent("igreen-voz-subtab", { detail: { sub: "multichannel" } }));
            }}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Editar mensagens
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            onClick={() => {
              try { sessionStorage.setItem("igreen-voz-subtab", "kit"); } catch { /* noop */ }
              window.dispatchEvent(new CustomEvent("igreen-admin-nav", { detail: { tab: "voz" } }));
              window.dispatchEvent(new CustomEvent("igreen-voz-subtab", { detail: { sub: "kit" } }));
            }}
          >
            <Mic className="w-3.5 h-3.5" />
            Áudios
          </Button>
          {admin && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={() => { window.location.href = "/admin/motor"; }}
            >
              <Settings2 className="w-3.5 h-3.5" />
              Estágios
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 text-xs gap-1.5"
            onClick={() => void loadQueue()}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            Atualizar
          </Button>
        </div>
      </div>

      {admin && settings && (
        <div className="mb-4 rounded-lg border bg-muted/20 p-3 grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={toggleCadence}
              onCheckedChange={(v) => void saveToggle("cadence_engine", v)}
              disabled={savingKey === "cadence_engine"}
            />
            <div>
              <div className="font-semibold text-foreground">Motor de cadência</div>
              <div className="text-[10px] text-muted-foreground">Grupo B + C (24/7)</div>
            </div>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={toggleReheat && settings.enabled}
              onCheckedChange={(v) => void saveToggle("daily_reheat", v)}
              disabled={savingKey === "daily_reheat"}
            />
            <div>
              <div className="font-semibold text-foreground">Ciclo diário em lote</div>
              <div className="text-[10px] text-muted-foreground">A ilimitado · B no cap · 09h–18h30</div>
            </div>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={toggleLive}
              onCheckedChange={(v) => void saveSettings({ live_dispatch_enabled: v })}
              disabled={savingKey === "settings"}
            />
            <div>
              <div className="font-semibold text-foreground">Envio ao vivo</div>
              <div className="text-[10px] text-muted-foreground">Off = só planeja</div>
            </div>
          </label>
          <div className="flex items-center gap-2 text-xs">
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] text-muted-foreground">Cap frio (B)/dia</Label>
              <Input
                type="number"
                min={10}
                max={200}
                value={settings.daily_whapi_cap}
                onChange={(e) => setSettings((prev) => prev ? { ...prev, daily_whapi_cap: Number(e.target.value) || 60 } : prev)}
                onBlur={() => void saveSettings({ daily_whapi_cap: Math.min(200, Math.max(10, settings.daily_whapi_cap || 60)) })}
                className="h-8 w-24"
              />
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <Label className="text-[10px] text-muted-foreground">Prioridade</Label>
              <Select
                value={settings.priority_queue}
                onValueChange={(v) => void saveSettings({ priority_queue: v as Settings["priority_queue"] })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A_then_B">Novo → Frio</SelectItem>
                  <SelectItem value="B_then_A">Frio → Novo</SelectItem>
                  <SelectItem value="A_only">Só novo</SelectItem>
                  <SelectItem value="B_only">Só frio</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-5 items-start justify-items-center">
        <PizzaRing
          title="Grupo A — Lead novo"
          subtitle="Inbound · sem teto · estado real"
          steps={CYCLE_NOVO_STEPS}
          activeIndex={idxNovo}
          peopleCount={countNovo}
          perStep={perStepA}
          compact
          onSliceClick={(step) =>
            setSlicePick({ group: "A", step, people: peopleA[step.id] || [] })
          }
        />
        <PizzaRing
          title="Grupo B — Frio"
          subtitle="D+1→D10 · no cap · estado real"
          steps={CYCLE_FRIO_STEPS}
          activeIndex={idxFrio}
          peopleCount={countFrio}
          perStep={perStepB}
          compact
          onSliceClick={(step) =>
            setSlicePick({ group: "B", step, people: peopleB[step.id] || [] })
          }
        />
        <PizzaRing
          title="Grupo C — Longo prazo"
          subtitle="Meta + recalls · no cap · estado real"
          steps={CYCLE_LONGO_STEPS}
          activeIndex={idxLongo}
          peopleCount={countLongo}
          perStep={perStepC}
          compact
          onSliceClick={(step) =>
            setSlicePick({ group: "C", step, people: peopleC[step.id] || [] })
          }
        />
      </div>

      <Sheet open={!!slicePick} onOpenChange={(open) => !open && setSlicePick(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
          <SheetHeader>
            <SheetTitle className="pr-6">
              Grupo {slicePick?.group} · {slicePick?.step.label}
            </SheetTitle>
            <SheetDescription>
              {slicePick?.people.length === 1
                ? "1 pessoa nesta etapa"
                : `${slicePick?.people.length ?? 0} pessoas nesta etapa`}
              {" · "}clique em Conversar pra abrir o chat interno
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 flex-1 overflow-y-auto space-y-2 pr-1">
            {(slicePick?.people || []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Ninguém nesta fatia agora</p>
            ) : (
              (slicePick?.people || []).map((p) => {
                const phoneCheck = p.phone ? validateBrazilPhone(p.phone) : { valid: false };
                const canChat = !!onOpenChat && phoneCheck.valid;
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/50 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate sensitive-name">
                        {p.name || "Sem nome"}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {p.phone || "Sem WhatsApp"}
                        {p.status ? ` · ${p.status}` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 shrink-0"
                      disabled={!canChat}
                      title={canChat ? "Abrir conversa interna" : "Sem telefone válido"}
                      onClick={() => {
                        if (!canChat || !p.phone) return;
                        onOpenChat?.(normalizeBrazilPhone(p.phone));
                        setSlicePick(null);
                      }}
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      Conversar
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
