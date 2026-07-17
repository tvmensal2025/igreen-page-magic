import { useCallback, useEffect, useMemo, useState } from "react";
import { Mic, RefreshCw, Play, Settings2, MessageSquare, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type CycleStep = { id: string; label: string; short: string };

export const CYCLE_NOVO_STEPS: CycleStep[] = [
  { id: "arrive", label: "Lead chegou", short: "Chegou" },
  { id: "wait5", label: "Aguarda 5 min", short: "5 min" },
  { id: "open", label: "Abre + áudio humano", short: "Abre" },
  { id: "flow", label: "Inicia fluxo F", short: "Fluxo" },
  { id: "wait2h", label: "Silêncio ~2h", short: "Silêncio" },
  { id: "call1", label: "1ª ligação", short: "Liga" },
  { id: "retry", label: "Retry se NA", short: "Retry" },
  { id: "sms", label: "SMS se NA", short: "SMS" },
  { id: "close", label: "Fecha + nota", short: "Fecha" },
];

export const CYCLE_FRIO_STEPS: CycleStep[] = [
  { id: "call1", label: "1ª ligação", short: "Liga" },
  { id: "open", label: "Abre + áudio do dia", short: "Abre" },
  { id: "retry", label: "Retry se NA", short: "Retry" },
  { id: "sms", label: "SMS se NA", short: "SMS" },
  { id: "wait", label: "Aguarda → fluxo", short: "Espera" },
  { id: "close", label: "Fecha + nota", short: "Fecha" },
];

// Mapeamento lead_cadence_state.stage (motor unitário) → fatias da Fila B
const CADENCE_TO_FRIO: Record<string, string> = {
  COLD_1: "open",
  COLD_2: "open",
  COLD_3: "wait",
  COLD_4: "wait",
  CALL_1: "call1",
  CALL_2: "retry",
  CALL_3: "retry",
  SMS_1: "sms",
  SMS_2: "sms",
};

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function cycleDateBRT(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function PizzaRing({
  title,
  subtitle,
  steps,
  activeIndex,
  peopleCount,
  perStep,
}: {
  title: string;
  subtitle: string;
  steps: CycleStep[];
  activeIndex: number;
  peopleCount: number;
  perStep: Record<string, number>;
}) {
  const n = steps.length;
  const size = 420;
  const cx = size / 2;
  const cy = size / 2;
  const r = 118;
  const hole = 58;
  const labelR = 168;

  return (
    <div className="flex flex-col items-center gap-2.5 min-w-0 w-full">
      <div className="text-center">
        <p className="font-heading font-bold text-base text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground leading-tight">{subtitle}</p>
        <p className="mt-1 text-sm font-semibold tabular-nums text-primary">
          {peopleCount === 1 ? "1 pessoa" : `${peopleCount} pessoas`} no ciclo
        </p>
      </div>

      <svg
        width={400}
        height={400}
        viewBox={`0 0 ${size} ${size}`}
        className="shrink-0 w-full max-w-[400px] h-auto"
        aria-hidden
      >
        {steps.map((s, i) => {
          const a0 = (360 / n) * i + 1;
          const a1 = (360 / n) * (i + 1) - 1;
          const p1 = polar(cx, cy, r, a0);
          const p2 = polar(cx, cy, r, a1);
          const large = a1 - a0 > 180 ? 1 : 0;
          const has = (perStep[s.id] || 0) > 0;
          const current = i === activeIndex;
          return (
            <path
              key={s.id}
              d={`M ${cx} ${cy} L ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y} Z`}
              className={cn("transition-all duration-500 ease-out", has ? "fill-primary" : "fill-muted")}
              style={{ opacity: current ? 1 : has ? 0.7 : 0.22 }}
            />
          );
        })}

        <circle cx={cx} cy={cy} r={hole} className="fill-card" />

        {steps.map((s, i) => {
          const ang = (360 / n) * i + 360 / n / 2;
          const p = polar(cx, cy, labelR, ang);
          const has = (perStep[s.id] || 0) > 0;
          const current = i === activeIndex;
          const count = perStep[s.id] || 0;
          return (
            <g key={`l-${s.id}`}>
              <text
                x={p.x}
                y={p.y - 6}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  fontSize: current ? 14 : 12,
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
                  fontSize: 11,
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
          style={{ fontSize: 28, fontWeight: 800, fill: "hsl(var(--foreground))" }}
        >
          {peopleCount}
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          style={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
        >
          {peopleCount === 1 ? "pessoa" : "pessoas"}
        </text>
        <text
          x={cx}
          y={cy + 28}
          textAnchor="middle"
          style={{ fontSize: 10, fontWeight: 600, fill: "hsl(var(--primary))" }}
        >
          {steps[activeIndex]?.short ?? "—"}
        </text>
      </svg>

      {/* Linha compacta com contagem por etapa */}
      <div className="flex flex-wrap justify-center gap-1 px-2 max-w-[380px]">
        {steps.map((s) => {
          const n = perStep[s.id] || 0;
          return (
            <span
              key={`b-${s.id}`}
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-md tabular-nums border",
                n > 0
                  ? "bg-primary/10 border-primary/30 text-foreground"
                  : "bg-muted/30 border-transparent text-muted-foreground",
              )}
            >
              {s.short} {n}
            </span>
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
  demoSpin?: boolean;
  consultantId?: string;
  /** Mostrar cockpit administrativo (switches, cap, prioridade, botões de admin). */
  admin?: boolean;
}

export function ReheatCyclePizza({
  activeNovo,
  activeFrio,
  demoSpin = true,
  consultantId,
  admin = false,
}: ReheatCyclePizzaProps) {
  const { toast } = useToast();
  const controlled = activeNovo != null || activeFrio != null;
  const [demoNovo, setDemoNovo] = useState(0);
  const [demoFrio, setDemoFrio] = useState(0);
  const [liveNovo, setLiveNovo] = useState<number | null>(null);
  const [liveFrio, setLiveFrio] = useState<number | null>(null);
  const [perStepA, setPerStepA] = useState<Record<string, number>>({});
  const [perStepB, setPerStepB] = useState<Record<string, number>>({});
  const [countNovo, setCountNovo] = useState(0);
  const [countFrio, setCountFrio] = useState(0);
  const [cadenceDueToday, setCadenceDueToday] = useState(0);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  // Admin cockpit state
  const [settings, setSettings] = useState<Settings | null>(null);
  const [toggleCadence, setToggleCadence] = useState(false);
  const [toggleReheat, setToggleReheat] = useState(false);
  const [toggleLive, setToggleLive] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    const cycleDate = cycleDateBRT();

    // Fila em daily_reheat_queue
    let q = (supabase as any)
      .from("daily_reheat_queue")
      .select("queue, step, status, consultant_id")
      .eq("cycle_date", cycleDate)
      .in("status", ["planned", "claimed"])
      .limit(2000);
    if (consultantId) q = q.eq("consultant_id", consultantId);
    const { data: qRows } = await q;
    const rows = (qRows as { queue: string; step: string }[]) || [];

    const aggA: Record<string, number> = {};
    const aggB: Record<string, number> = {};
    for (const r of rows) {
      const target = r.queue === "A" ? aggA : aggB;
      target[r.step] = (target[r.step] || 0) + 1;
    }

    // Fila B também recebe leads do motor unitário (lead_cadence_state)
    let qCad = (supabase as any)
      .from("lead_cadence_state")
      .select("stage, consultant_id, next_action_at")
      .in("stage", Object.keys(CADENCE_TO_FRIO))
      .limit(2000);
    if (consultantId) qCad = qCad.eq("consultant_id", consultantId);
    const { data: cadRows } = await qCad;
    const cadList = (cadRows as { stage: string; next_action_at: string | null }[]) || [];
    for (const c of cadList) {
      const slice = CADENCE_TO_FRIO[c.stage];
      if (slice) aggB[slice] = (aggB[slice] || 0) + 1;
    }

    // Leads do motor com ação devida até fim do dia
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const due = cadList.filter((c) => c.next_action_at && new Date(c.next_action_at) <= todayEnd).length;
    setCadenceDueToday(due);

    setPerStepA(aggA);
    setPerStepB(aggB);
    const totA = Object.values(aggA).reduce((a, b) => a + b, 0);
    const totB = Object.values(aggB).reduce((a, b) => a + b, 0);
    setCountNovo(totA);
    setCountFrio(totB);

    // Etapa modal para destacar no meio
    const mode = (agg: Record<string, number>) => {
      let best: string | null = null;
      let bestN = 0;
      for (const [k, v] of Object.entries(agg)) {
        if (v > bestN) {
          best = k;
          bestN = v;
        }
      }
      return best;
    };
    const stepA = mode(aggA);
    const stepB = mode(aggB);
    setLiveNovo(stepA ? Math.max(0, CYCLE_NOVO_STEPS.findIndex((s) => s.id === stepA)) : null);
    setLiveFrio(stepB ? Math.max(0, CYCLE_FRIO_STEPS.findIndex((s) => s.id === stepB)) : null);
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
    if (controlled || !demoSpin || liveNovo != null || liveFrio != null) return;
    const t = setInterval(() => {
      setDemoNovo((i) => (i + 1) % CYCLE_NOVO_STEPS.length);
      setDemoFrio((i) => (i + 1) % CYCLE_FRIO_STEPS.length);
    }, 2400);
    return () => clearInterval(t);
  }, [controlled, demoSpin, liveNovo, liveFrio]);

  const idxNovo = activeNovo ?? liveNovo ?? demoNovo;
  const idxFrio = activeFrio ?? liveFrio ?? demoFrio;
  const total = countNovo + countFrio;

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
        // Espelha em daily_reheat_settings.enabled
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
            Ciclo diário
            {statusBadge && (
              <Badge className={cn("ml-1 text-[10px] font-semibold", statusBadge.cls)}>
                {statusBadge.label}
              </Badge>
            )}
          </h3>
          <p className="text-xs text-muted-foreground">
            {loading
              ? "Carregando fila…"
              : total > 0
                ? `${total} pessoa${total === 1 ? "" : "s"} no ciclo · Novo ${countNovo} · Frio ${countFrio}${
                    admin ? ` · CRM/cadência: ${cadenceDueToday} devidos hoje` : ""
                  }`
                : "Ninguém no ciclo hoje"}
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
              <div className="text-[10px] text-muted-foreground">9 etapas por lead 24/7</div>
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
              <div className="text-[10px] text-muted-foreground">09h–18h30 BRT</div>
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
              <Label className="text-[10px] text-muted-foreground">Limite WhatsApp/dia</Label>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-6 items-start justify-items-center">
        <PizzaRing
          title="Lead novo"
          subtitle="Fila A · tráfego"
          steps={CYCLE_NOVO_STEPS}
          activeIndex={idxNovo}
          peopleCount={countNovo}
          perStep={perStepA}
        />
        <PizzaRing
          title="Lead frio"
          subtitle="Fila B · reaquecer"
          steps={CYCLE_FRIO_STEPS}
          activeIndex={idxFrio}
          peopleCount={countFrio}
          perStep={perStepB}
        />
      </div>
    </div>
  );
}
