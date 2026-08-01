/**
 * Cérebro Inteligente — título, foto/vídeo, valor do dia + teto máximo.
 * Explica sobe/desce 15% e mostra o que falta para publicar.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2, Sparkles, MapPin, DollarSign, Image as ImageIcon, Film, Brain, Upload,
  ArrowUp, ArrowDown, Minus, CheckCircle2, Circle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  loadSmartAnchorPreview,
  publishSmartAnchorCampaign,
  saveSmartSedeLocation,
  smartPublishGaps,
  uploadSmartPhoto,
  uploadSmartVideo,
  SMART_META_FLOOR_CENTS,
  SMART_ANCHOR_HARD_MAX_CENTS,
  SMART_ANCHOR_MIN_BUDGET_CENTS,
  type SmartAnchorPreview,
  type SmartCreativeMode,
} from "@/services/smartAnchorCampaign";

interface Props {
  open: boolean;
  onClose: () => void;
  consultantId: string;
  onCreated?: () => void;
}

function reaisToCents(raw: string): number {
  const n = Number(String(raw).replace(",", ".").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

type SedeSuggestion = {
  lat: string;
  lon: string;
  display_name: string;
  place_id: number;
};

export function SmartAnchorCampaignDialog({ open, onClose, consultantId, onCreated }: Props) {
  const { toast } = useToast();
  const [preview, setPreview] = useState<SmartAnchorPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);

  const [sedeQuery, setSedeQuery] = useState("");
  const [sedeSuggestions, setSedeSuggestions] = useState<SedeSuggestion[]>([]);
  const [sedeSearching, setSedeSearching] = useState(false);
  const [sedeSaving, setSedeSaving] = useState(false);
  const sedeAbortRef = useRef<AbortController | null>(null);

  async function reloadPreview() {
    const p = await loadSmartAnchorPreview(consultantId);
    setPreview(p);
    setError(null);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreview(null);
    setSedeQuery("");
    setSedeSuggestions([]);
    (async () => {
      try {
        const p = await loadSmartAnchorPreview(consultantId);
        if (!cancelled) setPreview(p);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Não foi possível preparar a campanha.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, consultantId]);

  useEffect(() => {
    if (!preview || preview.hasSede) return;
    if (sedeQuery.trim().length < 3) {
      setSedeSuggestions([]);
      return;
    }
    const handle = window.setTimeout(async () => {
      setSedeSearching(true);
      sedeAbortRef.current?.abort();
      const ctrl = new AbortController();
      sedeAbortRef.current = ctrl;
      try {
        const url =
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=br&limit=6&q=${encodeURIComponent(sedeQuery.trim())}`;
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error("busca_falhou");
        const data = (await res.json()) as SedeSuggestion[];
        setSedeSuggestions(Array.isArray(data) ? data : []);
      } catch (e: any) {
        if (e?.name !== "AbortError") setSedeSuggestions([]);
      } finally {
        setSedeSearching(false);
      }
    }, 400);
    return () => window.clearTimeout(handle);
  }, [sedeQuery, preview?.hasSede]);

  async function handlePickSede(s: SedeSuggestion) {
    setSedeSaving(true);
    try {
      const name = String(s.display_name || "").split(",")[0]?.trim() || "Minha sede";
      await saveSmartSedeLocation(consultantId, {
        name,
        address: s.display_name,
        latitude: Number(s.lat),
        longitude: Number(s.lon),
        radiusKm: 50,
      });
      setSedeQuery("");
      setSedeSuggestions([]);
      await reloadPreview();
      toast({
        title: "Sede salva",
        description: `Vamos anunciar em torno de ${name}.`,
        duration: 2500,
      });
    } catch (e: any) {
      toast({
        title: "Não deu para salvar a sede",
        description: e?.message || "Tente outro endereço.",
        variant: "destructive",
      });
    } finally {
      setSedeSaving(false);
    }
  }

  function patchPreview(p: Partial<SmartAnchorPreview>) {
    setPreview((prev) => (prev ? { ...prev, ...p } : prev));
  }

  function setMode(mode: SmartCreativeMode) {
    patchPreview({ creativeMode: mode });
  }

  const gaps = useMemo(() => (preview ? smartPublishGaps(preview) : []), [preview]);

  async function handleUploadPhoto(file: File) {
    setUploading(true);
    try {
      const url = await uploadSmartPhoto(consultantId, file);
      patchPreview({
        creativeMode: "photo",
        photoUrl: url,
        libraryPhotos: [
          { id: `up-${Date.now()}`, url, thumbUrl: url, label: file.name, kind: "photo" },
          ...(preview?.libraryPhotos || []),
        ],
      });
    } catch (e: any) {
      toast({ title: "Falha no upload da foto", description: e?.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleUploadVideo(file: File) {
    setUploading(true);
    try {
      const { url, thumbUrl } = await uploadSmartVideo(consultantId, file);
      patchPreview({
        creativeMode: "video",
        videoUrl: url,
        videoThumbUrl: thumbUrl,
        libraryVideos: [
          { id: `up-${Date.now()}`, url, thumbUrl, label: file.name, kind: "video" },
          ...(preview?.libraryVideos || []),
        ],
      });
    } catch (e: any) {
      toast({ title: "Falha no upload do vídeo", description: e?.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handlePublish() {
    if (!preview || publishing) return;
    const missing = smartPublishGaps(preview);
    if (missing.length) {
      toast({ title: "Ainda falta algo", description: missing[0], variant: "destructive" });
      return;
    }
    setPublishing(true);
    try {
      await publishSmartAnchorCampaign(consultantId, preview);
      toast({
        title: "Anúncio inteligente publicado",
        description: "Campanha criada. O sistema sobe ou desce o valor sozinho conforme o custo do contato.",
      });
      onCreated?.();
      onClose();
    } catch (e: any) {
      toast({
        title: "Falha ao publicar",
        description: e?.message || String(e),
        variant: "destructive",
      });
    } finally {
      setPublishing(false);
    }
  }

  const canPublish = !!preview && gaps.length === 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !publishing && onClose()}>
      <DialogContent className="ads-central-2026 max-w-2xl max-h-[92vh] overflow-y-auto border-[hsl(var(--ads-border))]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[hsl(var(--ads-emerald-2))]">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--ads-gradient-emerald)] text-[hsl(45_60%_95%)]">
              <Brain className="h-4 w-4" />
            </span>
            Anúncio inteligente
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Preparando sua campanha…
          </div>
        )}

        {error && !loading && (
          <p className="text-sm text-destructive py-4">{error}</p>
        )}

        {preview && !loading && !preview.hasSede && (
          <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex items-start gap-2">
              <MapPin className="h-5 w-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Onde fica a sua sede?
                </p>
                <p className="text-[12px] text-muted-foreground leading-relaxed">
                  O anúncio precisa saber a cidade em que você atende. Digite a cidade ou o bairro
                  e escolha na lista — leva menos de 1 minuto.
                </p>
              </div>
            </div>
            <div className="relative">
              <Input
                value={sedeQuery}
                onChange={(e) => setSedeQuery(e.target.value)}
                placeholder="Ex.: Uberlândia, MG ou bairro Jaraguá"
                className="h-10"
                disabled={sedeSaving}
                autoFocus
              />
              {(sedeSearching || sedeSaving) && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {sedeSuggestions.length > 0 && !sedeSaving && (
                <ul className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
                  {sedeSuggestions.map((s) => (
                    <li key={s.place_id}>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-xs hover:bg-muted/80"
                        onClick={() => void handlePickSede(s)}
                      >
                        {s.display_name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Depois disso você escolhe foto, valor do dia e publica.
            </p>
            <Button variant="outline" className="w-full" disabled={sedeSaving} onClick={onClose}>
              Cancelar
            </Button>
          </div>
        )}

        {preview && !loading && preview.hasSede && (
          <div className="space-y-4 text-sm">
            <div className="rounded-lg border border-[hsl(var(--ads-emerald)/.3)] bg-[hsl(var(--ads-emerald)/.08)] p-3 text-[12px] leading-relaxed text-[hsl(var(--ads-text))] space-y-2">
              <p>
                <strong>O que faz:</strong> sobe 1 anúncio na cidade da sua sede e abre o WhatsApp.
                Você escolhe título, foto ou vídeo, e o <strong>quanto pode gastar por dia</strong>.
              </p>
              <div className="rounded-md bg-background/60 border border-[hsl(var(--ads-border))] p-2 space-y-1.5 text-[11px]">
                <div className="font-medium text-[hsl(var(--ads-text))]">Como o sistema mexe no dinheiro sozinho</div>
                <div className="flex gap-2 items-start">
                  <ArrowUp className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                  <span>Contato barato (até ~R$ 7,50) → <strong>sobe ~15%</strong> o valor do dia</span>
                </div>
                <div className="flex gap-2 items-start">
                  <ArrowDown className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                  <span>Contato caro → <strong>desce ~15%</strong></span>
                </div>
                <div className="flex gap-2 items-start">
                  <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <span>No meio → mantém. Nunca passa do <strong>teto máximo</strong> que você definir.</span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[hsl(var(--ads-border))] bg-secondary/20 p-3 space-y-1.5">
              <div className="flex items-start gap-2">
                <MapPin className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium">{preview.city.name}</div>
                  <div className="text-[11px] text-muted-foreground">Sede: {preview.sedeLabel}</div>
                </div>
              </div>
              {preview.walletHint && (
                <p className="text-[11px] text-amber-700 dark:text-amber-500 pl-6">{preview.walletHint}</p>
              )}
              {preview.walletLiquidCents != null && !preview.walletHint && (
                <p className="text-[11px] text-muted-foreground pl-6">
                  Saldo na carteira: R$ {(preview.walletLiquidCents / 100).toFixed(2)}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1">
                  <DollarSign className="h-3 w-3" /> Valor do dia (mínimo)
                </Label>
                <Input
                  type="number"
                  min={SMART_META_FLOOR_CENTS / 100}
                  max={SMART_ANCHOR_HARD_MAX_CENTS / 100}
                  step="1"
                  value={centsToInput(preview.budgetCents)}
                  onChange={(e) => {
                    const cents = reaisToCents(e.target.value);
                    const next = Math.max(SMART_META_FLOOR_CENTS, Math.min(SMART_ANCHOR_HARD_MAX_CENTS, cents || SMART_ANCHOR_MIN_BUDGET_CENTS));
                    patchPreview({
                      budgetCents: next,
                      maxBudgetCents: Math.max(next, preview.maxBudgetCents),
                    });
                  }}
                  className="h-9"
                />
                <p className="text-[10px] text-muted-foreground">
                  Começa com este valor. Mín. Meta R$ {(SMART_META_FLOOR_CENTS / 100).toFixed(2)}.
                  Sugerido ≥ R$ {(SMART_ANCHOR_MIN_BUDGET_CENTS / 100).toFixed(0)}.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1">
                  <DollarSign className="h-3 w-3" /> Teto máximo / dia
                </Label>
                <Input
                  type="number"
                  min={SMART_META_FLOOR_CENTS / 100}
                  max={SMART_ANCHOR_HARD_MAX_CENTS / 100}
                  step="1"
                  value={centsToInput(preview.maxBudgetCents)}
                  onChange={(e) => {
                    const cents = reaisToCents(e.target.value);
                    const next = Math.max(
                      preview.budgetCents,
                      Math.min(SMART_ANCHOR_HARD_MAX_CENTS, cents || preview.budgetCents),
                    );
                    patchPreview({ maxBudgetCents: next });
                  }}
                  className="h-9"
                />
                <p className="text-[10px] text-muted-foreground">
                  O sistema sobe até aqui. Máx. R$ {(SMART_ANCHOR_HARD_MAX_CENTS / 100).toFixed(0)}.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Título do anúncio</Label>
              <Input
                value={preview.headline}
                onChange={(e) => patchPreview({ headline: e.target.value })}
                maxLength={40}
                className="h-9"
                placeholder="Ex.: Pague 28% mais barato na conta de luz"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Texto principal</Label>
              <Textarea
                value={preview.primaryText}
                onChange={(e) => patchPreview({ primaryText: e.target.value })}
                rows={2}
                className="text-sm resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Criativo</Label>
              <p className="text-[11px] text-muted-foreground">
                Aqui é simples: <strong className="text-foreground">1 foto (feed 1:1)</strong> ou{" "}
                <strong className="text-foreground">1 vídeo</strong>. Os 3 formatos (quadrado / vertical / story)
                existem só no Anúncio completo.
              </p>
              <Tabs
                value={preview.creativeMode}
                onValueChange={(v) => setMode(v as SmartCreativeMode)}
              >
                <TabsList className="h-8">
                  <TabsTrigger value="photo" className="text-xs h-7 gap-1">
                    <ImageIcon className="h-3.5 w-3.5" /> Foto 1:1
                  </TabsTrigger>
                  <TabsTrigger value="video" className="text-xs h-7 gap-1">
                    <Film className="h-3.5 w-3.5" /> Vídeo
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {preview.creativeMode === "photo" ? (
                <div className="space-y-2">
                  {preview.libraryPhotos.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground border border-dashed rounded-lg p-3 text-center">
                      Nenhuma foto 1:1 na biblioteca. Envie uma abaixo (quadrado).
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                      {preview.libraryPhotos.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          title={item.label}
                          onClick={() => patchPreview({ photoUrl: item.url, creativeMode: "photo" })}
                          className={`relative aspect-square rounded-md overflow-hidden border-2 ${
                            preview.photoUrl === item.url
                              ? "border-primary ring-2 ring-primary/30"
                              : "border-transparent opacity-85 hover:opacity-100"
                          }`}
                        >
                          <img src={item.url} alt="" className="h-full w-full object-cover" />
                          {item.isPlatformShared && (
                            <span className="absolute top-0.5 left-0.5 text-[8px] leading-none bg-emerald-600 text-white px-1 py-0.5 rounded">
                              Oficial
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    ref={photoRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleUploadPhoto(f);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={uploading}
                    onClick={() => photoRef.current?.click()}
                    className="gap-1.5"
                  >
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    Enviar foto 1:1
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {preview.libraryVideos.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground border border-dashed rounded-lg p-3 text-center">
                      Nenhum vídeo na biblioteca ainda. Envie um abaixo.
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {preview.libraryVideos.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          title={item.label}
                          onClick={() =>
                            patchPreview({
                              videoUrl: item.url,
                              videoThumbUrl: item.thumbUrl || null,
                              creativeMode: "video",
                            })
                          }
                          className={`relative aspect-[9/16] rounded-md overflow-hidden border-2 flex items-center justify-center bg-black/40 ${
                            preview.videoUrl === item.url
                              ? "border-primary ring-2 ring-primary/30"
                              : "border-transparent opacity-85 hover:opacity-100"
                          }`}
                        >
                          {item.thumbUrl ? (
                            <img src={item.thumbUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <Film className="h-5 w-5 text-white" />
                          )}
                          {item.isPlatformShared && (
                            <span className="absolute top-0.5 left-0.5 text-[8px] leading-none bg-emerald-600 text-white px-1 py-0.5 rounded">
                              Oficial
                            </span>
                          )}
                          <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[9px] text-white truncate px-1 py-0.5 text-left">
                            {item.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    ref={videoRef}
                    type="file"
                    accept="video/mp4,video/quicktime,video/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleUploadVideo(f);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={uploading}
                    onClick={() => videoRef.current?.click()}
                    className="gap-1.5"
                  >
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    Enviar vídeo
                  </Button>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-[hsl(var(--ads-border))] p-3 space-y-1.5">
              <div className="text-[11px] font-medium">Para publicar, confira:</div>
              {[
                { ok: preview.hasSede, label: "Cidade da sede informada" },
                { ok: preview.headline.trim().length >= 3, label: "Título do anúncio" },
                {
                  ok: preview.creativeMode === "photo" ? !!preview.photoUrl : !!preview.videoUrl,
                  label: preview.creativeMode === "photo" ? "Foto escolhida" : "Vídeo escolhido",
                },
                {
                  ok: preview.budgetCents >= SMART_META_FLOOR_CENTS,
                  label: `Valor do dia (≥ R$ ${(SMART_META_FLOOR_CENTS / 100).toFixed(2)})`,
                },
                {
                  ok: preview.maxBudgetCents >= preview.budgetCents,
                  label: "Teto máximo ≥ valor do dia",
                },
                {
                  ok:
                    preview.walletLiquidCents == null ||
                    preview.walletLiquidCents >= preview.budgetCents,
                  label: "Saldo na carteira suficiente",
                },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2 text-[11px]">
                  {item.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                  )}
                  <span className={item.ok ? "text-muted-foreground" : "text-amber-700 dark:text-amber-500"}>
                    {item.label}
                  </span>
                </div>
              ))}
              {gaps.length > 0 && (
                <p className="text-[11px] text-amber-700 dark:text-amber-500 pt-1">
                  Ainda falta: {gaps[0]}
                </p>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" disabled={publishing || uploading} onClick={onClose}>
                Cancelar
              </Button>
              <Button
                className="flex-1"
                disabled={publishing || uploading || !canPublish}
                onClick={handlePublish}
              >
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                <span className="ml-1.5">Publicar agora</span>
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
