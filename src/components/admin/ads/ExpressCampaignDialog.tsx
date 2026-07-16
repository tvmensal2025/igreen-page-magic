// Modo Express — 1 tela, 5 escolhas. Tudo o mais é pré-marcado automático.
// Cidade/rua • Imagem • Copy • Valor • Dias  →  Publicar.
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Loader2, MapPin, Image as ImageIcon, Type, DollarSign, Calendar, Sparkles, Check, Upload, RotateCcw, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { searchCities, type CityHit, createCampaign, preflightCampaign, uploadAdPhotos } from "@/services/facebookAds";
import { fetchExpressSuggestions, type ExpressSuggestions, type ExpressImage, type ExpressCopy } from "@/services/expressCampaign";
import { AddressRadiusPicker, type RadiusPoint } from "./AddressRadiusPicker";

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

export function ExpressCampaignDialog({ open, onClose, consultantId, onCreated, onOpenAdvanced }: Props) {
  const { toast } = useToast();

  // 1) ONDE
  const [geoMode, setGeoMode] = useState<"cities" | "radius">("cities");
  const [cityQuery, setCityQuery] = useState("");
  const [cityHits, setCityHits] = useState<CityHit[]>([]);
  const [citySearching, setCitySearching] = useState(false);
  const [cities, setCities] = useState<CityHit[]>([]);
  const [radiusPoints, setRadiusPoints] = useState<RadiusPoint[]>([]);

  // Sugestões
  const [suggestions, setSuggestions] = useState<ExpressSuggestions | null>(null);
  const [loadingSugg, setLoadingSugg] = useState(false);

  // 2) IMAGEM
  const [selectedImage, setSelectedImage] = useState<ExpressImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 3) COPY
  const [selectedCopyIdx, setSelectedCopyIdx] = useState(0);

  // 4-5) VALOR / DIAS
  const [budget, setBudget] = useState(15);
  const [days, setDays] = useState<number | null>(7);

  const [publishing, setPublishing] = useState(false);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setGeoMode("cities");
    setCityQuery(""); setCityHits([]); setCities([]); setRadiusPoints([]);
    setSuggestions(null); setSelectedImage(null); setSelectedCopyIdx(0);
    setBudget(15); setDays(7);
  }, [open]);

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

  // Quando muda cidades/raio → recarrega sugestões
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
      setBudget(Math.max(10, Math.round(s.defaults.budget_cents / 100)));
      setDays(s.defaults.duration_days ?? 7);
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
    if (budget < 10) return "Orçamento mínimo R$ 10/dia.";
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
        initial_message: defaults.initial_message,
      });
      toast({ title: "Campanha publicada!", description: "Em análise pelo Facebook (~15min)." });
      onCreated?.();
      onClose();
    } catch (e: any) {
      toast({ title: "Falha ao publicar", description: e.message, variant: "destructive" });
    } finally { setPublishing(false); }
  }

  const blocker = canPublish();
  const copy = suggestions?.copies[selectedCopyIdx] || null;
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
            <Tabs value={geoMode} onValueChange={(v) => setGeoMode(v as any)}>
              <TabsList className="h-8">
                <TabsTrigger value="cities" className="text-xs h-7">Cidade(s)</TabsTrigger>
                <TabsTrigger value="radius" className="text-xs h-7">Rua + raio</TabsTrigger>
              </TabsList>
              <TabsContent value="cities" className="mt-2 space-y-2">
                <div className="relative">
                  <Input placeholder="Digite o nome da cidade..." value={cityQuery} onChange={(e) => setCityQuery(e.target.value)} className="h-9" />
                  {citySearching && <Loader2 className="absolute right-2 top-2 w-4 h-4 animate-spin text-muted-foreground" />}
                  {cityHits.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover shadow-lg">
                      {cityHits.map((c) => (
                        <button key={c.key} onClick={() => addCity(c)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-accent">
                          {c.name} {c.region && <span className="text-muted-foreground">— {c.region}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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
                <AddressRadiusPicker value={radiusPoints} onChange={setRadiusPoints} />
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
              <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando suas top imagens...</div>
            ) : suggestions && suggestions.images.length === 0 ? (
              <div className="text-xs text-muted-foreground border border-dashed rounded-md p-3">
                Nenhuma imagem no histórico. Clique em <strong>Subir nova</strong> para começar.
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {suggestions?.images.slice(0, 8).map((img) => {
                  const selected = selectedImage?.id === img.id;
                  return (
                    <button key={img.id} onClick={() => setSelectedImage(img)}
                      className={`relative aspect-square rounded-md overflow-hidden border-2 transition ${selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40"}`}>
                      <img src={img.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                      {img.is_top && <Badge className="absolute top-1 left-1 text-[10px] h-4 px-1.5 bg-primary">★ Top</Badge>}
                      {selected && <div className="absolute inset-0 bg-primary/10 flex items-center justify-center"><Check className="w-6 h-6 text-primary" /></div>}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* 3) COPY */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-sm"><Type className="w-4 h-4 text-primary" /> 3. Copy (escolha 1)</Label>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={regenerateCopies} disabled={loadingSugg}>
                {loadingSugg ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Gerar outras
              </Button>
            </div>
            {loadingSugg && !suggestions ? (
              <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Gerando 3 variações com IA...</div>
            ) : suggestions && suggestions.copies.length === 0 ? (
              <div className="text-xs text-muted-foreground border border-dashed rounded-md p-3">Aguardando cidade pra gerar a copy.</div>
            ) : (
              <div className="grid sm:grid-cols-3 gap-2">
                {suggestions?.copies.map((c, i) => {
                  const selected = selectedCopyIdx === i;
                  return (
                    <button key={i} onClick={() => setSelectedCopyIdx(i)}
                      className={`text-left p-3 rounded-md border-2 transition ${selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5">{c.framework}</Badge>
                        {selected && <Check className="w-4 h-4 text-primary" />}
                      </div>
                      <div className="text-sm font-semibold line-clamp-2 mb-1">{c.headline}</div>
                      <div className="text-xs text-muted-foreground line-clamp-4">{c.primary_text}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* 4-5) VALOR + DIAS */}
          <section className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-sm"><DollarSign className="w-4 h-4 text-primary" /> 4. Valor por dia (R$)</Label>
              <Input type="number" min={10} max={500} value={budget}
                onChange={(e) => setBudget(Math.max(10, Number(e.target.value) || 10))} className="h-9" />
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

          {/* Pré-marcado automático */}
          <Accordion type="single" collapsible>
            <AccordionItem value="auto" className="border rounded-md">
              <AccordionTrigger className="px-3 py-2 text-xs hover:no-underline">
                <span className="flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-primary" /> Pré-marcado automático (otimizado pela IA)</span>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 space-y-1 text-xs text-muted-foreground">
                <div>• <strong>Distribuidora:</strong> {defaults?.distribuidora?.nome || "será deduzida da cidade"}</div>
                <div>• <strong>Idade:</strong> {defaults?.age_min || 30}–{defaults?.age_max || 60} anos · todos os gêneros</div>
                <div>• <strong>Posicionamentos:</strong> Advantage+ (Meta otimiza)</div>
                <div>• <strong>Mensagem inicial WhatsApp:</strong> "{defaults?.initial_message || "Olá! Quero economizar."}"</div>
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
