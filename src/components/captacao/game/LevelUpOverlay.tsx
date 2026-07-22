import { useEffect } from "react";
import { TrendingUp } from "lucide-react";

interface Props { level: number; rankLabel: string; onClose: () => void; }

export function LevelUpOverlay({ level, rankLabel, onClose }: Props) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-background/85 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      {/* Ambient light rays */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-20"
          style={{
            background: "radial-gradient(ellipse, hsl(45 85% 52% / 0.5) 0%, transparent 70%)",
            animation: "exec-ambient 6s ease-in-out infinite",
          }}
        />
      </div>

      <div className="relative animate-exec-reveal max-w-sm w-full mx-4">
        {/* Gold top line that draws itself */}
        <div className="exec-line-draw mb-0 rounded-t-2xl" />

        <div className="rounded-b-2xl rounded-tr-2xl border border-warning/30 bg-card px-10 py-8 text-center shadow-[0_0_80px_hsl(45_85%_52%/0.2)] overflow-hidden relative">
          {/* Gold sweep on enter */}
          <div className="absolute inset-0 exec-gold-sweep pointer-events-none" />

          {/* Icon */}
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-warning/20 to-warning/5 border border-warning/30 flex items-center justify-center mx-auto mb-5 animate-exec-rank">
            <TrendingUp className="w-8 h-8 text-warning" strokeWidth={1.5} />
          </div>

          <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-warning/70 mb-2">
            Novo Nível Alcançado
          </p>

          <p className="text-6xl font-black text-foreground my-1 font-heading tabular-nums">
            {level}
          </p>

          {/* Rank label with shimmer */}
          <p className="text-base font-black uppercase tracking-widest exec-shimmer mt-1">
            {rankLabel}
          </p>

          <div className="mt-5 pt-4 border-t border-border/40">
            <p className="text-xs text-muted-foreground">
              Continue avançando para o próximo patamar
            </p>
          </div>
        </div>

        {/* Gold bottom line */}
        <div className="exec-line-draw mt-0 rounded-b-2xl" style={{ animationDelay: "0.3s" }} />
      </div>
    </div>
  );
}
