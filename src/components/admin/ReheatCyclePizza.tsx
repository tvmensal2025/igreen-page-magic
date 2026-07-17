import { useCallback, useEffect, useState } from "react";
import { Mic, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export type CycleStep = {
  id: string;
  label: string;
  short: string;
};

/**
 * Fila A — lead novo (tráfego).
 * Chega → espera 5 min → abre atendimento (texto/áudio) → fluxo.
 * Silêncio → ligação / SMS → fecha + nota.
 */
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

/** Fila B — lead frio (reaquecer) */
export const CYCLE_FRIO_STEPS: CycleStep[] = [
  { id: "call1", label: "1ª ligação", short: "Liga" },
  { id: "open", label: "Abre + áudio do dia", short: "Abre" },
  { id: "retry", label: "Retry se NA", short: "Retry" },
  { id: "sms", label: "SMS se NA", short: "SMS" },
  { id: "wait", label: "Aguarda → fluxo", short: "Espera" },
  { id: "close", label: "Fecha + nota", short: "Fecha" },
];

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function cycleDateBRT(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}

function PizzaRing({
  title,
  subtitle,
  steps,
  activeIndex,
  peopleCount,
}: {
  title: string;
  subtitle: string;
  steps: CycleStep[];
  activeIndex: number;
  /** Quantidade de pessoas no ciclo desta fila hoje */
  peopleCount: number;
}) {
  const n = steps.length;
  const size = 420;
  const cx = size / 2;
  const cy = size / 2;
  const r = 118;
  const hole = 58;
  const labelR = 168;
  const countLabel =
    peopleCount === 1 ? "1 pessoa" : `${peopleCount} pessoas`;

  return (
    <div className="flex flex-col items-center gap-2.5 min-w-0 w-full">
      <div className="text-center">
        <p className="font-heading font-bold text-base text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground leading-tight">{subtitle}</p>
        <p className="mt-1 text-sm font-semibold tabular-nums text-primary">
          {countLabel} no ciclo
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
          const on = i <= activeIndex;
          const current = i === activeIndex;
          return (
            <path
              key={s.id}
              d={`M ${cx} ${cy} L ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y} Z`}
              className={cn("transition-all duration-500 ease-out", on ? "fill-primary" : "fill-muted")}
              style={{ opacity: current ? 1 : on ? 0.65 : 0.22 }}
            />
          );
        })}

        <circle cx={cx} cy={cy} r={hole} className="fill-card" />

        {steps.map((s, i) => {
          const ang = (360 / n) * i + 360 / n / 2;
          const p = polar(cx, cy, labelR, ang);
          const on = i <= activeIndex;
          const current = i === activeIndex;
          return (
            <text
              key={`l-${s.id}`}
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="transition-all duration-300"
              style={{
                fontSize: current ? 15 : 13,
                fontWeight: current ? 700 : 500,
                fill: current
                  ? "hsl(var(--foreground))"
                  : on
                    ? "hsl(var(--foreground) / 0.75)"
                    : "hsl(var(--muted-foreground))",
              }}
            >
              {s.short}
            </text>
          );
        })}

        {/* Centro: quantidade de pessoas */}
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

      <p className="text-sm text-center text-muted-foreground leading-snug px-2 max-w-[280px]">
        <span className="font-semibold text-foreground">{activeIndex + 1}.</span>{" "}
        {steps[activeIndex]?.label}
      </p>
    </div>
  );
}

interface ReheatCyclePizzaProps {
  activeNovo?: number;
  activeFrio?: number;
  demoSpin?: boolean;
  /** Se passado, lê fila real de daily_reheat_queue (hoje BRT). */
  consultantId?: string;
}

/**
 * Ciclo diário — 2 pizzas (Novo | Frio) com contagem de pessoas no ciclo.
 */
