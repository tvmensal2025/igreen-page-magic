import { Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import { CaptureProgressBar } from "./CaptureProgressBar";
import { CaptureComboIndicator } from "./CaptureComboIndicator";
import type { LevelTier } from "@/hooks/useCaptureGameState";
import { isSfxEnabled, setSfxEnabled } from "@/lib/captureSfx";

interface Props {
  tier: LevelTier;
  combo: number;
  xp: number;
  filled: number;
  total: number;
  progress: number;
  missionLabel: string;
  canSubmit: boolean;
}

export function CaptureHud({ tier, combo, xp, filled, total, progress, missionLabel, canSubmit }: Props) {
  const [sfx, setSfx] = useState(isSfxEnabled());
  return (
    <div className={`px-2 py-1.5 border-b border-border space-y-1 relative ${
      canSubmit ? "bg-gradient-to-br from-primary/6 via-transparent to-warning/6" : "bg-card/40"
    }`}>
      {canSubmit && (
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className={`text-[9px] font-black uppercase tracking-wider px-1 py-px rounded ${tier.color || "bg-secondary text-foreground"}`}>{tier.name}</span>
          <span className="text-[10px] text-muted-foreground tabular-nums truncate">
            <span className="font-bold text-foreground">{filled}/{total}</span> · {xp}pts
          </span>
          <CaptureComboIndicator combo={combo} />
        </div>
        <button
          onClick={() => { const v = !sfx; setSfx(v); setSfxEnabled(v); }}
          className="p-0.5 rounded hover:bg-secondary text-muted-foreground/60 transition-colors shrink-0"
          title={sfx ? "Som ativado" : "Som desativado"}
        >
          {sfx ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
        </button>
      </div>

      <CaptureProgressBar progress={progress} filled={filled} total={total} tier={tier} />
      {missionLabel && (
        <p className="text-[9px] text-muted-foreground/70 truncate leading-tight">{missionLabel}</p>
      )}
    </div>
  );
}
