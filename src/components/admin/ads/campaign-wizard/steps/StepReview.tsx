/**
 * StepReview — Step 5: resumo visual + preflight + carrossel de preview.
 * O preflight roda automaticamente ao entrar no step. O confetti dispara no
 * sucesso (controlado pelo CampaignWizardModal, que chama submit()).
 */
import { useEffect } from "react";
import { Check, X, Loader2, MapPin, Image as ImageIcon, DollarSign } from "lucide-react";
import { Card } from "@/components/ui/card";
import useEmblaCarousel from "embla-carousel-react";
import { CtwaPreflightCard } from "../../CtwaPreflightCard";
import { AdPreview } from "../../AdPreview";
import { formatBrPhone } from "@/hooks/useConsultantPhone";
import type { WizardState, WizardDerived } from "../hooks/useWizardState";
import type { usePublish } from "../hooks/usePublish";

interface Props {
  state: WizardState;
  derived: WizardDerived;
  patch: (p: Partial<WizardState>) => void;
  publish: ReturnType<typeof usePublish>;
  consultantId: string;
  consultantPhone: string | null;
  pageName: string;
}

export function StepReview({ state, derived, patch, publish, consultantId, consultantPhone, pageName }: Props) {
  const [emblaRef] = useEmblaCarousel({ loop: true });
  const preflight = state.preflight;

  // Roda o preflight automaticamente ao entrar no Step 5.
  useEffect(() => {
    publish.runPreflight();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const total = state.duration === 0 ? `${state.budget * 30}/mês est.` : `${state.budget * state.duration}`;

  return (
    <div className="space-y-4">
      <CtwaPreflightCard consultantId={consultantId} onReadyChange={(r) => patch({ ctwaReady: r })} />

      {/* Prefixo opcional no nome da campanha */}
      <Card className="p-3 space-y-1.5 border-[hsl(var(--ads-border))]">
        <label htmlFor="name-prefix" className="text-xs font-semibold text-foreground">
          Apelido da campanha <span className="text-[hsl(var(--ads-muted))] font-normal">(opcional)</span>
        </label>
        <input
          id="name-prefix"
          type="text"
          maxLength={40}
          value={state.namePrefix}
          onChange={(e) => patch({ namePrefix: e.target.value })}
          placeholder="Ex.: Teste A, Lote 2, Aquecimento…"
          className="w-full px-3 py-1.5 text-sm rounded-md bg-background border border-[hsl(var(--ads-border))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ads-emerald-2))]"
        />
        <div className="text-[11px] text-[hsl(var(--ads-muted))]">
          Aparece <strong>na frente</strong> do nome padrão no Meta Ads — ajuda a diferenciar campanhas parecidas.
          {state.isRemarketing && (
            <span className="block mt-1 text-[hsl(var(--ads-emerald-2))]">
              Remarketing ligado — público da região entra sozinho na Audience.
            </span>
          )}
        </div>
      </Card>



      {/* Carrossel de preview do anúncio */}
      <div className="overflow-hidden rounded-xl border border-[hsl(var(--ads-border))]" ref={emblaRef}>
        <div className="flex">
          <div className="flex-[0_0_100%] min-w-0 p-3 bg-black/20">
            <AdPreview
              imagesByFormat={{
                square: state.filesByFormat.square[0]?.url,
                vertical: state.filesByFormat.vertical[0]?.url,
                story: state.filesByFormat.story[0]?.url,
              }}
              pageName={pageName}
              headline={state.headline}
              primaryText={state.primaryText}
              description={state.description}
              whatsappNumber={consultantPhone || ""}
            />
          </div>
        </div>
      </div>

      {/* Resumo */}
      <Card className="p-4 space-y-2 text-sm bg-primary/5 border-[hsl(var(--ads-emerald-2))]/20">
        <div className="font-bold flex items-center gap-2"><Check className="w-4 h-4 text-[hsl(var(--ads-emerald-2))]" /> Resumo</div>
        <div className="text-[hsl(var(--ads-muted))] flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5" />
          {state.geoMode === "radius"
            ? `${state.radiusPoints.length} endereço(s) — raio ${state.radiusPoints[0]?.radius || 0} km`
            : `${state.cities.length} cidade(s) — ${state.cities.slice(0, 3).map((c) => c.name).join(", ")}${state.cities.length > 3 ? "..." : ""}`}
        </div>
        <div className="text-[hsl(var(--ads-muted))] flex items-center gap-1.5">
          <ImageIcon className="w-3.5 h-3.5" />
          {state.creativeMode === "video"
            ? `1 vídeo Reels ${state.videoMeta ? `(${state.videoMeta.duration.toFixed(1)}s)` : ""}`
            : `${derived.totalFiles} foto(s)`}
        </div>
        <div className="text-[hsl(var(--ads-muted))] flex items-center gap-1.5">
          <DollarSign className="w-3.5 h-3.5" /> R$ {state.budget}/dia × {state.duration === 0 ? "contínuo" : `${state.duration} dias`} = <strong className="text-foreground">R$ {total}</strong>
        </div>
        {consultantPhone && (
          <div className="text-[11px] border-t border-[hsl(var(--ads-border))] pt-1.5">
            🎯 Destino CTWA: <strong className="text-[hsl(var(--ads-emerald-2))]">{formatBrPhone(consultantPhone)}</strong>
          </div>
        )}
      </Card>

      {/* Preflight */}
      {state.preflightLoading && (
        <Card className="p-3 text-xs flex items-center gap-2 text-[hsl(var(--ads-muted))]">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Validando com o Facebook (conexão, conta, alcance)...
        </Card>
      )}
      {preflight && (
        <Card className={`p-3 text-xs space-y-2 border ${preflight.ok ? "bg-primary/10 border-[hsl(var(--ads-emerald-2))]/30" : "bg-destructive/10 border-destructive/30"}`}>
          <div className={`font-bold flex items-center gap-2 ${preflight.ok ? "text-[hsl(var(--ads-emerald-2))]" : "text-destructive"}`}>
            {preflight.ok ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
            {preflight.ok ? "Pré-voo aprovado" : "Pré-voo bloqueado"}
          </div>
          {preflight.blockers.map((b, i) => <div key={i} className="text-destructive">• {b}</div>)}
          {preflight.warnings.map((w, i) => <div key={i} className="text-warning">⚠ {w}</div>)}
          {preflight.reach && (
            <div className="text-[hsl(var(--ads-muted))] border-t border-[hsl(var(--ads-border))] pt-2">
              📡 Alcance estimado: <strong className="text-foreground">{preflight.reach.lower.toLocaleString("pt-BR")}–{preflight.reach.upper.toLocaleString("pt-BR")}</strong> pessoas
              {preflight.reach.lower > 0 && (
                <div className="text-[11px] mt-0.5">~{preflight.reach.daily_min.toLocaleString("pt-BR")}–{preflight.reach.daily_max.toLocaleString("pt-BR")} pessoas/dia</div>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
