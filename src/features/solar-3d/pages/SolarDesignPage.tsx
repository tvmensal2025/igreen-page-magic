import { useEffect, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { Sun, History } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { saveManualSketch, updateSnapshotPanels, listConsultantSolarAnalyses, loadSolarSnapshot } from "../lib/api";
import { SolarAnalysisModal } from "../components/SolarAnalysisModal";
import { SolarAnalysisResults } from "../components/SolarAnalysisResults";
import type { SolarAnalyzeResult } from "../lib/types";

export default function SolarDesignPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const customerId = searchParams.get("customerId");
  const [modalOpen, setModalOpen] = useState(!!customerId);
  const [result, setResult] = useState<SolarAnalyzeResult | null>(null);
  const [view3d, setView3d] = useState(false);
  const [manualApplied, setManualApplied] = useState(false);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof listConsultantSolarAnalyses>>>([]);

  useEffect(() => {
    listConsultantSolarAnalyses(25)
      .then(setHistory)
      .catch(() => {});
  }, [result]);

  const handleManualSketch = async (widthM: number, depthM: number) => {
    if (!result) return;
    try {
      const { metrics, salesBlurb } = await saveManualSketch(result.snapshotId, widthM, depthM);
      setResult({
        ...result,
        metrics: { ...metrics, imageryQuality: result.imageryQuality },
        salesBlurb,
        roofSegments: [
          {
            index: 0,
            pitchDegrees: 20,
            azimuthDegrees: 180,
            areaM2: widthM * depthM,
            lat: null,
            lng: null,
          },
        ],
        panelPositions: Array.from({ length: metrics.panelsCount }, (_, i) => ({
          index: i,
          lat: null,
          lng: null,
          segmentIndex: 0,
          yearlyKwh: null,
        })),
      });
      setManualApplied(true);
      toast.success("Estimativa manual salva no projeto");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onPanelsChange = async (count: number) => {
    if (!result) return;
    try {
      const metrics = await updateSnapshotPanels(result.snapshotId, count);
      setResult({ ...result, metrics });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onApplied = (data: SolarAnalyzeResult) => {
    setResult(data);
    setModalOpen(false);
  };

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg">
          <Sun className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Análise de telhado</h1>
          <p className="text-sm text-muted-foreground">Conexão Placas — dimensionamento remoto com satélite</p>
        </div>
      </div>

      {!result ? (
        <div className="rounded-2xl border border-dashed bg-muted/30 p-8 text-center space-y-4">
          <p className="text-muted-foreground text-sm max-w-sm mx-auto">
            Analise o telhado do cliente em poucos cliques e gere uma proposta profissional com kWp, geração e economia.
          </p>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center justify-center rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20"
          >
            Nova análise
          </button>
        </div>
      ) : (
        <SolarAnalysisResults
          result={result}
          view3d={view3d}
          onView3dChange={setView3d}
          manualApplied={manualApplied}
          onManualSketch={handleManualSketch}
          onPanelsChange={onPanelsChange}
          onUseInProposal={() => {
            sessionStorage.setItem("solar_pending_snapshot", result.snapshotId);
            navigate("/admin?tab=produtos");
          }}
        />
      )}

      <SolarAnalysisModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        customerId={customerId}
        onApplied={onApplied}
      />

      {history.length > 0 && (
        <section className="rounded-2xl border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            Telhados analisados (salvos)
          </h2>
          <ul className="divide-y">
            {history.map((h) => (
              <li key={h.analysisId} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{h.addressText ?? "Sem endereço"}</p>
                  <p className="text-xs text-muted-foreground">
                    {h.systemKwp} kWp · {h.panelsCount} módulos ·{" "}
                    {formatDistanceToNow(new Date(h.createdAt), { addSuffix: true, locale: ptBR })}
                  </p>
                </div>
                {h.snapshotId && (
                  <button
                    type="button"
                    className="text-xs font-semibold text-primary hover:underline shrink-0"
                    onClick={async () => {
                      const loaded = await loadSolarSnapshot(h.snapshotId!);
                      setResult(loaded);
                    }}
                  >
                    Abrir análise
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
