import type { SolarPanelPosition, SolarRoofSegment } from "../lib/types";
import { Sun } from "lucide-react";

/** Vista 2D do layout de painéis — visual profissional para proposta e modal. */
export function SolarMap2D({
  panelPositions,
  roofSegments,
  className = "",
}: {
  panelPositions: SolarPanelPosition[];
  roofSegments: SolarRoofSegment[];
  className?: string;
}) {
  const count = panelPositions.length;
  const cols = Math.min(10, Math.max(4, Math.ceil(Math.sqrt(count * 1.4))));
  const rows = Math.ceil(count / cols) || 1;

  return (
    <div
      className={`relative aspect-[16/10] rounded-2xl overflow-hidden border border-slate-700/20 shadow-inner ${className}`}
    >
      {/* Céu */}
      <div className="absolute inset-0 bg-gradient-to-b from-sky-400/90 via-sky-300/40 to-slate-200/80 dark:from-slate-700 dark:via-slate-800 dark:to-slate-900" />

      {/* Terreno */}
      <div className="absolute bottom-0 left-0 right-0 h-[18%] bg-gradient-to-t from-emerald-800/40 to-transparent" />

      {/* Telhado principal */}
      <div
        className="absolute left-1/2 top-[22%] w-[78%] max-w-md -translate-x-1/2"
        style={{ perspective: "600px" }}
      >
        <div
          className="relative mx-auto rounded-sm bg-gradient-to-br from-slate-600 to-slate-800 shadow-2xl border border-slate-500/50"
          style={{
            height: "42%",
            minHeight: "7rem",
            transform: "rotateX(8deg) skewY(-2deg)",
            transformStyle: "preserve-3d",
          }}
        >
          {/* Faces adicionais (segmentos) */}
          {roofSegments.slice(0, 3).map((seg, i) => (
            <div
              key={`seg-${seg.index}`}
              className="absolute border border-amber-600/30 bg-amber-900/20 rounded-[2px]"
              style={{
                left: `${8 + i * 28}%`,
                top: `${12 + (i % 2) * 8}%`,
                width: "24%",
                height: "35%",
                opacity: 0.85,
              }}
              title={seg.areaM2 ? `${seg.areaM2.toFixed(0)} m²` : undefined}
            />
          ))}

          {/* Grid de painéis */}
          <div
            className="absolute inset-[10%] grid gap-[3px] p-1"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            }}
          >
            {panelPositions.slice(0, cols * rows).map((p) => (
              <div
                key={p.index}
                className="rounded-[2px] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 border border-sky-400/30 shadow-sm min-h-[6px] ring-1 ring-white/5"
                title={`Módulo ${p.index + 1}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Badge contagem */}
      <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/55 backdrop-blur-sm px-3 py-1.5 text-white text-xs font-semibold">
        <Sun className="h-3.5 w-3.5 text-amber-300" />
        {count} módulos
      </div>

      {/* Legenda */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-4 py-3">
        <p className="text-[11px] text-center text-white/90 font-medium">
          Layout ilustrativo com base na análise de satélite
        </p>
      </div>
    </div>
  );
}
