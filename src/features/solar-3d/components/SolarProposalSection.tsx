import type { PublicSolarDesign } from "../lib/types";
import { SolarMap2D } from "./SolarMap2D";
import { SolarRealRoofView } from "./SolarRealRoofView";
import { SolarDisclaimer } from "./SolarDisclaimer";
import { formatBRLFromCents } from "@/features/produtos/lib/money";

export function SolarProposalSection({ solar }: { solar: PublicSolarDesign }) {
  return (
    <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:p-6 space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        Seu telhado com energia solar
      </h3>
      <SolarRealRoofView
        consultantId={solar.consultantId}
        analysisId={solar.analysisId}
        imagery={solar.imagery}
        panelPositions={solar.panelPositions}
        fallback={<SolarMap2D panelPositions={solar.panelPositions} roofSegments={solar.roofSegments} />}
      />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-muted-foreground text-xs">Sistema</div>
          <div className="font-semibold">{solar.systemKwp} kWp · {solar.panelsCount} módulos</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Geração/ano</div>
          <div className="font-semibold">{solar.yearlyEnergyKwh.toLocaleString("pt-BR")} kWh</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Economia/mês*</div>
          <div className="font-semibold text-primary">
            {formatBRLFromCents(solar.monthlySavingsCents)}
          </div>
        </div>
      </div>
      {solar.salesBlurb && <p className="text-sm">{solar.salesBlurb}</p>}
      <SolarDisclaimer />
    </section>
  );
}
