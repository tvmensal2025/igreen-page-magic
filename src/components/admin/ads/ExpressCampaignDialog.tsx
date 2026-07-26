// Modo Express — 1 tela, 5 escolhas. Tudo o mais é pré-marcado automático.
// Cidade/rua • Imagem • Copy • Valor • Dias  →  Publicar.
// Default geo = raio na sede (brain_config); mensagem inicial WhatsApp obrigatória.
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Loader2, MapPin, Image as ImageIcon, Type, DollarSign, Calendar, Sparkles, Check, Upload, RotateCcw, ExternalLink, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { searchCities, type CityHit, createCampaign, preflightCampaign, uploadAdPhotos } from "@/services/facebookAds";
import { fetchExpressSuggestions, type ExpressSuggestions, type ExpressImage } from "@/services/expressCampaign";
import { AddressRadiusPicker, type RadiusPoint } from "./AddressRadiusPicker";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { INITIAL_MSG_LIMIT } from "./campaign-wizard/wizardHelpers";

interface Props {
  open: boolean;
  onClose: () => void;
  consultantId: string;
  onCreated?: () => void;
  onOpenAdvanced?: () => void;
}

const DAY_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: "3 dias", value: 3 },
  { label: "7 dias", value: 7 },
  { label: "14 dias", value: 14 },
  { label: "Contínuo", value: null },
];

const SEDE_DEFAULT_MSG = "Oi! Quero saber como consigo pagar menos na conta de luz.";
const EXPRESS_DEFAULT_BUDGET = 30;

function cityQueryFromSede(bc: Record<string, unknown>): string {
  const name = typeof bc.sede_name === "string" ? bc.sede_name.trim() : "";
  const address = typeof bc.sede_address === "string" ? bc.sede_address.trim() : "";
  const raw = name || address || "Uberlândia";
  if (/uberl[aá]ndia|udi\b/i.test(raw)) return "Uberlândia";
  const first = raw.split(/[,/·—–-]/)[0]?.trim() || raw;
  return first.slice(0, 60) || "Uberlândia";
}

