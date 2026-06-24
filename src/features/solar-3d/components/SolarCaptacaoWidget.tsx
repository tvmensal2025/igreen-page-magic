import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Sun } from "lucide-react";
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
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof fetchPublicSolarPreview>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
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
    <section className="rounded-2xl border bg-card p-5 shadow-sm space-y-4 my-8">
      <div className="flex items-center gap-2">
        <Sun className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Veja placas no seu telhado</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Simulação gratuita com imagens de satélite. Sem compromisso.
      </p>
      <div className="space-y-3">
        <div>
          <Label htmlFor="cap-addr">Endereço do imóvel</Label>
          <Input
            id="cap-addr"
            placeholder="Rua, número, cidade, UF"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="cap-bill">Valor médio da conta (R$)</Label>
          <Input
            id="cap-bill"
            type="number"
            placeholder="350"
            value={bill}
            onChange={(e) => setBill(e.target.value)}
          />
        </div>
        <Button onClick={run} disabled={loading || address.trim().length < 8}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Simular meu telhado
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {preview?.ok && (
        <div className="space-y-3 pt-2">
          <SolarMap2D
            panelPositions={preview.panelPositions}
            roofSegments={preview.roofSegments}
          />
          <p className="text-sm font-medium">
            {preview.systemKwp} kWp · ~{formatBRLFromCents(preview.monthlySavingsCents)}/mês de economia estimada*
          </p>
          <p className="text-sm text-muted-foreground">{preview.salesBlurb}</p>
          <SolarDisclaimer />
        </div>
      )}
    </section>
  );
}
