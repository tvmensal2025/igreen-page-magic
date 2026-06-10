import { TrendingUp, Calendar, BarChart2 } from "lucide-react";
import type { GameProgress } from "./useGameProgress";

export function PlayerHud({ progress }: { progress: GameProgress }) {
  const { level, rank, xpInLevel, xpToNext, progressPct, streak, todayCount } = progress;
  const isOnFire = streak >= 3;

  return (
    <div className="relative rounded-lg border border-border/60 bg-card/80 backdrop-blur-md px-2.5 py-1.5 overflow-hidden exec-ambient">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-warning/40 to-transparent" />

      <div className="relative flex items-center gap-3 flex-wrap">
        <div className="relative shrink-0">
          <div className={`w-8 h-8 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center ${isOnFire ? "animate-exec-rank" : ""}`}>
            <TrendingUp className="w-4 h-4 text-primary" strokeWidth={1.5} />
          </div>
          <span className="absolute -bottom-1 -right-1 bg-warning text-warning text-[9px] font-black rounded w-5 h-4 flex items-center justify-center border border-card tabular-nums">
            {level}
          </span>
        </div>

        <div className="flex-1 min-w-[180px]">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-black uppercase tracking-wide ${rank.color}`}>{rank.label}</span>
            <span className="text-[9px] font-mono text-muted-foreground">Nv {level}</span>
            <span className="text-[9px] font-mono tabular-nums text-muted-foreground ml-auto">{xpInLevel}/{xpToNext} pts</span>
          </div>
          <div className="relative h-1.5 rounded-full bg-secondary overflow-hidden border border-border/40">
            <div
              className={`absolute inset-y-0 left-0 bg-gradient-to-r from-primary to-primary transition-all duration-700 ease-out rounded-full ${progressPct > 0 ? "exec-bar-active" : ""}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 border border-primary/20 text-primary">
            <Calendar className="w-3 h-3" strokeWidth={1.5} />
            <span className="text-[10px] font-bold tabular-nums">{todayCount}</span>
            <span className="text-[8px] uppercase opacity-60">hoje</span>
          </div>
          <div className={`flex items-center gap-1 px-2 py-1 rounded-md border text-warning ${isOnFire ? "bg-warning/15 border-warning/30 animate-exec-energy" : "bg-secondary border-border/40"}`}>
            <BarChart2 className="w-3 h-3" strokeWidth={1.5} />
            <span className="text-[10px] font-bold tabular-nums">{streak}</span>
            <span className="text-[8px] uppercase opacity-60">dias</span>
          </div>
        </div>
      </div>
    </div>
  );
}
