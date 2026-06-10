import { BarChart2, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  enabled: boolean;
  onToggle: () => void;
  sound: boolean;
  onToggleSound: () => void;
}

export function GameModeToggle({ enabled, onToggle, sound, onToggleSound }: Props) {
  return (
    <div className="flex items-center gap-2">
      {enabled && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-8 sm:w-auto px-2 gap-1 border-border/60"
          onClick={onToggleSound}
          title={sound ? "Desligar som" : "Ligar som"}
        >
          {sound ? <Volume2 className="w-3.5 h-3.5 text-primary" /> : <VolumeX className="w-3.5 h-3.5 text-muted-foreground" />}
        </Button>
      )}
      <button
        type="button"
        onClick={onToggle}
        className={`group relative inline-flex items-center justify-center gap-2 h-9 rounded-lg border transition-all w-9 sm:w-auto sm:px-3 ${
          enabled
            ? "border-warning/50 bg-gradient-to-r from-primary/15 to-warning/15 text-warning exec-toggle-on"
            : "border-border/60 bg-card hover:border-primary/30 hover:bg-primary/5 text-muted-foreground"
        }`}
        title={enabled ? "Desativar painel de performance" : "Ativar painel de performance"}
        aria-pressed={enabled}
        aria-label={enabled ? "Performance ON" : "Performance"}
      >
        <BarChart2 className={`w-4 h-4 ${enabled ? "text-warning" : ""}`} strokeWidth={1.5} />
        <span className={`hidden sm:inline text-xs font-bold tracking-wider ${enabled ? "uppercase" : ""}`}>
          {enabled ? "Performance ON" : "Performance"}
        </span>
        <span className={`hidden sm:inline relative w-8 h-4 rounded-full transition-colors ${enabled ? "bg-warning/40" : "bg-muted"}`}>
          <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${enabled ? "left-[18px]" : "left-0.5"}`} />
        </span>
      </button>

    </div>
  );
}
