import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Sun, ChevronRight, MapPin, Zap } from "lucide-react";
import { fetchPublicSolarPreview } from "../lib/api";
import { SolarMap2D } from "./SolarMap2D";
import { SolarDisclaimer } from "./SolarDisclaimer";
import { formatBRLFromCents } from "@/features/produtos/lib/money";

export function SolarCaptacaoWidget({
  consultantId,
  defaultBill,
}: {
  consultantId: string;
  defaultBill?: number;
}) {
  const [address, setAddress] = useState("");
  const [bill, setBill] = useState(defaultBill ? String(defaultBill) : "");
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof fetchPublicSolarPreview>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    setModalOpen(true);
    setPreview(null);
    try {
      const data = await fetchPublicSolarPreview({
        consultantId,
        addressText: address,
        electricityBillValue: bill ? Number(bill) : undefined,
      });
      setPreview(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <section className="relative overflow-hidden rounded-2xl border bg-card shadow-lg my-8">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 via-transparent to-emerald-500/10 pointer-events-none" />
        <div className="relative p-6 sm:p-8 space-y-5">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/25">
              <Sun className="h-7 w-7" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight">Veja placas no seu telhado</h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                Simulação gratuita com imagens de satélite. Resultado em segundos, sem compromisso.
              </p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cap-addr" className="flex items-center gap-1.5 text-sm">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                Endereço do imóvel
              </Label>
              <Input
                id="cap-addr"
                placeholder="Rua, número, cidade, UF"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="h-11 bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cap-bill" className="flex items-center gap-1.5 text-sm">
                <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                Conta de luz (R$)
              </Label>
              <Input
                id="cap-bill"
                type="number"
                placeholder="350"
                value={bill}
                onChange={(e) => setBill(e.target.value)}
                className="h-11 bg-background"
              />
            </div>
          </div>

          <Button
            size="lg"
            className="w-full sm:w-auto h-12 px-8 font-semibold gap-2 shadow-lg shadow-primary/20"
            onClick={run}
            disabled={loading || address.trim().length < 8}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Simular meu telhado
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg w-[calc(100%-1rem)] p-0 gap-0 max-h-[90dvh] overflow-hidden flex flex-col">
          <div className="border-b bg-gradient-to-br from-amber-500/15 to-emerald-500/10 px-5 py-4 shrink-0">
            <DialogHeader className="text-left">
              <DialogTitle className="flex items-center gap-2 text-lg">
                <Sun className="h-5 w-5 text-amber-500" />
                Resultado da simulação
              </DialogTitle>
              <DialogDescription>
                Estimativa comercial — vistoria técnica confirma antes da instalação.
              </DialogDescription>
            </DialogHeader>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="p-5 space-y-4">
              {loading && (
                <div className="flex flex-col items-center py-12 gap-4">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Analisando telhado…</p>
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                  {error}
                </div>
              )}

              {preview?.ok && !loading && (
                <>
                  <SolarMap2D
                    panelPositions={preview.panelPositions}
                    roofSegments={preview.roofSegments}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border bg-card p-3 text-center">
                      <p className="text-[10px] uppercase text-muted-foreground font-semibold">Sistema</p>
                      <p className="text-xl font-bold text-amber-600">{preview.systemKwp} kWp</p>
                    </div>
                    <div className="rounded-xl border bg-card p-3 text-center">
                      <p className="text-[10px] uppercase text-muted-foreground font-semibold">Economia/mês</p>
                      <p className="text-xl font-bold text-emerald-600">
                        {formatBRLFromCents(preview.monthlySavingsCents)}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed">{preview.salesBlurb}</p>
                  <SolarDisclaimer />
                </>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
