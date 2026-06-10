import { Calendar, BarChart2, TrendingUp } from "lucide-react";

interface Props { today: number; week: number; streak: number; }

export function CaptureScoreboard({ today, week, streak }: Props) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/8 border border-primary/20">
        <Calendar className="w-3.5 h-3.5 text-primary" strokeWidth={1.5} />
        <span className="text-muted-foreground text-[10px]">Hoje</span>
        <span className="font-bold text-primary tabular-nums">{today}</span>
      </div>
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary border border-border/40">
        <BarChart2 className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={1.5} />
        <span className="text-muted-foreground text-[10px]">Semana</span>
        <span className="font-bold tabular-nums">{week}</span>
      </div>
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary border border-border/40">
        <TrendingUp className={`w-3.5 h-3.5 ${streak > 0 ? "text-warning" : "text-muted-foreground"}`} strokeWidth={1.5} />
        <span className="text-muted-foreground text-[10px]">Sequência</span>
        <span className="font-bold tabular-nums">{streak}d</span>
      </div>
    </div>
  );
}
