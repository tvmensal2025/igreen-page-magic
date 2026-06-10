import { CheckCircle2 } from "lucide-react";
import type { GameProgress } from "./useGameProgress";

interface Goal { id: string; label: string; pts: number; current: number; target: number; }

export function QuestsBar({ progress }: { progress: GameProgress }) {
  const { todayCount, streak, weekCount } = progress;
  const goals: Goal[] = [
    { id: "today3",  label: "3 cadastros hoje",    pts: 50,  target: 3,  current: todayCount },
    { id: "streak5", label: "5 dias consecutivos", pts: 100, target: 5,  current: streak },
    { id: "week10",  label: "10 na semana",         pts: 150, target: 10, current: weekCount },
  ];

  return (
    <div className="rounded-lg border border-border/60 bg-card/50 backdrop-blur-sm p-1.5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Metas do Dia
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
        {goals.map((g) => {
          const pct = Math.min(100, Math.round((g.current / g.target) * 100));
          const done = g.current >= g.target;
          return (
            <div
              key={g.id}
              className={`relative overflow-hidden rounded-md border px-2 py-1 ${
                done
                  ? "border-warning/40 bg-gradient-to-br from-warning/8 to-transparent"
                  : "border-border/60 bg-background/40"
              }`}
            >
              {done && <div className="absolute inset-0 exec-gold-sweep pointer-events-none" />}
              <div className="relative flex items-center justify-between mb-1 gap-2">
                <span className="text-[10px] font-semibold text-foreground/80 flex-1 leading-tight truncate">
                  {g.label}
                </span>
                {done ? (
                  <CheckCircle2 className="w-3 h-3 text-warning shrink-0" />
                ) : (
                  <span className="text-[9px] font-mono text-muted-foreground tabular-nums shrink-0">
                    {Math.min(g.current, g.target)}/{g.target}
                  </span>
                )}
              </div>
              <div className="relative h-1 rounded-full bg-secondary overflow-hidden">
                <div
                  className={`h-full transition-all duration-700 rounded-full ${
                    done ? "bg-gradient-to-r from-warning to-warning exec-bar-active" : "bg-primary"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className={`hidden md:inline text-[8px] font-bold mt-1 uppercase tracking-wider ${
                done ? "exec-shimmer" : "text-muted-foreground"
              }`}>
                +{g.pts} pts
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
