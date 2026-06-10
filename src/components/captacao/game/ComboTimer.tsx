// Sequence timer — shown when the consultant has an active performance streak.
// Displays:
//   - Sequence level (×1, ×2, ×3...)
//   - Countdown bar
//   - Bonus points available
//
// Compact (mobile) and expanded (desktop) variants.

import { Zap, Clock } from "lucide-react";

interface Props {
  level: number;
  secondsLeft: number;
  progressPct: number;
  bonusXp: number;
  compact?: boolean;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function ComboTimer({ level, secondsLeft, progressPct, bonusXp, compact }: Props) {
  if (level < 1) return null;

  // Visual tier based on sequence level
  const tier = level >= 4 ? "elite" : level >= 3 ? "senior" : level >= 2 ? "specialist" : "base";

  const containerClass = {
    base:       "border-primary/30 from-primary/10 to-primary/3",
    specialist: "border-warning/40 from-warning/12 to-warning/3",
    senior:     "border-warning/60 from-warning/18 to-warning/5 animate-exec-energy",
    elite:      "border-primary/60 from-primary/20 to-primary/8 animate-exec-energy",
  }[tier];

  const accentClass = {
    base:       "text-primary",
    specialist: "text-warning",
    senior:     "text-warning",
    elite:      "text-primary",
  }[tier];

  const barClass = {
    base:       "bg-primary",
    specialist: "bg-gradient-to-r from-warning to-warning",
    senior:     "bg-gradient-to-r from-warning to-warning",
    elite:      "bg-gradient-to-r from-primary to-primary",
  }[tier];

  if (compact) {
    return (
      <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md border bg-gradient-to-r ${containerClass}`}>
        <Zap className={`w-3 h-3 ${accentClass}`} strokeWidth={2} />
        <span className="text-[10px] font-black tabular-nums">×{level + 1}</span>
        <span className="text-[9px] tabular-nums text-muted-foreground">{formatTime(secondsLeft)}</span>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-xl border bg-gradient-to-br ${containerClass} p-2.5`}>
      {/* Top accent line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-warning/40 to-transparent" />

      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center shrink-0`}>
          <Zap className={`w-4 h-4 ${accentClass}`} strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-black tabular-nums uppercase tracking-wide">
              Sequência ×{level + 1}
            </span>
            {bonusXp > 0 && (
              <span className={`text-[10px] font-bold ${accentClass}`}>
                +{bonusXp} pts bônus
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
            <Clock className="w-3 h-3" strokeWidth={1.5} />
            <span>{formatTime(secondsLeft)} restantes</span>
          </div>
        </div>
      </div>

      <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className={`h-full transition-[width] duration-1000 ease-linear rounded-full ${barClass}`}
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}
