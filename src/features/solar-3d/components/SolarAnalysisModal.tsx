import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  MapPin,
  Sun,
  Zap,
  User,
  ChevronRight,
  CheckCircle2,
  Satellite,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { analyzeRoof, saveManualSketch, updateSnapshotPanels } from "../lib/api";
import type { SolarAnalyzeResult } from "../lib/types";
import { SolarAnalysisResults } from "./SolarAnalysisResults";
import { SolarSavedAnalysesList } from "./SolarSavedAnalysesList";

type Step = "form" | "loading" | "results";

const LOADING_STEPS = [
  "Localizando o imóvel no mapa…",
  "Lendo imagens de satélite do telhado…",
  "Calculando área útil e inclinação…",
  "Dimensionando módulos e economia…",
  "Quase lá — preparando o resultado…",
];

export function SolarAnalysisModal({
  open,
  onOpenChange,
  customerId,
  customerName,
  defaultBill,
  addressHint,
  onApplied,
  applyLabel = "Usar na proposta",
  showProposalAction = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId?: string | null;
  customerName?: string | null;
  defaultBill?: number | null;
  addressHint?: string | null;
  onApplied?: (result: SolarAnalyzeResult) => void;
  applyLabel?: string;
  showProposalAction?: boolean;
}) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("form");
  const [address, setAddress] = useState(addressHint ?? "");
  const [bill, setBill] = useState(defaultBill ? String(defaultBill) : "");
  const [loadingMsg, setLoadingMsg] = useState(LOADING_STEPS[0]);
  const [result, setResult] = useState<SolarAnalyzeResult | null>(null);
  const [view3d, setView3d] = useState(false);
  const [manualApplied, setManualApplied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("form");
    setResult(null);
    setView3d(false);
    setManualApplied(false);
    setAddress(addressHint ?? "");
    setBill(defaultBill ? String(defaultBill) : "");
  }, [open, customerId, addressHint, defaultBill]);

  useEffect(() => {
    if (step !== "loading") return;
    let i = 0;
    setLoadingMsg(LOADING_STEPS[0]);
    // Avança as mensagens uma vez (sem loop infinito), parando na última.
    const id = setInterval(() => {
      i = Math.min(i + 1, LOADING_STEPS.length - 1);
      setLoadingMsg(LOADING_STEPS[i]);
    }, 1800);
    return () => clearInterval(id);
  }, [step]);

  const runAnalysis = async () => {
    setStep("loading");
    try {
      const data = await analyzeRoof({
        customerId: customerId ?? undefined,
        addressText: !customerId ? address.trim() || undefined : undefined,
        electricityBillValue: bill ? Number(bill) : undefined,
      });
      setResult(data);
      setManualApplied(false);
      setStep("results");
      toast.success("Análise salva no histórico do consultor");
      if (data.mock) {
        toast.info("Modo demonstração — configure a chave Google no servidor para dados reais.");
      }
    } catch (e) {
      toast.error((e as Error).message);
      setStep("form");
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
      toast.success("Estimativa manual salva");
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

  const handleUseInProposal = () => {
    if (!result) return;
    if (onApplied) {
      onApplied(result);
      onOpenChange(false);
      return;
    }
    sessionStorage.setItem("solar_pending_snapshot", result.snapshotId);
    onOpenChange(false);
    navigate("/admin?tab=produtos");
  };

  const canAnalyze = customerId ? true : address.trim().length >= 8;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[calc(100%-1rem)] p-0 gap-0 h-[92dvh] sm:h-[88dvh] sm:max-h-[820px] overflow-hidden flex flex-col">
        <div className="relative overflow-hidden border-b bg-gradient-to-br from-amber-500/15 via-primary/10 to-emerald-500/10 px-5 pt-5 pb-4 shrink-0">
          <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-amber-400/20 blur-2xl" />
          <DialogHeader className="relative space-y-2 text-left">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/30">
                <Sun className="h-6 w-6" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold tracking-tight">
                  Análise solar do telhado
                </DialogTitle>
                <DialogDescription className="text-sm">
                  Conexão Placas — dimensionamento com imagens de satélite
                </DialogDescription>
              </div>
            </div>
            <StepIndicator step={step} />
          </DialogHeader>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-5 space-y-5">
            {step === "form" && (
              <>
                {customerId && (
                  <SolarSavedAnalysesList
                    customerId={customerId}
                    onSelect={(saved) => {
                      setResult(saved);
                      setStep("results");
                    }}
                  />
                )}

                {customerId && (
                  <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <p className="font-semibold truncate">{customerName ?? "Cliente do CRM"}</p>
                      <p className="text-xs text-muted-foreground">
                        Endereço e conta de luz serão lidos automaticamente do cadastro.
                      </p>
                    </div>
                  </div>
                )}

                {!customerId && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="solar-addr" className="flex items-center gap-1.5 text-sm font-medium">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        Endereço completo do imóvel
                      </Label>
                      <Input
                        id="solar-addr"
                        placeholder="Rua, número, bairro, cidade, UF, CEP"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        className="h-11"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="solar-bill" className="flex items-center gap-1.5 text-sm font-medium">
                    <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                    Valor médio da conta de luz (opcional)
                  </Label>
                  <Input
                    id="solar-bill"
                    type="number"
                    inputMode="decimal"
                    placeholder="Ex.: 350"
                    value={bill}
                    onChange={(e) => setBill(e.target.value)}
                    className="h-11"
                  />
                  <p className="text-xs text-muted-foreground">
                    Usamos para sugerir o tamanho ideal do sistema e a economia mensal.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
                  <div className="rounded-lg border bg-muted/30 p-2">
                    <Satellite className="h-4 w-4 mx-auto mb-1 text-primary" />
                    Satélite Google
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-2">
                    <Sun className="h-4 w-4 mx-auto mb-1 text-amber-500" />
                    kWp e geração
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-2">
                    <CheckCircle2 className="h-4 w-4 mx-auto mb-1 text-emerald-600" />
                    Pronto p/ proposta
                  </div>
                </div>

                <Button
                  className="w-full h-12 text-base font-semibold gap-2 shadow-lg shadow-primary/20"
                  disabled={!canAnalyze}
                  onClick={runAnalysis}
                >
                  Iniciar análise
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            )}

            {step === "loading" && (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center space-y-6">
                <div className="relative">
                  <div className="h-20 w-20 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 animate-pulse shadow-xl shadow-amber-500/40" />
                  <Loader2 className="absolute inset-0 m-auto h-10 w-10 text-white animate-spin" />
                </div>
                <div className="space-y-2 max-w-sm">
                  <p className="text-lg font-semibold">Analisando seu telhado</p>
                  <p className="text-sm text-muted-foreground animate-pulse">{loadingMsg}</p>
                </div>
                <Badge variant="secondary" className="text-xs">
                  Isso leva alguns segundos
                </Badge>
              </div>
            )}

            {step === "results" && result && (
              <SolarAnalysisResults
                result={result}
                view3d={view3d}
                onView3dChange={setView3d}
                manualApplied={manualApplied}
                onManualSketch={handleManualSketch}
                onPanelsChange={onPanelsChange}
                onUseInProposal={handleUseInProposal}
                showProposalAction={showProposalAction}
                applyLabel={applyLabel}
                compact
              />
            )}
          </div>
        </ScrollArea>

        {step === "results" && (
          <div className="border-t bg-muted/30 px-5 py-3 flex justify-between gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setStep("form")}>
              Nova análise
            </Button>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const items = [
    { key: "form", label: "Dados" },
    { key: "loading", label: "Análise" },
    { key: "results", label: "Resultado" },
  ] as const;
  const activeIdx = step === "form" ? 0 : step === "loading" ? 1 : 2;

  return (
    <div className="flex items-center gap-2 pt-2">
      {items.map((item, i) => (
        <div key={item.key} className="flex items-center gap-2 flex-1 min-w-0">
          <div
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
              i <= activeIdx ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {i < activeIdx ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
          </div>
          <span className={`text-xs truncate ${i === activeIdx ? "font-semibold" : "text-muted-foreground"}`}>
            {item.label}
          </span>
          {i < items.length - 1 && (
            <div className={`h-px flex-1 min-w-2 ${i < activeIdx ? "bg-primary" : "bg-border"}`} />
          )}
        </div>
      ))}
    </div>
  );
}
