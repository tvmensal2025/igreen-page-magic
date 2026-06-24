import type { SolarPanelPosition, SolarRoofSegment } from "../lib/types";

/** Vista 2D simplificada — painéis sobre faces do telhado (MVP leve, mobile-friendly). */
export function SolarMap2D({
  panelPositions,
  roofSegments,
  className = "",
}: {
  panelPositions: SolarPanelPosition[];
  roofSegments: SolarRoofSegment[];
  className?: string;
}) {
  const cols = 8;
  const rows = 6;
  return (
    <div
      className={`relative aspect-[4/3] rounded-xl overflow-hidden border bg-gradient-to-b from-sky-100 to-emerald-50 dark:from-slate-800 dark:to-slate-900 ${className}`}
    >
      <div className="absolute inset-0 opacity-30 bg-[linear-gradient(135deg,#94a3b8_12%,transparent_12%)] bg-[length:24px_24px]" />
      {roofSegments.map((seg) => (
        <div
          key={`seg-${seg.index}`}
          className="absolute border-2 border-amber-700/40 bg-amber-100/30 rounded-sm"
          style={{
            left: `${12 + (seg.index % 2) * 38}%`,
            top: `${18 + Math.floor(seg.index / 2) * 28}%`,
            width: "36%",
            height: "22%",
            transform: `skewY(-${Math.min(12, seg.pitchDegrees ?? 8)}deg)`,
          }}
          title={`Face ${seg.index + 1}${seg.areaM2 ? ` · ${seg.areaM2.toFixed(0)} m²` : ""}`}
        />
      ))}
      <div className="absolute inset-4 grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {panelPositions.slice(0, cols * rows).map((p) => (
          <div
            key={p.index}
            className="rounded-[2px] bg-slate-800/90 border border-slate-600 shadow-sm min-h-[10px]"
            title={`Módulo ${p.index + 1}`}
          />
        ))}
      </div>
      <div className="absolute bottom-2 left-2 right-2 text-[10px] text-center text-muted-foreground bg-background/70 rounded px-2 py-1">
        Prévia ilustrativa · {panelPositions.length} módulos no layout
      </div>
    </div>
  );
}
