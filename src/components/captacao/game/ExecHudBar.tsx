import { TrendingUp, Calendar, Flame, Target, CheckCircle2 } from "lucide-react";
import type { GameProgress } from "./useGameProgress";

/**
 * Faixa horizontal compacta que funde PlayerHud + QuestsBar numa única linha
 * de ~44px (era ~96px somados). Libera espaço vertical para a lista de leads
 * e o feed "ao vivo" no modo Performance.
 */
export function ExecHudBar({ progress }: { progress: GameProgress }) {
  const { level, rank, xpInLevel, xpToNext, progressPct, streak, todayCount, weekCount } = progress;
  const isOnFire = streak >= 3;

  const goals = [
    { id: "today3", label: "3 hoje", current: todayCount, target: 3 },
    { id: "streak5", label: "5 dias", current: streak, target: 5 },
    { id: "week10", label: "10 semana", current: weekCount, target: 10 },
  ];

  return (
    <div className="relative rounded-lg border exec-border-gold bg-card/85 backdrop-blur-md px-2.5 h-11 hidden md:flex items-center gap-3 overflow-hidden">
      {/* Linha dourada superior */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-warning/60 to-transparent" />

      {/* Medalha + Nível */}
      <div className="relative shrink-0 flex items-center gap-2">
        <div className={`w-7 h-7 rounded-md bg-gradient-to-br from-warning/25 to-primary/10 border border-warning/30 flex items-center justify-center ${isOnFire ? "animate-exec-rank" : ""}`}>
          <TrendingUp className="w-3.5 h-3.5 text-warning" strokeWidth={2} />
        </div>
        <div className="leading-tight">
          <span className={`block text-[10px] font-black uppercase tracking-wider ${rank.color}`}>{rank.label}</span>
          <span className="block text-[9px] font-mono text-muted-foreground tabular-nums">Nv {level} · {xpInLevel}/{xpToNext}</span>
        </div>
      </div>

      {/* Barra XP */}
      <div className="hidden sm:block flex-1 min-w-[80px] max-w-[180px]">
        <div className="relative h-1.5 rounded-full bg-secondary overflow-hidden border border-border/40">
          <div
            className={`absolute inset-y-0 left-0 bg-gradient-to-r from-primary to-warning transition-all duration-700 ease-out rounded-full ${progressPct > 0 ? "exec-bar-active" : ""}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Metas inline */}
      <div className="hidden md:flex items-center gap-1.5 flex-1 min-w-0">
        {goals.map((g) => {
          const done = g.current >= g.target;
          const pct = Math.min(100, Math.round((g.current / g.target) * 100));
          return (
            <div
              key={g.id}
              className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[10px] font-semibold tabular-nums shrink-0 ${
                done
                  ? "border-warning/40 bg-warning/10 text-warning"
                  : "border-border/50 bg-background/40 text-muted-foreground"
              }`}
            >
              {done ? <CheckCircle2 className="w-3 h-3 text-warning" /> : <Target className="w-2.5 h-2.5" />}
              <span>{g.label}</span>
              <div className="w-8 h-1 rounded-full bg-secondary overflow-hidden">
                <div className={`h-full ${done ? "bg-gradient-to-r from-warning to-warning" : "bg-primary"}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Spacer para mobile */}
      <div className="md:hidden flex-1" />

      {/* Hoje + Sequência */}
      <div className="flex items-center gap-1 shrink-0 ml-auto">
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-primary/25 bg-primary/10 text-primary">
          <Calendar className="w-3 h-3" strokeWidth={2} />
          <span className="text-[10px] font-bold tabular-nums">{todayCount}</span>
        </div>
        <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded border ${isOnFire ? "bg-warning/15 border-warning/40 text-warning animate-exec-energy" : "bg-secondary border-border/40 text-warning/70"}`}>
          <Flame className="w-3 h-3" strokeWidth={2} />
          <span className="text-[10px] font-bold tabular-nums">{streak}</span>
        </div>
      </div>
    </div>
  );
}
