import { useState, useEffect } from "react";
import { 
  CheckCircle2, 
  AlertCircle, 
  Settings2, 
  Megaphone, 
  Rocket,
  ShieldCheck,
  Zap,
  Star,
  MapPin,
  Image as ImageIcon,
  DollarSign,
  Loader2,
  Check,
  X
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import useEmblaCarousel from "embla-carousel-react";
import { CtwaPreflightCard } from "../../CtwaPreflightCard";
import { AdPreview } from "../../AdPreview";
import { formatBrPhone } from "@/hooks/useConsultantPhone";
import type { WizardState, WizardDerived } from "../hooks/useWizardState";
import type { usePublish } from "../hooks/usePublish";
import { FORMAT_SPEC } from "../wizardHelpers";

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
  
  const isSingleStory = state.format === "story" && state.filesByFormat.story.length === 1;
  const isPartnerCampaign = state.namePrefix?.toUpperCase().includes("PARCEIRO");

  // Roda o preflight automaticamente ao entrar no Step 5.
  useEffect(() => {
    publish.runPreflight();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const total = state.duration === 0 ? `${state.budget * 30}/mês est.` : `${state.budget * state.duration}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Rocket className="w-5 h-5 text-[hsl(var(--ads-emerald-2))]" />
        <h3 className="text-lg font-bold">Revisão Final da Campanha</h3>
      </div>

      <CtwaPreflightCard consultantId={consultantId} onReadyChange={(r) => patch({ ctwaReady: r })} />

      {/* Nome da Campanha */}
      <Card className="p-4 space-y-2 border-[hsl(var(--ads-border))]">
        <Label className="text-xs font-semibold text-[hsl(var(--ads-muted))] uppercase tracking-wider">
          Apelido da campanha (ex: Cidade - Parceiro)
        </Label>
        <div className="flex gap-2">
          <Input
            value={state.namePrefix}
            onChange={(e) => patch({ namePrefix: e.target.value })}
            placeholder="Ex: Uberlandia - Parceiro Story"
            className="bg-[hsl(var(--ads-surface))] border-[hsl(var(--ads-border))]"
          />
          {isPartnerCampaign && (
            <Badge variant="outline" className="shrink-0 border-primary text-primary">
              Modo Parceiro
            </Badge>
          )}
        </div>
        <p className="text-[10px] text-[hsl(var(--ads-muted))]">
          Aparece na frente do nome padrão no Meta Ads. {state.isRemarketing && "Remarketing ON."}
        </p>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-[hsl(var(--ads-muted))] flex items-center gap-1.5">
            <Megaphone className="w-3 h-3" /> Criativo
          </div>
          <Card className="p-3 border-[hsl(var(--ads-border))] bg-[hsl(var(--ads-surface-2))]">
            <div className="text-sm font-medium">{FORMAT_SPEC[state.format].label}</div>
            <div className="text-xs text-[hsl(var(--ads-muted))] mt-1 flex items-center gap-1">
              <ImageIcon className="w-3 h-3" />
              {state.creativeMode === "video" ? "1 Vídeo Reels" : `${derived.totalFiles} foto(s)`}
            </div>
            {isSingleStory && (
              <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[hsl(var(--ads-emerald-2))] bg-[hsl(var(--ads-emerald)/.1)] px-2 py-1 rounded w-fit">
                <Star className="w-3 h-3" /> Chamada Story (Ideal)
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-[hsl(var(--ads-muted))] flex items-center gap-1.5">
            <Settings2 className="w-3 h-3" /> Alcance & Verba
          </div>
          <Card className="p-3 border-[hsl(var(--ads-border))] bg-[hsl(var(--ads-surface-2))]">
            <div className="text-sm font-medium flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {state.geoMode === "radius" ? "Raio Local" : `${state.cities.length} cidade(s)`}
            </div>
            <div className="text-xs text-[hsl(var(--ads-muted))] mt-1 flex items-center gap-1">
              <DollarSign className="w-3 h-3" /> R$ {state.budget}/dia (R$ {total})
            </div>
          </Card>
        </div>
      </div>

      {/* Preview */}
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

      {/* Alertas e Preflight */}
      <div className="space-y-3">
        {state.preflightLoading && (
          <Card className="p-3 text-xs flex items-center gap-2 text-[hsl(var(--ads-muted))]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Validando com Meta Ads...
          </Card>
        )}
        
        {preflight && (
          <Card className={`p-3 text-xs space-y-2 border ${preflight.ok ? "bg-primary/10 border-[hsl(var(--ads-emerald-2))]/30" : "bg-destructive/10 border-destructive/30"}`}>
          <div className={`font-bold flex items-center gap-2 ${preflight.ok ? "text-[hsl(var(--ads-emerald-2))]" : "text-destructive"}`}>
            {preflight.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
            {preflight.ok ? "Configuração de Alta Conversão" : "Problemas detectados"}
          </div>
            {preflight.blockers.map((b, i) => <div key={i} className="text-destructive">• {b}</div>)}
            {preflight.ok && isSingleStory && (
              <div className="text-[hsl(var(--ads-emerald-2))] flex items-center gap-1.5">
                <Zap className="w-3 h-3" /> Otimizado: Imagem única no formato Story.
              </div>
            )}
            {preflight.reach && (
              <div className="text-[hsl(var(--ads-muted))] border-t border-[hsl(var(--ads-border))] pt-2">
                📡 Alcance: <strong className="text-foreground">{preflight.reach.lower.toLocaleString("pt-BR")}–{preflight.reach.upper.toLocaleString("pt-BR")}</strong>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}