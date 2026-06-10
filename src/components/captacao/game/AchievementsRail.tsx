import { CheckCircle2, Lock } from "lucide-react";
import type { GameProgress } from "./useGameProgress";

interface Milestone { id: string; label: string; unlocked: boolean; hint: string; }

export function AchievementsRail({ progress }: { progress: GameProgress }) {
  const { totalXp, level, streak, todayCount, weekCount } = progress;
  const leads = totalXp / 10;

  const milestones: Milestone[] = [
    { id: "first",   label: "Primeiro Cadastro",  unlocked: leads >= 1,      hint: "Registre o primeiro cliente" },
    { id: "five",    label: "5 Cadastros",         unlocked: leads >= 5,      hint: "Chegue a 5 registros" },
    { id: "daily5",  label: "5 em um Dia",         unlocked: todayCount >= 5, hint: "5 cadastros em um único dia" },
    { id: "daily3",  label: "3 Seguidos Hoje",     unlocked: todayCount >= 3, hint: "3 cadastros no mesmo dia" },
    { id: "streak7", label: "7 Dias Ativos",       unlocked: streak >= 7,     hint: "7 dias consecutivos" },
    { id: "week10",  label: "10 na Semana",        unlocked: weekCount >= 10, hint: "10 cadastros em 7 dias" },
    { id: "level5",  label: "Nível Especialista",  unlocked: level >= 5,      hint: "Alcance o nível 5" },
    { id: "level10", label: "Nível Diretor",       unlocked: level >= 10,     hint: "Alcance o nível 10" },
    { id: "level20", label: "Nível Elite",         unlocked: level >= 20,     hint: "Alcance o nível 20" },
  ];

  const unlockedCount = milestones.filter((m) => m.unlocked).length;

  return (
    <div className="rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm p-3 h-full">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Marcos de Carreira
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
          {unlockedCount}/{milestones.length}
        </span>
      </div>

      {/* Progress line */}
      <div className="relative h-1 rounded-full bg-secondary mb-3 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary to-warning rounded-full transition-all duration-700 exec-bar-active"
          style={{ width: `${Math.round((unlockedCount / milestones.length) * 100)}%` }}
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        {milestones.map((m, i) => (
          <div
            key={m.id}
            title={`${m.label} — ${m.hint}`}
            className={`relative aspect-square rounded-lg border flex flex-col items-center justify-center p-1.5 transition-all ${
              m.unlocked
                ? "border-warning/40 bg-gradient-to-br from-warning/10 to-warning/3 shadow-[0_0_10px_hsl(45_85%_52%/0.15)] animate-exec-card"
                : "border-border/40 bg-secondary/30 opacity-50"
            }`}
            style={m.unlocked ? { animationDelay: `${i * 0.05}s` } : undefined}
          >
            {m.unlocked ? (
              <CheckCircle2 className="w-5 h-5 text-warning mb-0.5" />
            ) : (
              <Lock className="w-4 h-4 text-muted-foreground/40 mb-0.5" />
            )}
            <span className={`text-[8px] font-semibold text-center leading-tight ${
              m.unlocked ? "text-warning/90" : "text-muted-foreground/50"
            }`}>
              {m.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
