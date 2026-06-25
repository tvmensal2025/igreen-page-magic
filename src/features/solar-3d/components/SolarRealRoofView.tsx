import { useEffect, useMemo, useRef, useState } from "react";
import { Sun, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SolarImageryView, SolarPanelPosition } from "../lib/types";
import { buildRoofImageUrl, latLngToRelative } from "../lib/projection";
import { fetchRoofHdImage } from "../lib/api";

const SUPABASE_URL = "https://zlzasfhcxcznaprrragl.supabase.co";

/**
 * Telhado do imóvel com os módulos. Estratégia "em camadas" para nunca travar:
 *   - Base: imagem de satélite (Static Maps), carrega em ~1s, com os módulos
 *     sobrepostos por div (alinhados por Mercator).
 *   - Por cima: imagem HD profissional (foto aérea + heatmap + módulos já
 *     desenhados). Entra com fade quando fica pronta (pode levar ~20s na 1ª vez).
 *   - Fallback ilustrativo quando não há nem satélite.
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
  const [resolvedConsultant, setResolvedConsultant] = useState<string | null>(consultantId ?? null);
  const [baseState, setBaseState] = useState<"loading" | "ok" | "error">("loading");
  const [hdUrl, setHdUrl] = useState<string | null>(null);
  const [hdLoaded, setHdLoaded] = useState(false);
  const [hdPending, setHdPending] = useState<boolean>(!!analysisId);
  const fetchedFor = useRef<string | null>(null);

  // Resolve consultor (usuário logado) quando não vem por prop.
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

  // Busca a imagem HD UMA vez por análise (fora do ciclo de re-render do slider).
  useEffect(() => {
    if (!analysisId || fetchedFor.current === analysisId) return;
    fetchedFor.current = analysisId;
    setHdPending(true);
    let active = true;
    fetchRoofHdImage({ analysisId, consultantId })
      .then((res) => {
        if (active && res?.url) setHdUrl(res.url);
      })
      .finally(() => active && setHdPending(false));
  }, [analysisId, consultantId]);

  // URL do satélite (base que carrega rápido).
  const staticUrl = useMemo(() => {
    if (!resolvedConsultant || !imagery) return null;
    return buildRoofImageUrl(SUPABASE_URL, resolvedConsultant, imagery);
  }, [resolvedConsultant, imagery]);

  // Módulos por div: só sobre o satélite (no HD já vêm desenhados na imagem).
  const projected = useMemo(() => {
    if (!imagery) return [];
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
  }, [panelPositions, imagery]);

  // Sem satélite e sem HD → fallback ilustrativo.
  if ((!staticUrl && !hdUrl) || baseState === "error") {
    // Se o HD ainda pode chegar, segura com um placeholder leve.
    if (hdPending && analysisId) {
      return (
        <div className={`relative aspect-square w-full rounded-2xl overflow-hidden border bg-slate-900 ${className}`}>
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-2 text-white/80">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-xs">Gerando imagem do telhado…</span>
            </div>
          </div>
        </div>
      );
    }
    return <>{fallback}</>;
  }

  const showPanelsOverlay = !hdLoaded; // some quando o HD (já com painéis) aparece

  return (
    <div className={`relative aspect-square w-full rounded-2xl overflow-hidden border border-slate-700/20 shadow-lg bg-slate-900 ${className}`}>
      {/* Base: satélite (rápido) */}
      {staticUrl && (
        <img
          src={staticUrl}
          alt="Telhado do imóvel"
          className="absolute inset-0 h-full w-full object-cover"
          loading="eager"
          onLoad={() => setBaseState("ok")}
          onError={() => setBaseState("error")}
        />
      )}

      {/* Camada HD: foto aérea + heatmap + módulos (entra com fade) */}
      {hdUrl && (
        <img
          src={hdUrl}
          alt="Telhado do imóvel em alta resolução"
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700"
          style={{ opacity: hdLoaded ? 1 : 0 }}
          loading="eager"
          onLoad={() => setHdLoaded(true)}
        />
      )}

      {/* Módulos por div só enquanto o HD não entrou */}
      {showPanelsOverlay &&
        baseState === "ok" &&
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

      {/* Spinner discreto enquanto a base ainda não carregou */}
      {baseState === "loading" && !hdLoaded && (
        <div className="absolute inset-0 grid place-items-center bg-slate-900/40">
          <Loader2 className="h-6 w-6 animate-spin text-white" />
        </div>
      )}

      {/* Selo "melhorando qualidade" enquanto o HD é gerado em background */}
      {hdPending && !hdLoaded && baseState === "ok" && (
        <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-black/55 backdrop-blur-sm px-2.5 py-1 text-white text-[10px] font-medium">
          <Loader2 className="h-3 w-3 animate-spin" />
          Alta resolução…
        </div>
      )}

      {/* Badge contagem */}
      <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-sm px-3 py-1.5 text-white text-xs font-semibold">
        <Sun className="h-3.5 w-3.5 text-amber-300" />
        {panelPositions.length} módulos no seu telhado
      </div>

      {/* Legenda */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-4 py-3">
        <p className="text-[11px] text-center text-white/90 font-medium">
          {hdLoaded
            ? "Foto aérea de alta resolução · mapa de calor de geração solar no telhado"
            : "Imagem real de satélite · simulação dos módulos sobre o telhado"}
        </p>
      </div>
    </div>
  );
}
