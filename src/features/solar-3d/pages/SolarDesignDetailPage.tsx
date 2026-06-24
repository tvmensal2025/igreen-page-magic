import { lazy, Suspense } from "react";
import { useParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SolarMetricsPanel } from "../components/SolarMetricsPanel";
import { SolarDisclaimer } from "../components/SolarDisclaimer";
import { SolarMap2D } from "../components/SolarMap2D";
import { SolarRealRoofView } from "../components/SolarRealRoofView";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const SolarRoofViewer3D = lazy(() =>
  import("../components/SolarRoofViewer3D").then((m) => ({ default: m.SolarRoofViewer3D })),
);

export default function SolarDesignDetailPage() {
  const { snapshotId } = useParams<{ snapshotId: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ["solar-snapshot", snapshotId],
    enabled: !!snapshotId,
    queryFn: async () => {
      const { data: res, error } = await supabase.functions.invoke("solar-design-get", {
        body: { snapshotId },
      });
      if (error) throw error;
      return res;
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const snap = data?.snapshot;
  if (!snap) {
    return <p className="p-6 text-center text-muted-foreground">Análise não encontrada.</p>;
  }

  const metrics = {
    panelCapacityWatts: 410,
    panelsCount: snap.panelsCount,
    systemSizeKwp: snap.systemKwp,
    yearlyEnergyKwh: snap.yearlyEnergyKwh,
    estimatedMonthlySavingsCents: snap.monthlySavingsCents,
    maxPanels: snap.panelsCount + 10,
    imageryQuality: data?.analysis?.imageryQuality ?? "UNKNOWN",
  };

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/admin/solar-design">← Voltar</Link>
      </Button>

      {/* Telhado REAL de satélite com os módulos sobrepostos (visual principal) */}
      <SolarRealRoofView
        consultantId={data?.analysis?.consultantId}
        imagery={data?.analysis?.imagery}
        panelPositions={snap.panelPositions}
        fallback={
          <Suspense fallback={<SolarMap2D panelPositions={snap.panelPositions} roofSegments={snap.roofSegments} />}>
            <SolarRoofViewer3D panelPositions={snap.panelPositions} roofSegments={snap.roofSegments} />
          </Suspense>
        }
      />

      {/* Maquete 3D interativa (complementar) */}
      <details className="rounded-xl border bg-muted/30">
        <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-muted-foreground">
          Ver maquete 3D interativa
        </summary>
        <div className="p-3">
          <Suspense fallback={<SolarMap2D panelPositions={snap.panelPositions} roofSegments={snap.roofSegments} />}>
            <SolarRoofViewer3D panelPositions={snap.panelPositions} roofSegments={snap.roofSegments} />
          </Suspense>
        </div>
      </details>
      <SolarMetricsPanel metrics={metrics} imageryQuality={metrics.imageryQuality} />
      {snap.salesBlurb && <p className="text-sm">{snap.salesBlurb}</p>}
      <SolarDisclaimer />
    </div>
  );
}
