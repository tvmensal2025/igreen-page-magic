import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Sun } from "lucide-react";
import { toast } from "sonner";
import { analyzeRoof, updateSnapshotPanels, saveManualSketch } from "../lib/api";
import { SolarMap2D } from "../components/SolarMap2D";
import { SolarMetricsPanel } from "../components/SolarMetricsPanel";
import { SolarPanelSlider } from "../components/SolarPanelSlider";
import { SolarDisclaimer } from "../components/SolarDisclaimer";
import { SolarSketchFallback } from "../components/SolarSketchFallback";
import type { SolarAnalyzeResult } from "../lib/types";

export default function SolarDesignPage() {
  const [searchParams] = useSearchParams();
  const customerId = searchParams.get("customerId");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SolarAnalyzeResult | null>(null);
  const [view3d, setView3d] = useState(false);
  const [manualApplied, setManualApplied] = useState(false);

  const runAnalysis = async () => {
    setLoading(true);
    try {
      const data = await analyzeRoof({
        customerId,
        addressText: address || undefined,
        allowExperiment: true,
      });
      setResult(data);
      setManualApplied(false);
      if (data.mock) toast.info("Modo demonstração (configure GOOGLE_SOLAR_API_KEY para dados reais)");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

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

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Sun className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Análise de telhado</h1>
          <p className="text-sm text-muted-foreground">Conexão Placas — dimensionamento remoto</p>
        </div>
      </div>

      <div className="space-y-3">
        {!customerId && (
          <div>
            <Label htmlFor="addr">Endereço completo</Label>
            <Input
              id="addr"
              placeholder="Rua, número, bairro, cidade, UF, CEP"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
        )}
        {customerId && (
          <p className="text-sm text-muted-foreground">Cliente vinculado — endereço será lido do CRM.</p>
        )}
        <Button onClick={runAnalysis} disabled={loading || (!customerId && !address.trim())}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Analisar telhado
        </Button>
      </div>

      {result && (
        <div className="space-y-4">
          {result.imageryQuality === "BASE" && !manualApplied && (
            <SolarSketchFallback onSave={handleManualSketch} />
          )}
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={view3d ? "outline" : "default"} onClick={() => setView3d(false)}>
              2D
            </Button>
            <Button type="button" size="sm" variant={view3d ? "default" : "outline"} onClick={() => setView3d(true)}>
              3D
            </Button>
          </div>
          {view3d ? (
            <div className="text-sm text-muted-foreground p-4 border rounded-lg">
              Visualização 3D disponível na página de detalhe.{" "}
              <Link className="text-primary underline" to={`/admin/solar-design/${result.snapshotId}`}>
                Abrir detalhe
              </Link>
            </div>
          ) : (
            <SolarMap2D
              panelPositions={result.panelPositions}
              roofSegments={result.roofSegments}
            />
          )}
          <SolarMetricsPanel metrics={result.metrics} imageryQuality={result.imageryQuality} />
          <SolarPanelSlider
            metrics={result.metrics}
            presets={result.presets}
            onChange={onPanelsChange}
            onApplyPreset={onPanelsChange}
          />
          <p className="text-sm bg-muted/50 p-3 rounded-lg">{result.salesBlurb}</p>
          <SolarDisclaimer />
          <Button asChild>
            <Link
              to="/admin?tab=produtos"
              onClick={() => sessionStorage.setItem("solar_pending_snapshot", result.snapshotId)}
            >
              Usar na proposta Placas
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
