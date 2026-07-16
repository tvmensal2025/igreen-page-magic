import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Rocket, ChevronLeft, AlertTriangle, UserCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  CityHit, createCampaign, preflightCampaign, searchCitiesBulk,
} from "@/services/facebookAds";
import { DISTRIBUIDORAS_PRESETS } from "@/data/distribuidoraPresets";
import { AdTemplate } from "@/services/adTemplates";
import { supabase } from "@/integrations/supabase/client";
import { useInstancePhone } from "@/hooks/useInstancePhone";
import { useAdBonusTiers } from "@/hooks/useAdBonusTiers";

interface Props {
  open: boolean;
  onClose: () => void;
  template: AdTemplate | null;
  consultantId: string;
  onPublished?: () => void;
}

const PRESET_CACHE_VERSION = "v1";
const cacheKey = (id: string) => `ads-preset-cities-${PRESET_CACHE_VERSION}-${id}`;

export function UseTemplateDialog({ open, onClose, template, consultantId, onPublished }: Props) {
  const { toast } = useToast();
  const { tiers: bonusTiers } = useAdBonusTiers();
  const TIER_LABEL: Record<string, string> = {
    alto: `🟢 Bônus até ${bonusTiers.alto.percent}%`,
    medio: `🟡 Bônus até ${bonusTiers.medio.percent}%`,
    sem_bonus: "⚪ Sem bônus extra",
  };
  const [step, setStep] = useState<1 | 2>(1);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string>("__all__");
  const [consultantName, setConsultantName] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [stepLog, setStepLog] = useState<string>("");
  const { data: connectedPhone } = useInstancePhone(consultantId);

  function formatPhone(p?: string | null) {
    if (!p) return "";
    const d = p.replace(/\D/g, "");
    if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    return p;
  }

  useEffect(() => {
    if (!open) return;
    setStep(1); setPresetId(null); setSelectedCity(""); setSubmitting(false); setStepLog("");
    supabase.from("consultants").select("name").eq("id", consultantId).maybeSingle()
      .then(({ data }) => setConsultantName(data?.name || ""));
  }, [open, consultantId]);

  const preset = useMemo(() => DISTRIBUIDORAS_PRESETS.find((p) => p.id === presetId) || null, [presetId]);

  // Default seguro: 1ª cidade do preset (não "Todas"), evita CPL alto.
  useEffect(() => {
    if (!preset) { setSelectedCity(""); return; }
    const firstAllowed = (template?.target_cidades?.length
      ? preset.cidades.filter((c) => template!.target_cidades!.includes(c))
      : preset.cidades)[0];
    setSelectedCity(firstAllowed || "");
  }, [preset, template]);

  const previewCopy = useMemo(() => {
    if (!template || !preset) return null;
    const cidadeShown = selectedCity || preset.cidades[0] || "sua cidade";
    const fill = (s: string) => (s || "")
      .split("{cidade}").join(cidadeShown)
      .split("{distribuidora}").join(preset.nome)
      .split("{nome_consultor}").join(consultantName || "iGreen");
    return {
      headline: fill(template.headline),
      primary: fill(template.primary_text),
      description: fill(template.description_text),
    };
  }, [template, preset, consultantName, selectedCity]);

  const targetIds = template?.target_distribuidora_ids ?? [];
  const allowedPresets = useMemo(() => (
    targetIds.length
      ? DISTRIBUIDORAS_PRESETS.filter((p) => targetIds.includes(p.id))
      : DISTRIBUIDORAS_PRESETS
  ), [targetIds.join(",")]);
  const grouped = (["alto", "medio", "sem_bonus"] as const).map((tier) => ({
    tier, items: allowedPresets.filter((p) => p.tier === tier),
  }));
  const targetCities = template?.target_cidades ?? [];
  const presetCities = preset
    ? (targetCities.length ? preset.cidades.filter((c) => targetCities.includes(c)) : preset.cidades)
    : [];

  // Auto-select se só tem 1 distribuidora
  useEffect(() => {
    if (open && step === 1 && allowedPresets.length === 1 && !presetId) {
      setPresetId(allowedPresets[0].id);
    }
  }, [open, step, allowedPresets, presetId]);

  if (!template) return null;

  async function publish() {
    if (!preset) return;
    setSubmitting(true);
    try {
      setStepLog("Carregando cidades...");
      const raw = localStorage.getItem(cacheKey(preset.id));
      let hits: CityHit[] | null = null;
      try { const j = raw ? JSON.parse(raw) : null; if (Array.isArray(j?.cities)) hits = j.cities; } catch {}
      if (!hits) {
        const ufPrimary = preset.uf.split("/")[0];
        const cityNames = targetCities.length
          ? preset.cidades.filter((c) => targetCities.includes(c))
          : preset.cidades;
        const r = await searchCitiesBulk(cityNames.map((name) => ({ name, uf: ufPrimary })));
        hits = (r.cities || []).filter((h) => h?.key);
        if (hits.length) localStorage.setItem(cacheKey(preset.id), JSON.stringify({ ts: Date.now(), cities: hits }));
      }
      if (!hits?.length) throw new Error("Não consegui carregar as cidades");
      if (!selectedCity) throw new Error("Selecione 1 cidade para publicar (melhor CPL).");
      const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      const target = norm(selectedCity);
      let cities = hits.filter((c) => norm(c.name) === target).slice(0, 1);
      if (!cities.length) {
        // Fallback: 1ª cidade do preset se o nome não bater exatamente.
        cities = hits.slice(0, 1);
      }

      const suggestedBudgetCents = Math.max(2500, template!.suggested_daily_budget_cents);
      const suggestedDurationDays = 7;
      setStepLog("Validando alcance no Facebook...");
      const pf = await preflightCampaign({
        cities: cities.map((c) => ({ key: c.key, name: c.name })),
        daily_budget_cents: suggestedBudgetCents,
        duration_days: suggestedDurationDays,
        age_min: template!.age_min,
        age_max: template!.age_max,
      });
      if (!pf.ok) {
        throw new Error(pf.blockers.join(" | ") || "A pré-validação bloqueou a publicação.");
      }
      if (pf.reach && pf.reach.lower < 50_000) {
        throw new Error(`Audiência muito pequena (${pf.reach.lower.toLocaleString("pt-BR")} pessoas).`);
      }

      setStepLog("Publicando campanha...");
      await createCampaign({
        template_id: template!.id,
        name: `${template!.title} — ${preset.nome} (${cities[0]?.name || selectedCity})`,
        cities: cities.map((c) => ({ key: c.key, name: c.name })),
        daily_budget_cents: suggestedBudgetCents,
        duration_days: suggestedDurationDays,
        photos: template!.photos,
        headline: template!.headline,
        primary_text: template!.primary_text,
        description: template!.description_text || undefined,
        age_min: template!.age_min ?? 30,
        age_max: Math.min(template!.age_max ?? 60, 60),
        distribuidora: preset.nome,
      });
      toast({ title: "Campanha publicada!", description: "Em revisão pelo Facebook." });
      onPublished?.();
      onClose();
    } catch (e: any) {
      toast({ title: "Não consegui publicar", description: e?.message || "Tente novamente", variant: "destructive" });
    } finally {
      setSubmitting(false); setStepLog("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !submitting && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === 2 && <button onClick={() => setStep(1)} disabled={submitting}><ChevronLeft className="w-4 h-4" /></button>}
            {step === 1 ? "Escolha sua distribuidora" : "Pronto para publicar"}
          </DialogTitle>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-1">
              {template.photos.slice(0, 3).map((p, i) => (
                <img key={i} src={p.url} alt="" className="w-full aspect-square object-cover rounded" />
              ))}
            </div>
            <h3 className="font-bold">{template.title}</h3>

            {grouped.map(({ tier, items }) => items.length > 0 && (
              <div key={tier} className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{TIER_LABEL[tier]}</div>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((p) => {
                    const active = presetId === p.id;
                    return (
                      <button key={p.id} type="button"
                        onClick={() => setPresetId(p.id)}
                        className={`text-xs px-3 py-2 rounded-full border transition ${active ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-primary/10 border-border"}`}>
                        {p.nome} <span className="opacity-60">— {p.uf}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <Button className="w-full" disabled={!presetId} onClick={() => setStep(2)}>Continuar</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 flex items-start gap-2 text-xs">
              <UserCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div className="leading-snug">
                Anúncio em nome de <strong className="text-foreground">{consultantName || "você"}</strong>
                {connectedPhone && (
                  <> · clientes interessados chegam no WhatsApp <strong className="text-foreground">{formatPhone(connectedPhone)}</strong></>
                )}
                <div className="text-muted-foreground mt-0.5">Tudo automático — não precisa preencher nome nem telefone.</div>
              </div>
            </div>

            <Card className="p-3 space-y-2 bg-muted/30">
              <div className="grid grid-cols-3 gap-1">
                {template.photos.slice(0, 3).map((p, i) => (
                  <img key={i} src={p.url} alt="" className="w-full aspect-square object-cover rounded" />
                ))}
              </div>
              <div className="font-bold text-sm">{previewCopy?.headline}</div>
              <div className="text-xs whitespace-pre-line text-muted-foreground">{previewCopy?.primary}</div>
              {previewCopy?.description && <div className="text-[11px] text-muted-foreground">{previewCopy.description}</div>}
            </Card>

            <div className="space-y-1.5">
              <div className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
                Cidade do anúncio
              </div>
              <div className="flex flex-wrap gap-1.5">
                {presetCities.map((c) => (
                  <button key={c} type="button" onClick={() => setSelectedCity(c)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition ${selectedCity === c ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-primary/10 border-border"}`}>
                    {c}
                  </button>
                ))}
              </div>
              <div className="text-[10px] text-muted-foreground">
                1 cidade por campanha — baixa o CPL e melhora a conversão.
              </div>
            </div>

            <div className="text-xs flex gap-2 rounded border border-warning/40 p-3 bg-destructive">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-destructive" />
              <div className="space-y-0.5">
                <div className="font-semibold text-primary">Use WhatsApp Business</div>
                <div className="text-gray-900">
                  O Facebook só entrega anúncios de mensagem para números cadastrados como <strong>WhatsApp Business</strong>. Se ainda usa o WhatsApp comum, baixe o app <em>WhatsApp Business</em> e migre o número antes de publicar — caso contrário a campanha será reprovada.
                </div>
              </div>
            </div>

            <div className="text-xs space-y-1 rounded border border-primary/30 bg-primary/5 p-3">
              <div>📍 <strong>{preset?.nome}</strong> — {selectedCity || "escolha 1 cidade"}</div>
              <div>💰 <strong>R$ {(Math.max(1000, template.suggested_daily_budget_cents) / 100).toFixed(0)}/dia</strong>, por 7 dias</div>
              <div>👥 Idade {template.age_min}-{template.age_max}, LAL da plataforma + exclusão de clientes ativos</div>
              <div>📱 Clientes interessados chegam direto no seu WhatsApp configurado</div>
            </div>

            {stepLog && (
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> {stepLog}
              </div>
            )}

            <Button className="w-full gap-2" size="lg" onClick={publish} disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
              Publicar agora
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}