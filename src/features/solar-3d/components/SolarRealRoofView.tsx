import { useEffect, useMemo, useState } from "react";
import { Sun, Loader2, ImageOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SolarImageryView, SolarPanelPosition } from "../lib/types";
import { buildRoofImageUrl, latLngToRelative } from "../lib/projection";

const SUPABASE_URL = "https://zlzasfhcxcznaprrragl.supabase.co";

/**
 * Mostra a imagem de SATÉLITE REAL do telhado com os painéis sobrepostos nas
 * coordenadas reais (lat/lng) retornadas pela Solar API do Google.
 * Faz fallback gracioso para o layout ilustrativo quando não há imagem.
 */
export function SolarRealRoofView({
  consultantId,
  imagery,
  panelPositions,
  className = "",
  fallback,
}: {
  consultantId?: string | null;
  imagery?: SolarImageryView | null;
  panelPositions: SolarPanelPosition[];
  className?: string;
  fallback?: React.ReactNode;
}) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [resolvedConsultant, setResolvedConsultant] = useState<string | null>(consultantId ?? null);

  // Quando não recebe consultantId, usa o usuário logado (consultor = auth.uid).
  useEffect(() => {
    if (consultantId) {
      setResolvedConsultant(consultantId);
      return;
    }
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) setResolvedConsultant(data.user?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, [consultantId]);

  const imageUrl = useMemo(() => {
    if (!resolvedConsultant || !imagery) return null;
    return buildRoofImageUrl(SUPABASE_URL, resolvedConsultant, imagery);
  }, [resolvedConsultant, imagery]);

  // Painéis projetados na imagem (apenas os com lat/lng e dentro do quadro),
  // com tamanho real (m → %) e rotação pelo azimute do telhado.
  const projected = useMemo(() => {
    if (!imagery) return [];
    const mpp = imagery.metersPerPixel ?? null;
    // % do tamanho do painel em relação à largura da imagem.
    const sizePct = (meters: number) =>
      mpp ? Math.max(0.6, Math.min(8, (meters / mpp / imagery.sizePx) * 100)) : null;
    return panelPositions
      .filter((p) => typeof p.lat === "number" && typeof p.lng === "number")
      .map((p) => {
        const rel = latLngToRelative(p.lat as number, p.lng as number, imagery);
        // azimute do telhado define a rotação do módulo no plano da imagem.
        const rot = typeof p.azimuthDegrees === "number" ? p.azimuthDegrees : 0;
        return {
          index: p.index,
          ...rel,
          wPct: sizePct(p.widthM ?? 1.05),
          hPct: sizePct(p.heightM ?? 1.88),
          rot,
        };
      })
      .filter((p) => p.x >= -0.05 && p.x <= 1.05 && p.y >= -0.05 && p.y <= 1.05);
  }, [panelPositions, imagery]);

  // Sem dados para imagem real → fallback ilustrativo.
  if (!imageUrl || state === "error") {
    return <>{fallback}</>;
  }

  return (
    <div
      className={`relative aspect-square w-full rounded-2xl overflow-hidden border border-slate-700/20 shadow-lg ${className}`}
    >
      <img
        src={imageUrl}
        alt="Telhado do imóvel (imagem de satélite)"
        className="absolute inset-0 h-full w-full object-cover"
        loading="lazy"
        onLoad={() => setState("ok")}
        onError={() => setState("error")}
      />

      {state === "loading" && (
        <div className="absolute inset-0 grid place-items-center bg-slate-900/40">
          <Loader2 className="h-6 w-6 animate-spin text-white" />
        </div>
      )}

      {/* Painéis sobrepostos no telhado real — tamanho e ângulo reais */}
      {state === "ok" &&
        projected.map((p) => (
          <div
            key={p.index}
            className="absolute rounded-[1px] bg-gradient-to-br from-sky-900/90 to-slate-950/90 border border-sky-300/80 shadow-[0_1px_2px_rgba(0,0,0,.5)]"
            style={{
              left: `${p.x * 100}%`,
              top: `${p.y * 100}%`,
              width: p.wPct ? `${p.wPct}%` : "2.6%",
              height: p.hPct ? `${p.hPct}%` : "1.7%",
              transform: `translate(-50%, -50%) rotate(${p.rot}deg)`,
            }}
            title={`Módulo ${p.index + 1}`}
          />
        ))}

      {/* Badge contagem */}
      <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-sm px-3 py-1.5 text-white text-xs font-semibold">
        <Sun className="h-3.5 w-3.5 text-amber-300" />
        {projected.length || panelPositions.length} módulos no seu telhado
      </div>

      {/* Legenda */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-4 py-3">
        <p className="text-[11px] text-center text-white/90 font-medium flex items-center justify-center gap-1.5">
          <ImageOff className="h-3 w-3 opacity-0" />
          Imagem real de satélite · simulação dos módulos sobre o telhado
        </p>
      </div>
    </div>
  );
}
