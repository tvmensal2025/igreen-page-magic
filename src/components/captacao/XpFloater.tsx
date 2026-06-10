import type { XpEvent } from "@/hooks/useCaptureGameState";

interface Props { events: XpEvent[]; }

export function XpFloater({ events }: Props) {
  return (
    <div className="pointer-events-none fixed top-1/2 right-8 z-[60] flex flex-col items-end gap-1">
      {events.map((e) => (
        <div
          key={e.id}
          className={`px-3 py-1.5 rounded-lg font-bold text-xs shadow-lg backdrop-blur-sm border animate-exec-float ${
            e.source === "level"
              ? "bg-warning/95 text-warning border-warning/60 shadow-[0_0_20px_hsl(45_85%_52%/0.4)]"
              : e.source === "submit"
              ? "bg-primary/95 text-primary-foreground border-primary/40 shadow-[0_0_16px_hsl(var(--primary)/0.4)]"
              : "bg-card/95 text-foreground border-border/60"
          }`}
        >
          {e.label || `+${e.amount} pts`}
        </div>
      ))}
    </div>
  );
}
