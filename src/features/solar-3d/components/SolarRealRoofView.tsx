import { useEffect, useMemo, useState } from "react";
import { Sun, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SolarImageryView, SolarPanelPosition } from "../lib/types";
import { buildRoofImageUrl, latLngToRelative, type LatLngBounds } from "../lib/projection";
import { fetchRoofHdImage } from "../lib/api";

const SUPABASE_URL = "https://zlzasfhcxcznaprrragl.supabase.co";

/**
 * Mostra o telhado do imóvel com os módulos sobrepostos nas coordenadas reais.
 * Prioridade de qualidade:
 *   1) Imagem HD profissional (foto aérea ~10cm/px + mapa de calor de irradiação)
 *      — quando há `analysisId`; painéis projetados pelo bounding box.
 *   2) Imagem de satélite (Static Maps) — quando há `imagery`.
 *   3) Fallback ilustrativo (prop `fallback`).
 */
export function SolarRealRoofView({
  consultantId,
  analysisId,
  imagery,
  panelPositions,
  className = "",
  fallback,
}: {
  consultantId?: string | null;
  analysisId?: string | null;
  imagery?: SolarImageryView | null;
  panelPositions: SolarPanelPosition[];
  className?: string;
  fallback?: React.ReactNode;
}) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [resolvedConsultant, setResolvedConsultant] = useState<string | null>(consultantId ?? null);
  const [hd, setHd] = useState<{ url: string; bounds: LatLngBounds | null } | null>(null);
  const [hdTried, setHdTried] = useState(false);

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

  // Tenta a imagem HD profissional (foto aérea + heatmap).
  useEffect(() => {
    if (!analysisId) {
      setHdTried(true);
      return;
    }
    let active = true;
    fetchRoofHdImage({ analysisId, consultantId })
      .then((res) => {
        if (!active) return;
        if (res?.url) setHd({ url: res.url, bounds: (res as { bounds?: LatLngBounds }).bounds ?? null });
      })
      .finally(() => active && setHdTried(true));
    return () => {
      active = false;
    };
  }, [analysisId, consultantId]);

  // URL de satélite (fallback quando não há HD).
  const staticUrl = useMemo(() => {
    if (!resolvedConsultant || !imagery) return null;
    return buildRoofImageUrl(SUPABASE_URL, resolvedConsultant, imagery);
  }, [resolvedConsultant, imagery]);

  const usingHd = !!hd?.url;
  const imageUrl = hd?.url ?? staticUrl;

  // Painéis sobrepostos por div: SÓ no modo satélite (no HD já vêm desenhados).
  const projected = useMemo(() => {
    if (usingHd || !imagery) return [];
    const withCoords = panelPositions.filter((p) => typeof p.lat === "number" && typeof p.lng === "number");
    const mpp = imagery.metersPerPixel ?? null;
    const sizePct = (m: number) =>
      mpp ? Math.max(0.6, Math.min(8, (m / mpp / imagery.sizePx) * 100)) : 2.4;
    return withCoords
      .map((p) => {
        const rel = latLngToRelative(p.lat as number, p.lng as number, imagery);
        return {
          index: p.index,
          ...rel,
          wPct: sizePct(p.widthM ?? 1.05),
          hPct: sizePct(p.heightM ?? 1.88),
          rot: typeof p.azimuthDegrees === "number" ? p.azimuthDegrees : 0,
        };
      })
      .filter((p) => p.x >= -0.05 && p.x <= 1.05 && p.y >= -0.05 && p.y <= 1.05);
  }, [panelPositions, imagery, usingHd]);

  // Enquanto tenta HD, não decide fallback ainda (evita piscar).
  if (!hdTried && analysisId) {
    return (
      <div className={`relative aspect-square w-full rounded-2xl overflow-hidden border bg-slate-900 ${className}`}>
        <div className="absolute inset-0 grid place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-white" />
        </div>
      </div>
    );
  }

  if (!imageUrl || state === "error") {
    return <>{fallback}</>;
  }

  return (
    <div className={`relative aspect-square w-full rounded-2xl overflow-hidden border border-slate-700/20 shadow-lg ${className}`}>
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

      {state === "ok" &&
        projected.map((p) => (
          <div
            key={p.index}
            className="absolute rounded-[1px] bg-gradient-to-br from-sky-900/85 to-slate-950/85 border border-sky-300/80 shadow-[0_1px_2px_rgba(0,0,0,.5)]"
            style={{
              left: `${p.x * 100}%`,
              top: `${p.y * 100}%`,
              width: `${p.wPct}%`,
              height: `${p.hPct}%`,
              transform: `translate(-50%, -50%) rotate(${p.rot}deg)`,
            }}
            title={`Módulo ${p.index + 1}`}
          />
        ))}

      <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-sm px-3 py-1.5 text-white text-xs font-semibold">
        <Sun className="h-3.5 w-3.5 text-amber-300" />
        {projected.length || panelPositions.length} módulos no seu telhado
      </div>

      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-4 py-3">
        <p className="text-[11px] text-center text-white/90 font-medium">
          {usingHd
            ? "Foto aérea de alta resolução · mapa de calor de geração solar no telhado"
            : "Imagem real de satélite · simulação dos módulos sobre o telhado"}
        </p>
      </div>
    </div>
  );
}