export function ExpressCampaignDialog({ open, onClose, consultantId, onCreated, onOpenAdvanced }: Props) {
  const { toast } = useToast();

  // 1) ONDE — default = raio na sede (política Meta 2026)
  const [geoMode, setGeoMode] = useState<"cities" | "radius">("radius");
  const [cityQuery, setCityQuery] = useState("");
  const [cityHits, setCityHits] = useState<CityHit[]>([]);
  const [citySearching, setCitySearching] = useState(false);
  const [cities, setCities] = useState<CityHit[]>([]);
  const [radiusPoints, setRadiusPoints] = useState<RadiusPoint[]>([]);
  const [sedeRadiusKm, setSedeRadiusKm] = useState(50);
  const [sedeHint, setSedeHint] = useState<string | null>(null);

  // Sugestões
  const [suggestions, setSuggestions] = useState<ExpressSuggestions | null>(null);
  const [loadingSugg, setLoadingSugg] = useState(false);

  // 2) IMAGEM
  const [selectedImage, setSelectedImage] = useState<ExpressImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 3) COPY
  const [selectedCopyIdx, setSelectedCopyIdx] = useState(0);

  // Mensagem inicial WhatsApp (obrigatória em toda campanha)
  const [initialMessage, setInitialMessage] = useState(SEDE_DEFAULT_MSG);

  // 4-5) VALOR / DIAS
  const [budget, setBudget] = useState(15);
  const [days, setDays] = useState<number | null>(7);

  const [publishing, setPublishing] = useState(false);

  // Reset on open + pré-carrega cidade da sede (molde vencedor — não raio frio)
  useEffect(() => {
    if (!open) return;
    setGeoMode("cities");
    setCityQuery(""); setCityHits([]); setCities([]); setRadiusPoints([]);
    setSuggestions(null); setSelectedImage(null); setSelectedCopyIdx(0);
    setBudget(EXPRESS_DEFAULT_BUDGET); setDays(7);
    setInitialMessage(SEDE_DEFAULT_MSG);
    setSedeHint(null);
    setSedeRadiusKm(50);

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("consultant_ad_settings")
        .select("brain_config")
        .eq("consultant_id", consultantId)
        .maybeSingle();
      if (cancelled || !data?.brain_config) return;
      const bc = data.brain_config as Record<string, unknown>;
      const radius = Math.max(1, Math.min(50, Number(bc.sede_radius_km) || 50));
      const address = typeof bc.sede_address === "string" && bc.sede_address.trim()
        ? bc.sede_address.trim()
        : "Sede iGreen";
      const name = typeof bc.sede_name === "string" && bc.sede_name.trim()
        ? bc.sede_name.trim()
        : "Sede";
      setSedeRadiusKm(radius);
      const lat = Number(bc.sede_latitude);
      const lng = Number(bc.sede_longitude);
      // Raio fica disponível como opção avançada, mas default = cidade Meta da sede
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setRadiusPoints([{
          latitude: lat,
          longitude: lng,
          radius,
          address_string: address,
          name,
        }]);
      }
      try {
        const q = cityQueryFromSede(bc);
        const r = await searchCities(q);
        if (cancelled) return;
        const hit = r.cities.find((c) => /uberl/i.test(c.name)) || r.cities[0];
        if (hit?.key) {
          setCities([hit]);
          setGeoMode("cities");
          setSedeHint(`${hit.name} · cidade da sede (molde vencedor)`);
          const anchorBudget = Number(bc.anchor_budget_cents);
          if (Number.isFinite(anchorBudget) && anchorBudget >= 3000) {
            setBudget(Math.round(anchorBudget) / 100);
          }
          return;
        }
      } catch { /* fallback raio abaixo */ }
      if (cancelled) return;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setSedeHint(`${name} · ${radius} km (fallback raio)`);
        setGeoMode("radius");
      }
    })();
    return () => { cancelled = true; };
  }, [open, consultantId]);

  // Autocomplete cidades (debounce)
  useEffect(() => {
    if (geoMode !== "cities" || cityQuery.length < 2) { setCityHits([]); return; }
    const t = setTimeout(async () => {
      setCitySearching(true);
      try {
        const r = await searchCities(cityQuery);
        setCityHits(r.cities);
      } catch { setCityHits([]); }
      finally { setCitySearching(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [cityQuery, geoMode]);

  function addCity(c: CityHit) {
    if (cities.some((x) => x.key === c.key)) return;
    setCities((prev) => [...prev, c]);
    setCityQuery(""); setCityHits([]);
  }
  function removeCity(key: string) { setCities((prev) => prev.filter((x) => x.key !== key)); }

  const cityNames = useMemo(() => {
    if (geoMode === "cities") return cities.map((c) => c.name);
    return radiusPoints.map((p) => p.address_string.split(",")[0]);
  }, [geoMode, cities, radiusPoints]);

  async function loadSuggestions(names: string[]) {
    setLoadingSugg(true);
    try {
      const s = await fetchExpressSuggestions({ consultantId, cities: names });
      setSuggestions(s);
      if (!selectedImage && s.images.length) setSelectedImage(s.images[0]);
      setBudget(Math.max(5.17, Math.round((s.defaults.budget_cents / 100) * 100) / 100));
      setDays(s.defaults.duration_days ?? 7);
      if (s.defaults.initial_message?.trim()) {
        setInitialMessage((prev) =>
          prev === SEDE_DEFAULT_MSG ? s.defaults.initial_message : prev
        );
      }
    } catch (e: any) {
      toast({ title: "Falha ao carregar sugestões", description: e.message, variant: "destructive" });
    } finally { setLoadingSugg(false); }
  }

  useEffect(() => {
    if (!open || cityNames.length === 0) return;
    loadSuggestions(cityNames);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cityNames.join("|")]);

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const [url] = await uploadAdPhotos(consultantId, [file], { formats: ["square"] });
      const img: ExpressImage = {
        id: `up-${Date.now()}`, url, format: "square", usage_count: 0, is_top: false, source: "uploaded",
      };
      setSuggestions((s) => s ? { ...s, images: [img, ...s.images] } : s);
      setSelectedImage(img);
    } catch (e: any) {
      toast({ title: "Falha no upload", description: e.message, variant: "destructive" });
    } finally { setUploading(false); }
  }

  async function regenerateCopies() {
    if (cityNames.length === 0) return;
    await loadSuggestions(cityNames);
    setSelectedCopyIdx(0);
  }

  function canPublish(): string | null {
    if (cityNames.length === 0) return "Escolha pelo menos 1 cidade ou endereço.";
    if (!selectedImage) return "Selecione uma imagem.";
    if (!suggestions?.copies[selectedCopyIdx]) return "Aguardando geração da copy...";
    if (budget < 5.17) return "Orçamento mínimo R$ 5,17/dia.";
    if (initialMessage.trim().length < 5) {
      return "Escreva a mensagem inicial do WhatsApp (obrigatória em toda campanha).";
    }
    return null;
  }

  async function publish() {
    const err = canPublish();
    if (err) { toast({ title: err, variant: "destructive" }); return; }
    const copy = suggestions!.copies[selectedCopyIdx];
    const defaults = suggestions!.defaults;
    setPublishing(true);
    try {
      const campaignName = geoMode === "cities"
        ? `iGreen Express — ${cities.map(c => c.name).slice(0, 2).join(", ")}`
        : `iGreen Express — ${radiusPoints[0]?.address_string.slice(0, 40) || "Raio"}`;
      const targeting = {
        cities: geoMode === "cities" ? cities.map((c) => ({ key: c.key, name: c.name })) : [],
        custom_locations: geoMode === "radius"
          ? radiusPoints.map((p) => ({
              latitude: p.latitude, longitude: p.longitude,
              radius: p.radius, address_string: p.address_string, name: p.name,
            }))
          : undefined,
      };
      const preflight = await preflightCampaign({
        ...targeting,
        daily_budget_cents: Math.round(budget * 100),
        duration_days: days,
        age_min: defaults.age_min,
        age_max: defaults.age_max,
      });
      if (!preflight.ok) {
        throw new Error(preflight.blockers.join(" | ") || "A pré-validação bloqueou a publicação.");
      }
      await createCampaign({
        name: campaignName,
        ...targeting,
        daily_budget_cents: Math.round(budget * 100),
        duration_days: days,
        creative_mode: "photo",
        photos: [{ url: selectedImage!.url, format: selectedImage!.format }],
        headline: copy.headline,
        primary_text: copy.primary_text,
        description: copy.description,
        age_min: defaults.age_min,
        age_max: defaults.age_max,
        distribuidora: defaults.distribuidora?.nome,
        placement_mode: "auto",
        initial_message: initialMessage.trim(),
      });
      toast({ title: "Campanha publicada!", description: "Em análise pelo Facebook (~15min)." });
      onCreated?.();
      onClose();
    } catch (e: any) {
      toast({ title: "Falha ao publicar", description: e.message, variant: "destructive" });
    } finally { setPublishing(false); }
  }

  const blocker = canPublish();
  const defaults = suggestions?.defaults || null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !publishing && onClose()}>
      <DialogContent className="ads-central-2026 max-w-3xl max-h-[92vh] overflow-y-auto p-0 border-[hsl(var(--ads-border))]">
        <div className="relative px-6 pt-6 pb-4 border-b border-[hsl(var(--ads-border))] bg-[var(--ads-gradient-tile)]">
          <div className="absolute inset-x-0 top-0 h-1 bg-[var(--ads-gradient-gold)]" />
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[hsl(var(--ads-emerald-2))] font-semibold">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[var(--ads-gradient-emerald)] text-[hsl(45_60%_95%)] shadow-sm">
                <Sparkles className="w-4 h-4" />
              </span>
              Modo Express
              <span className="text-xs font-normal text-[hsl(var(--ads-muted))]">— 5 passos, 1 publicação</span>
            </DialogTitle>
          </DialogHeader>
        </div>
        <div className="px-6 pb-6 pt-2">

        <div className="space-y-5 mt-2">
          {/* 1) ONDE */}
          <section className="space-y-2">
            <Label className="flex items-center gap-1.5 text-sm"><MapPin className="w-4 h-4 text-primary" /> 1. Onde anunciar</Label>
            {sedeHint && (
              <p className="text-[11px] text-muted-foreground">
                Pré-preenchido: {sedeHint}. Preferência: cidade da sede (mais barato que raio frio).
              </p>
            )}
            <Tabs value={geoMode} onValueChange={(v) => setGeoMode(v as any)}>
              <TabsList className="h-8">
                <TabsTrigger value="cities" className="text-xs h-7">Cidade(s)</TabsTrigger>
                <TabsTrigger value="radius" className="text-xs h-7">Rua + raio</TabsTrigger>
              </TabsList>
              <TabsContent value="cities" className="mt-2 space-y-2">
                <Popover open={cityHits.length > 0}>
                  <PopoverAnchor asChild>
                    <div className="relative">
                      <Input placeholder="Digite o nome da cidade..." value={cityQuery} onChange={(e) => setCityQuery(e.target.value)} className="h-9" />
                      {citySearching && <Loader2 className="absolute right-2 top-2 w-4 h-4 animate-spin text-muted-foreground" />}
                    </div>
                  </PopoverAnchor>
                  <PopoverContent
                    align="start"
                    sideOffset={4}
                    className="w-[var(--radix-popover-trigger-width)] p-0 max-h-48 overflow-y-auto"
                    onOpenAutoFocus={(e) => e.preventDefault()}
                  >
                    {cityHits.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => addCity(c)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
                      >
                        {c.name} {c.region && <span className="text-muted-foreground">— {c.region}</span>}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
                {cities.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {cities.map((c) => (
                      <Badge key={c.key} variant="secondary" className="gap-1 cursor-pointer" onClick={() => removeCity(c.key)}>
                        {c.name} ×
                      </Badge>
                    ))}
                  </div>
                )}
              </TabsContent>
              <TabsContent value="radius" className="mt-2">
                <AddressRadiusPicker
                  value={radiusPoints}
                  onChange={setRadiusPoints}
                  defaultRadius={sedeRadiusKm}
                />
              </TabsContent>
            </Tabs>
          </section>

          {/* 2) IMAGEM */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-sm"><ImageIcon className="w-4 h-4 text-primary" /> 2. Imagem</Label>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Subir nova
              </Button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} />
            </div>
            {loadingSugg && !suggestions ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-4"><Loader2 className="w-4 h-4 animate-spin" /> Carregando imagens…</div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {(suggestions?.images || []).slice(0, 8).map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setSelectedImage(img)}
                    className={`relative aspect-square rounded-md overflow-hidden border-2 ${selectedImage?.id === img.id ? "border-primary" : "border-transparent"}`}
                  >
                    <img src={img.url} alt="" className="w-full h-full object-cover" />
                    {selectedImage?.id === img.id && (
                      <span className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full p-0.5"><Check className="w-3 h-3" /></span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* 3) COPY */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-sm"><Type className="w-4 h-4 text-primary" /> 3. Texto do anúncio</Label>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={regenerateCopies} disabled={loadingSugg || cityNames.length === 0}>
                <RotateCcw className="w-3.5 h-3.5" /> Gerar de novo
              </Button>
            </div>
            {suggestions?.copies?.length ? (
              <div className="grid gap-2">
                {suggestions.copies.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelectedCopyIdx(i)}
                    className={`text-left rounded-md border p-3 text-sm transition-colors ${selectedCopyIdx === i ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}
                  >
                    <div className="font-medium text-xs text-muted-foreground mb-1">{c.framework}</div>
                    <div className="font-semibold leading-snug">{c.headline}</div>
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.primary_text}</div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Escolha a região para gerar as copies.</p>
            )}
          </section>

          {/* Mensagem inicial WhatsApp — obrigatória */}
          <section className="space-y-2">
            <Label className="flex items-center gap-1.5 text-sm">
              <MessageSquare className="w-4 h-4 text-primary" />
              Mensagem inicial do WhatsApp
              <Badge variant="secondary" className="text-[10px] font-normal">obrigatória</Badge>
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Frase que o lead envia ao clicar no anúncio. Toda campanha precisa ter uma — e deve ser única entre as suas campanhas ativas.
            </p>
            <Textarea
              rows={2}
              maxLength={INITIAL_MSG_LIMIT}
              value={initialMessage}
              onChange={(e) => setInitialMessage(e.target.value)}
              placeholder="Ex.: Oi! Quero saber como economizar na conta de luz."
              className="text-sm"
            />
            <div className="text-[10px] text-muted-foreground text-right">
              {initialMessage.length}/{INITIAL_MSG_LIMIT}
            </div>
          </section>

          {/* 4-5) VALOR + DIAS */}
          <section className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-sm"><DollarSign className="w-4 h-4 text-primary" /> 4. Valor por dia (R$)</Label>
              <Input type="number" min={5.17} max={500} step={0.01} value={budget}
                onChange={(e) => setBudget(Math.max(5.17, Number(e.target.value) || 5.17))} className="h-9" />
              <p className="text-[11px] text-muted-foreground">A sugestão considera seu histórico; ajuste conforme a verba disponível.</p>
              {defaults && defaults.budget_cents !== 1500 && (
                <p className="text-[11px] text-muted-foreground">Média dos seus winners: R$ {(defaults.budget_cents / 100).toFixed(0)}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-sm"><Calendar className="w-4 h-4 text-primary" /> 5. Duração</Label>
              <div className="flex gap-1.5 flex-wrap">
                {DAY_OPTIONS.map((opt) => (
                  <Button key={opt.label} size="sm" variant={days === opt.value ? "default" : "outline"}
                    onClick={() => setDays(opt.value)} className="h-8 text-xs">{opt.label}</Button>
                ))}
              </div>
            </div>
          </section>

          <Accordion type="single" collapsible>
            <AccordionItem value="auto" className="border rounded-md">
              <AccordionTrigger className="px-3 py-2 text-xs hover:no-underline">
                <span className="flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-primary" /> Pré-marcado automático (otimizado pela IA)</span>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 space-y-1 text-xs text-muted-foreground">
                <div>• <strong>Distribuidora:</strong> {defaults?.distribuidora?.nome || "será deduzida da cidade"}</div>
                <div>• <strong>Idade:</strong> {defaults?.age_min || 30}–{defaults?.age_max || 60} anos · todos os gêneros</div>
                <div>• <strong>Posicionamentos:</strong> Advantage+ (Meta otimiza)</div>
                <div>• <strong>Mensagem inicial WhatsApp:</strong> "{initialMessage.trim() || "—"}"</div>
                <div>• <strong>Headline e descrição:</strong> vêm com a copy escolhida</div>
                {onOpenAdvanced && (
                  <button onClick={() => { onClose(); setTimeout(onOpenAdvanced, 100); }}
                    className="text-primary hover:underline inline-flex items-center gap-1 mt-1">
                    Modo avançado (controle total) <ExternalLink className="w-3 h-3" />
                  </button>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {blocker && (
            <p className="text-xs text-muted-foreground text-center">{blocker}</p>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="ghost" onClick={onClose} disabled={publishing}>Cancelar</Button>
            <Button onClick={publish} disabled={!!blocker || publishing} className="gap-2 min-w-[180px]">
              {publishing ? <><Loader2 className="w-4 h-4 animate-spin" /> Publicando...</> : <><Sparkles className="w-4 h-4" /> Publicar campanha</>}
            </Button>
          </div>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