export function ReheatCyclePizza({
  activeNovo,
  activeFrio,
  demoSpin = true,
  consultantId,
}: ReheatCyclePizzaProps) {
  const controlled = activeNovo != null || activeFrio != null;
  const [demoNovo, setDemoNovo] = useState(0);
  const [demoFrio, setDemoFrio] = useState(0);
  const [liveNovo, setLiveNovo] = useState<number | null>(null);
  const [liveFrio, setLiveFrio] = useState<number | null>(null);
  const [countNovo, setCountNovo] = useState(0);
  const [countFrio, setCountFrio] = useState(0);
  const [loadingCounts, setLoadingCounts] = useState(!!consultantId);

  const loadQueue = useCallback(async () => {
    if (!consultantId) {
      setCountNovo(0);
      setCountFrio(0);
      setLoadingCounts(false);
      return;
    }
    setLoadingCounts(true);
    const cycleDate = cycleDateBRT();
    // Em atendimento / no ciclo hoje: planned + claimed (ainda ativos). done = já passou.
    const { data } = await (supabase as any)
      .from("daily_reheat_queue")
      .select("queue, step, status")
      .eq("consultant_id", consultantId)
      .eq("cycle_date", cycleDate)
      .in("status", ["planned", "claimed"])
      .limit(500);

    const rows = (data as { queue: string; step: string; status: string }[]) || [];
    const rowsA = rows.filter((r) => r.queue === "A");
    const rowsB = rows.filter((r) => r.queue === "B");
    setCountNovo(rowsA.length);
    setCountFrio(rowsB.length);

    // Passo mais comum na fila (moda) para destacar na pizza
    const modeStep = (list: { step: string }[]) => {
      if (list.length === 0) return null;
      const freq = new Map<string, number>();
      for (const r of list) freq.set(r.step, (freq.get(r.step) || 0) + 1);
      let best = list[0].step;
      let bestN = 0;
      for (const [k, v] of freq) {
        if (v > bestN) {
          best = k;
          bestN = v;
        }
      }
      return best;
    };

    const stepA = modeStep(rowsA);
    const stepB = modeStep(rowsB);
    if (stepA) {
      const idx = CYCLE_NOVO_STEPS.findIndex((s) => s.id === stepA);
      setLiveNovo(idx >= 0 ? idx : 2);
    } else {
      setLiveNovo(null);
    }
    if (stepB) {
      const idx = CYCLE_FRIO_STEPS.findIndex((s) => s.id === stepB);
      setLiveFrio(idx >= 0 ? idx : 0);
    } else {
      setLiveFrio(null);
    }
    setLoadingCounts(false);
  }, [consultantId]);

  useEffect(() => {
    void loadQueue();
    if (!consultantId) return;
    const t = setInterval(() => void loadQueue(), 60_000);
    return () => clearInterval(t);
  }, [consultantId, loadQueue]);

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

  return (
    <div className="premium-card h-full">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="font-heading font-bold text-foreground flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-primary shrink-0" />
            Ciclo diário
          </h3>
          <p className="text-xs text-muted-foreground">
            {loadingCounts
              ? "Carregando fila de hoje…"
              : total > 0
                ? `${total} pessoa${total === 1 ? "" : "s"} em atendimento hoje · Novo ${countNovo} · Frio ${countFrio}`
                : "Ninguém no ciclo hoje · Novo: abre + fluxo · Frio: liga + áudio"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => {
              try {
                sessionStorage.setItem("igreen-voz-subtab", "kit");
              } catch {
                /* noop */
              }
              window.dispatchEvent(
                new CustomEvent("igreen-admin-nav", { detail: { tab: "voz" } }),
              );
              window.dispatchEvent(
                new CustomEvent("igreen-voz-subtab", { detail: { sub: "kit" } }),
              );
            }}
          >
            <Mic className="w-3.5 h-3.5" />
            Colocar áudios
          </Button>
          {consultantId && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => void loadQueue()}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Atualizar
            </Button>
          )}
          {!controlled && liveNovo == null && liveFrio == null && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => {
                setDemoNovo((i) => (i + 1) % CYCLE_NOVO_STEPS.length);
                setDemoFrio((i) => (i + 1) % CYCLE_FRIO_STEPS.length);
              }}
            >
              Girar
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-6 items-start justify-items-center">
        <PizzaRing
          title="Lead novo"
          subtitle="Fila A · tráfego"
          steps={CYCLE_NOVO_STEPS}
          activeIndex={idxNovo}
          peopleCount={countNovo}
        />
        <PizzaRing
          title="Lead frio"
          subtitle="Fila B · reaquecer"
          steps={CYCLE_FRIO_STEPS}
          activeIndex={idxFrio}
          peopleCount={countFrio}
        />
      </div>
    </div>
  );
}
