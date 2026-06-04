import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { CityHit, CopyPack, CopyPackV2, createCampaign, generateCopy, preflightCampaign, searchCities, searchCitiesBulk, uploadAdPhotos, uploadAdVideo, validateAccount, type PreflightResult, type CustomLocation } from "@/services/facebookAds";
import { Check, ChevronRight, Loader2, MapPin, Search, Sparkles, TrendingUp, Upload, X, ImageIcon, Smartphone, Wand2, Save, Target, DollarSign, Video, Zap } from "lucide-react";
import { AddressRadiusPicker, type RadiusPoint } from "./AddressRadiusPicker";
import { DISTRIBUIDORAS_PRESETS, type DistribuidoraPreset } from "@/data/distribuidoraPresets";
import { AdPreview, type AdFormat } from "./AdPreview";
import { AdQualityPanel } from "./AdQualityPanel";
import type { QualityResult } from "@/lib/adQualityScore";
import { useFacebookConnection } from "@/hooks/useFacebookConnection";
import { useUserRole } from "@/hooks/useUserRole";
import { useConsultantPhone, formatBrPhone } from "@/hooks/useConsultantPhone";
import { supabase } from "@/integrations/supabase/client";
import { upsertAdTemplate } from "@/services/adTemplates";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AdImageLibraryPanel } from "./AdImageLibraryPanel";
import { SaveTemplateDialog } from "./SaveTemplateDialog";
import type { AdImageLibraryItem } from "@/services/adImageLibrary";
import { CtwaPreflightCard } from "./CtwaPreflightCard";


interface Props {
  open: boolean;
  onClose: () => void;
  consultantId: string;
  onCreated?: () => void;
}

type Step = 1 | 2 | 3 | 4;

const FORMAT_SPEC: Record<AdFormat, { label: string; w: number; h: number; ratio: number; desc: string }> = {
  square:   { label: "Feed quadrado",   w: 1080, h: 1080, ratio: 1.0,    desc: "1080×1080 — Feed Facebook + Instagram" },
  vertical: { label: "Feed vertical",   w: 1080, h: 1350, ratio: 0.8,    desc: "1080×1350 — recomendado p/ mobile" },
  story:    { label: "Stories / Reels", w: 1080, h: 1920, ratio: 0.5625, desc: "1080×1920 — Stories e Reels" },
};

interface AdFile { file: File; url: string; w: number; h: number }

type FilesByFormat = Record<AdFormat, AdFile[]>;
const EMPTY_FILES: FilesByFormat = { square: [], vertical: [], story: [] };
const PER_FORMAT_LIMIT = 4;
const COPY_LIMITS = { headline: 30, primary: 90, description: 25 } as const;

function readImageDimensions(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { reject(new Error("Imagem inválida")); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

function cropToFormat(file: File, spec: { w: number; h: number }): Promise<File> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = spec.w; canvas.height = spec.h;
      const ctx = canvas.getContext("2d")!;
      // cover (center crop)
      const sRatio = img.naturalWidth / img.naturalHeight;
      const dRatio = spec.w / spec.h;
      let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
      if (sRatio > dRatio) {
        sw = img.naturalHeight * dRatio;
        sx = (img.naturalWidth - sw) / 2;
      } else {
        sh = img.naturalWidth / dRatio;
        sy = (img.naturalHeight - sh) / 2;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, spec.w, spec.h);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (!blob) return reject(new Error("Falha no recorte"));
        const cropped = new File([blob], file.name.replace(/\.[^.]+$/, "") + "-cropped.jpg", { type: "image/jpeg" });
        resolve(cropped);
      }, "image/jpeg", 0.92);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Imagem inválida")); };
    img.src = url;
  });
}

export function CreateCampaignWizard({ open, onClose, consultantId, onCreated }: Props) {
  const { toast } = useToast();
  const { connection } = useFacebookConnection(consultantId);
  const { isSuperAdmin } = useUserRole(consultantId);
  const { phone: consultantPhone, loading: phoneLoading } = useConsultantPhone(consultantId);
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [aiResizingIdx, setAiResizingIdx] = useState<number | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  // Pré-checagem CTWA: bot + Facebook + pixel + WABA. Bloqueia Publicar quando false.
  const [ctwaReady, setCtwaReady] = useState(false);


  // Validação inicial
  const [issues, setIssues] = useState<string[] | null>(null);

  // Step 1: cidades
  const [search, setSearch] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [hits, setHits] = useState<CityHit[]>([]);
  const [cities, setCities] = useState<CityHit[]>([]);
  // Multi-select de presets carregados (ids). Cada cidade carrega sua origem em cityOrigin.
  const [selectedPresetIds, setSelectedPresetIds] = useState<Set<string>>(new Set());
  const [cityOrigin, setCityOrigin] = useState<Record<string, string>>({}); // fbKey -> presetId | "manual"
  const [presetLoading, setPresetLoading] = useState(false);
  const [presetLoadingId, setPresetLoadingId] = useState<string | null>(null);
  const [cityFilter, setCityFilter] = useState("");

  // Alcance ao vivo (Step 1)
  const [liveReach, setLiveReach] = useState<{ lower: number; upper: number } | null>(null);
  const [liveReachLoading, setLiveReachLoading] = useState(false);

  // Nomes derivados dos presets ativos (pra copy + payload)
  const activePresetNames = DISTRIBUIDORAS_PRESETS.filter(p => selectedPresetIds.has(p.id)).map(p => p.nome);
  const distribuidoraPrimary = activePresetNames[0] || null;
  const distribuidoraJoined = activePresetNames.join(" + ") || null;

  const LS_KEY = `ads-wizard-draft-${consultantId}`;
  const PRESET_CACHE_VERSION = "v1";
  const presetCacheKey = (id: string) => `ads-preset-cities-${PRESET_CACHE_VERSION}-${id}`;

  function readPresetCache(id: string): CityHit[] | null {
    try {
      const raw = localStorage.getItem(presetCacheKey(id));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.cities) && parsed.cities.length > 0) return parsed.cities as CityHit[];
    } catch {}
    return null;
  }
  function writePresetCache(id: string, cities: CityHit[]) {
    try {
      localStorage.setItem(presetCacheKey(id), JSON.stringify({ ts: Date.now(), cities }));
    } catch {}
  }

  const [warmedCount, setWarmedCount] = useState<number>(0);
  const [warming, setWarming] = useState(false);

  // Step 2: fotos OU vídeo Reels
  const [creativeMode, setCreativeMode] = useState<"photo" | "video">("photo");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMeta, setVideoMeta] = useState<{ duration: number; w: number; h: number } | null>(null);
  // Legenda automática (SRT pt_BR) gerada pelo ad-video-captions.
  const [videoCaptionsSrt, setVideoCaptionsSrt] = useState<string | null>(null);
  const [videoCaptionsLoading, setVideoCaptionsLoading] = useState(false);
  const [videoCaptionsError, setVideoCaptionsError] = useState<string | null>(null);
  const [videoCaptionsEnabled, setVideoCaptionsEnabled] = useState(true);
  const [format, setFormat] = useState<AdFormat>("square");
  const [filesByFormat, setFilesByFormat] = useState<FilesByFormat>(EMPTY_FILES);
  const adFiles = filesByFormat[format];
  const totalFiles = filesByFormat.square.length + filesByFormat.vertical.length + filesByFormat.story.length;
  // Imagens reutilizadas da biblioteca (não passam por upload de novo).
  const [pickedLibrary, setPickedLibrary] = useState<AdImageLibraryItem[]>([]);
  const [photoTab, setPhotoTab] = useState<"upload" | "library">("upload");
  // Save template dialog
  const [saveTplOpen, setSaveTplOpen] = useState(false);

  // Step 3: copy
  const [copy, setCopy] = useState<CopyPackV2 | null>(null);
  const [headline, setHeadline] = useState("");
  const [primaryText, setPrimaryText] = useState("");
  const [description, setDescription] = useState("");
  const [copyLoading, setCopyLoading] = useState(false);
  // Primeira mensagem que abre no WhatsApp ao clicar no anúncio (CTWA).
  const INITIAL_MSG_LIMIT = 160;
  const buildDefaultInitialMessage = (distrib: string | null) =>
    distrib
      ? `Olá! Quero saber mais sobre a redução na conta de luz ${distrib}.`
      : "Olá! Quero saber mais sobre a redução na minha conta de luz.";
  const [initialMessage, setInitialMessage] = useState<string>(() => buildDefaultInitialMessage(null));
  const [initialMessageTouched, setInitialMessageTouched] = useState(false);

  // Step 4: orçamento
  const [budget, setBudget] = useState(15); // R$/dia (min 10 — Modo Econômico)
  const [duration, setDuration] = useState(3); // 3 dias default (Modo Econômico)
  // Modo de geo: cidades inteiras OU endereço/raio (ultra-local).
  const [geoMode, setGeoMode] = useState<"cities" | "radius">("cities");
  const [radiusPoints, setRadiusPoints] = useState<RadiusPoint[]>([]);
  // Placements: "auto" = Advantage+ (recomendação Meta — distribui automático
  // em todos os elegíveis pra CTWA e otimiza CPL). Manual = consultor escolhe.
  const [placementMode, setPlacementMode] = useState<"auto" | "manual">("auto");
  const ALL_PLACEMENTS = [
    "fb:feed", "fb:marketplace", "fb:video_feeds", "fb:story", "fb:facebook_reels", "fb:search", "fb:instream_video",
    "ig:stream", "ig:story", "ig:reels", "ig:explore",
  ];
  const [placements, setPlacements] = useState<string[]>(ALL_PLACEMENTS);

  // Quality + preflight
  const [quality, setQuality] = useState<QualityResult | null>(null);
  const [lowScoreConfirm, setLowScoreConfirm] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(1); setIssues(null); setHits([]);
    setFilesByFormat(EMPTY_FILES); setPickedLibrary([]); setPhotoTab("upload");
    setCreativeMode("photo"); setVideoFile(null); setVideoUrl(null); setVideoMeta(null);
    setVideoCaptionsSrt(null); setVideoCaptionsLoading(false); setVideoCaptionsError(null); setVideoCaptionsEnabled(true);
    setFormat("square"); setCopy(null); setHeadline(""); setPrimaryText(""); setDescription("");
    setBudget(15); setDuration(3);
    setPlacementMode("auto"); setPlacements(ALL_PLACEMENTS);
    setQuality(null); setPreflight(null); setLiveReach(null);
    setGeoMode("cities"); setRadiusPoints([]);

    // Recupera rascunho de cidades/presets do localStorage (por consultor)
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        if (Array.isArray(draft?.cities)) setCities(draft.cities);
        else setCities([]);
        if (Array.isArray(draft?.selectedPresetIds)) setSelectedPresetIds(new Set(draft.selectedPresetIds));
        else setSelectedPresetIds(new Set());
        if (draft?.cityOrigin && typeof draft.cityOrigin === "object") setCityOrigin(draft.cityOrigin);
        else setCityOrigin({});
      } else {
        setCities([]); setSelectedPresetIds(new Set()); setCityOrigin({});
      }
    } catch {
      setCities([]); setSelectedPresetIds(new Set()); setCityOrigin({});
    }

    validateAccount().then(r => setIssues(r.issues)).catch(e => setIssues([e.message]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Pré-aquece o cache de TODAS as distribuidoras em background (fica instantâneo nas próximas vezes)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const targets = DISTRIBUIDORAS_PRESETS.filter((p) => !readPresetCache(p.id));
      if (targets.length === 0) { setWarmedCount(DISTRIBUIDORAS_PRESETS.length); return; }
      setWarming(true);
      setWarmedCount(DISTRIBUIDORAS_PRESETS.length - targets.length);
      // Em sequência leve para não martelar a edge function
      for (const p of targets) {
        if (cancelled) return;
        try {
          const ufPrimary = p.uf.split("/")[0];
          const res = await searchCitiesBulk(p.cidades.map((name) => ({ name, uf: ufPrimary })));
          const clean = (res.cities || []).filter((h) => h?.key);
          if (clean.length > 0) writePresetCache(p.id, clean);
        } catch {/* silencioso */}
        if (!cancelled) setWarmedCount((n) => n + 1);
      }
      if (!cancelled) setWarming(false);
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Persiste rascunho (só Step 1 importa)
  useEffect(() => {
    if (!open) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        cities, selectedPresetIds: Array.from(selectedPresetIds), cityOrigin,
      }));
    } catch {}
  }, [open, cities, selectedPresetIds, cityOrigin, LS_KEY]);

  // Estimativa de alcance ao vivo (debounce 1.5s) no Step 1
  useEffect(() => {
    if (!open || step !== 1 || cities.length === 0) { setLiveReach(null); return; }
    const t = setTimeout(async () => {
      setLiveReachLoading(true);
      try {
        const r = await preflightCampaign({
          cities: cities.map((c) => ({ key: c.key, name: c.name })),
          daily_budget_cents: 3000,
        });
        if (r.reach) setLiveReach({ lower: r.reach.lower, upper: r.reach.upper });
        else setLiveReach(null);
      } catch { setLiveReach(null); }
      finally { setLiveReachLoading(false); }
    }, 1500);
    return () => clearTimeout(t);
  }, [open, step, cities]);

  // Debounce de busca
  useEffect(() => {
    if (search.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const r = await searchCities(search);
        setHits(r.cities);
        // Token FB inválido: o banner amarelo no topo já avisa — não joga toast vermelho.
        if (r.needsReconnect) return;
      } catch (e: any) {
        toast({ title: "Falha na busca", description: e.message, variant: "destructive" });
      }
      finally { setSearchLoading(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [search, toast]);

  // Mantém a primeira mensagem do WhatsApp em sincronia com a distribuidora
  // enquanto o usuário não editar manualmente.
  useEffect(() => {
    if (initialMessageTouched) return;
    setInitialMessage(buildDefaultInitialMessage(distribuidoraPrimary));
  }, [distribuidoraPrimary, initialMessageTouched]);

  function addCity(c: CityHit) {
    if (cities.find(x => x.key === c.key)) return;
    if (cities.length >= 200) { toast({ title: "Máximo de 200 cidades (limite Facebook)" }); return; }
    setCities([...cities, c]);
    setCityOrigin((prev) => ({ ...prev, [c.key]: "manual" }));
    setSearch(""); setHits([]);
  }

  function removePreset(presetId: string) {
    // Remove só as cidades cuja origem é esse preset
    const keep = cities.filter((c) => cityOrigin[c.key] !== presetId);
    setCities(keep);
    setCityOrigin((prev) => {
      const next: Record<string, string> = {};
      for (const k of Object.keys(prev)) if (prev[k] !== presetId) next[k] = prev[k];
      return next;
    });
    setSelectedPresetIds((prev) => {
      const next = new Set(prev); next.delete(presetId); return next;
    });
  }

  async function loadPresetCities(p: DistribuidoraPreset, opts?: { silent?: boolean; budgetLeft?: number }): Promise<number> {
    const ufPrimary = p.uf.split("/")[0];
    const cap = opts?.budgetLeft ?? (200 - cities.length);
    if (cap <= 0) return 0;
    try {
      // 1) tenta cache local (instantâneo)
      let hits = readPresetCache(p.id);
      let unresolved: { name: string; uf: string; reason: string }[] = [];
      if (!hits) {
        const res = await searchCitiesBulk(p.cidades.map((name) => ({ name, uf: ufPrimary })));
        hits = res.cities;
        unresolved = res.unresolved;
        const clean = (hits || []).filter((h) => h?.key);
        if (clean.length > 0) writePresetCache(p.id, clean);
      }
      const seen = new Set(cities.map((c) => c.key));
      const newCities: CityHit[] = [];
      const newOrigins: Record<string, string> = {};
      for (const h of hits) {
        if (!h?.key || seen.has(h.key)) continue;
        if (newCities.length >= cap) break;
        newCities.push(h);
        newOrigins[h.key] = p.id;
        seen.add(h.key);
      }
      if (newCities.length > 0) {
        setCities((prev) => [...prev, ...newCities]);
        setCityOrigin((prev) => ({ ...prev, ...newOrigins }));
      }
      setSelectedPresetIds((prev) => { const next = new Set(prev); next.add(p.id); return next; });
      if (!opts?.silent) {
        toast({ title: `${p.nome} carregada`, description: `${newCities.length} cidades adicionadas (de ${p.cidades.length}). Bônus: ${p.bonusLabel}.` });
      }
      if (unresolved.length > 0) {
        const nomes = unresolved.slice(0, 5).map((u) => u.name).join(", ");
        const extra = unresolved.length > 5 ? ` (+${unresolved.length - 5})` : "";
        toast({
          title: `${unresolved.length} cidade(s) não encontradas no Meta`,
          description: `${nomes}${extra}. Foram ignoradas pra evitar enviar tráfego pra cidade errada.`,
        });
      }
      return newCities.length;
    } catch (e: any) {
      if (!opts?.silent) toast({ title: `Falha em ${p.nome}`, description: e?.message || "Tente novamente", variant: "destructive" });
      return 0;
    }
  }

  async function togglePreset(p: DistribuidoraPreset) {
    if (selectedPresetIds.has(p.id)) {
      removePreset(p.id);
      return;
    }
    setPresetLoading(true); setPresetLoadingId(p.id);
    try { await loadPresetCities(p); } finally { setPresetLoading(false); setPresetLoadingId(null); }
  }

  async function loadAllOfTier(tier: "alto" | "medio") {
    setPresetLoading(true);
    try {
      const targets = DISTRIBUIDORAS_PRESETS.filter((p) => p.tier === tier && !selectedPresetIds.has(p.id));
      if (targets.length === 0) {
        toast({ title: "Nada novo a carregar nesse tier" });
        return;
      }
      let totalAdded = 0;
      let stoppedAtCap = false;
      // Distribuição justa: divide o orçamento de cidades restantes entre os presets do tier
      const remaining = 200 - cities.length - totalAdded;
      const perPreset = Math.max(8, Math.floor(remaining / targets.length));
      for (const p of targets) {
        const left = 200 - (cities.length + totalAdded);
        if (left <= 0) { stoppedAtCap = true; break; }
        const cap = Math.min(perPreset, left);
        const added = await loadPresetCities(p, { silent: true, budgetLeft: cap });
        totalAdded += added;
      }
      toast({
        title: `Carregadas ${targets.length} distribuidoras (${tier === "alto" ? "100%" : "50%"})`,
        description: `+${totalAdded} cidades. ${stoppedAtCap ? "Limite de 200 atingido." : ""}`,
      });
    } finally { setPresetLoading(false); }
  }

  function clearAllPresets() {
    // Remove só cidades de presets, mantém manuais
    const keep = cities.filter((c) => cityOrigin[c.key] === "manual");
    setCities(keep);
    setCityOrigin((prev) => {
      const next: Record<string, string> = {};
      for (const k of Object.keys(prev)) if (prev[k] === "manual") next[k] = "manual";
      return next;
    });
    setSelectedPresetIds(new Set());
  }

  function clearAllCities() {
    setCities([]); setCityOrigin({}); setSelectedPresetIds(new Set()); setCityFilter("");
  }

  function removeCityKey(key: string) {
    setCities((prev) => prev.filter((x) => x.key !== key));
    setCityOrigin((prev) => { const n = { ...prev }; delete n[key]; return n; });
    // Se a cidade vinha de um preset e foi a última desse preset, desmarca o preset
    const origin = cityOrigin[key];
    if (origin && origin !== "manual") {
      const stillHas = cities.some((c) => c.key !== key && cityOrigin[c.key] === origin);
      if (!stillHas) {
        setSelectedPresetIds((prev) => { const n = new Set(prev); n.delete(origin); return n; });
      }
    }
  }

  async function generateCopyForCities() {
    setCopyLoading(true);
    try {
      const cityList = distribuidoraJoined
        ? [`clientes de ${distribuidoraJoined}`, ...cities.map(x => x.name).slice(0, 3)]
        : cities.map(x => x.name);
      const c = await generateCopy(cityList);
      setCopy(c);
      setHeadline(c.headlines[0] || "");
      setPrimaryText(c.primary_texts[0] || "");
      setDescription(c.description || "");
    } catch (e: any) {
      toast({ title: "Erro ao gerar copy", description: e.message, variant: "destructive" });
    } finally { setCopyLoading(false); }
  }

  async function handleNext() {
    if (step === 1) {
      if (geoMode === "cities" && cities.length === 0) return toast({ title: "Selecione pelo menos 1 cidade", variant: "destructive" });
      if (geoMode === "radius" && radiusPoints.length === 0) return toast({ title: "Adicione pelo menos 1 endereço", variant: "destructive" });
      setStep(2);
    } else if (step === 2) {
      if (creativeMode === "video") {
        if (!videoFile && !videoUrl) return toast({ title: "Envie um vídeo (.mp4 vertical)", variant: "destructive" });
      } else {
        if (totalFiles + pickedLibrary.length < 1) return toast({ title: "Adicione pelo menos 1 foto válida", variant: "destructive" });
      }
      setStep(3);
      if (!copy) generateCopyForCities();
    } else if (step === 3) {
      if (!headline || !primaryText) return toast({ title: "Preencha título e texto", variant: "destructive" });
      if (quality && !quality.canPublish) {
        const blockHit = quality.copy.hits.find((h) => h.severity === "block");
        return toast({ title: "Termo proibido pela Meta", description: blockHit?.message || "Remova os itens em vermelho antes de avançar.", variant: "destructive" });
      }
      if (quality && !quality.recommendedPublish) {
        setLowScoreConfirm(true);
        return;
      }
      setStep(4);
      runPreflight();
    } else if (step === 4) {
      await submit();
    }
  }

  async function runPreflight() {
    setPreflightLoading(true); setPreflight(null);
    try {
      const r = await preflightCampaign({
        cities: geoMode === "cities" ? cities.map((c) => ({ key: c.key, name: c.name })) : [],
        custom_locations: geoMode === "radius"
          ? radiusPoints.map((p) => ({ ...p, distance_unit: "kilometer" as const }))
          : undefined,
        daily_budget_cents: Math.round(budget * 100),
      });
      setPreflight(r);
    } catch (e: any) {
      setPreflight({ ok: false, blockers: [e?.message || "Falha no pré-voo"], warnings: [], reach: null });
    } finally { setPreflightLoading(false); }
  }

  async function submit() {
    if (!consultantPhone) {
      toast({
        title: "Telefone do consultor não configurado",
        description: "Adicione seu WhatsApp na aba Dados antes de publicar (ou conecte uma instância do WhatsApp).",
        variant: "destructive",
      });
      return;
    }
    if (preflight && !preflight.ok) {
      toast({ title: "Pré-voo em revisão", description: "Vou tentar publicar direto pela conta principal.", variant: "destructive" });
    }
    setSubmitting(true);
    try {
      // GARANTIA: persiste o telefone resolvido em consultant_ad_settings antes
      // de chamar a edge function — assim o backend nunca falha por WHATSAPP_NOT_CONFIGURED.
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        await supabase.from("consultant_ad_settings").upsert(
          { consultant_id: consultantId, whatsapp_destination_number: consultantPhone },
          { onConflict: "consultant_id" }
        );
      } catch (e) { console.warn("[wizard] persist phone failed:", e); }
      // Mantém formato de cada foto pra que o backend monte asset_feed_spec
      // com customization por posicionamento (sem corte de cabeça em Reels).
      // Vídeo Reels: faz upload pro storage, manda url p/ edge function publicar.
      let videoPayload: { url: string; thumb_url?: string; captions_srt?: string } | undefined;
      if (creativeMode === "video") {
        if (videoFile) {
          const up = await uploadAdVideo(consultantId, videoFile);
          videoPayload = { url: up.url };
        } else if (videoUrl) {
          videoPayload = { url: videoUrl };
        }
        // Anexa legenda SRT (gerada via ad-video-captions no Step 2).
        if (videoPayload && videoCaptionsEnabled && videoCaptionsSrt) {
          videoPayload.captions_srt = videoCaptionsSrt;
        }
      }
      // Mantém formato de cada foto pra que o backend monte asset_feed_spec
      // com customization por posicionamento (sem corte de cabeça em Reels).
      const tagged: { file: AdFile; format: AdFormat }[] = creativeMode === "photo" ? [
        ...filesByFormat.square.map((f) => ({ file: f, format: "square" as const })),
        ...filesByFormat.vertical.map((f) => ({ file: f, format: "vertical" as const })),
        ...filesByFormat.story.map((f) => ({ file: f, format: "story" as const })),
      ].filter((x) => isFileValidAny(x.file)) : [];
      const photoUrls = tagged.length
        ? await uploadAdPhotos(consultantId, tagged.map((t) => t.file.file), { formats: tagged.map((t) => t.format) })
        : [];
      const photos: { url: string; format: AdFormat }[] = creativeMode === "photo" ? [
        ...photoUrls.map((url, i) => ({ url, format: tagged[i].format })),
        ...pickedLibrary.map((it) => ({ url: it.url, format: it.format as AdFormat })),
      ] : [];
      const campaignName = activePresetNames.length > 1
        ? `iGreen — ${activePresetNames.length} distribuidoras`
        : distribuidoraPrimary
          ? `iGreen — ${distribuidoraPrimary}`
          : geoMode === "radius" && radiusPoints[0]
            ? `iGreen — ${radiusPoints[0].address_string.slice(0, 40)}`
            : `iGreen — ${cities.map(c => c.name).slice(0, 3).join(", ")}`;
      const payload = {
        name: campaignName,
        cities: geoMode === "cities" ? cities.map(c => ({ key: c.key, name: c.name })) : [],
        custom_locations: geoMode === "radius"
          ? radiusPoints.map((p) => ({ ...p, distance_unit: "kilometer" as const }))
          : undefined,
        daily_budget_cents: Math.round(budget * 100),
        duration_days: duration > 0 ? duration : null,
        creative_mode: creativeMode,
        photos: creativeMode === "photo" ? photos : undefined,
        video: videoPayload,
        headline, primary_text: primaryText, description,
        distribuidora: distribuidoraPrimary || undefined,
        placement_mode: placementMode,
        placements: placementMode === "manual" ? placements : undefined,
        initial_message: initialMessage.trim() || undefined,
      };
      try {
        await createCampaign(payload);
      } catch (err: any) {
        const msg = String(err?.message || "");
        if (/failed to fetch|network|5\d\d/i.test(msg)) {
          await new Promise(r => setTimeout(r, 1500));
          await createCampaign(payload);
        } else {
          throw err;
        }
      }
      toast({ title: "Campanha criada!", description: "Em revisão pelo Facebook. Em até 30s tentamos ativar." });
      try { localStorage.removeItem(LS_KEY); } catch {}
      onCreated?.();
      onClose();
    } catch (e: any) {
      toast({ title: "Falha ao criar campanha", description: e.message, variant: "destructive" });
    } finally { setSubmitting(false); }
  }

  async function handleFiles(list: FileList | null) {
    if (!list || !list.length) return;
    const spec = FORMAT_SPEC[format];
    const current = filesByFormat[format];
    const accepted: AdFile[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(list)) {
      if (current.length + accepted.length >= PER_FORMAT_LIMIT) break;
      if (file.size > 8 * 1024 * 1024) { rejected.push(`${file.name}: maior que 8 MB`); continue; }
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { rejected.push(`${file.name}: use JPG, PNG ou WebP`); continue; }
      try {
        const dim = await readImageDimensions(file);
        if (dim.w < spec.w || dim.h < spec.h) {
          rejected.push(`${file.name}: ${dim.w}×${dim.h} é menor que o exigido (${spec.w}×${spec.h})`);
          continue;
        }
        const fileRatio = dim.w / dim.h;
        const diff = Math.abs(fileRatio - spec.ratio) / spec.ratio;
        if (diff > 0.02) {
          // proporção fora — sugere crop
          rejected.push(`${file.name}: proporção ${fileRatio.toFixed(2)} ≠ ${spec.ratio.toFixed(2)} — use "Cortar para o tamanho ideal"`);
          // ainda assim adiciona com flag de "precisa cortar" via dimensão original
          accepted.push({ file, url: URL.createObjectURL(file), w: dim.w, h: dim.h });
          continue;
        }
        accepted.push({ file, url: URL.createObjectURL(file), w: dim.w, h: dim.h });
      } catch {
        rejected.push(`${file.name}: arquivo inválido`);
      }
    }
    if (accepted.length) {
      setFilesByFormat(prev => ({ ...prev, [format]: [...prev[format], ...accepted].slice(0, PER_FORMAT_LIMIT) }));
    }
    if (rejected.length) {
      toast({ title: `${rejected.length} arquivo(s) com problema`, description: rejected.slice(0, 3).join("\n"), variant: "destructive" });
    }
  }

  async function handleCrop(idx: number) {
    const target = filesByFormat[format][idx]; if (!target) return;
    try {
      const cropped = await cropToFormat(target.file, FORMAT_SPEC[format]);
      const dim = await readImageDimensions(cropped);
      setFilesByFormat(prev => ({
        ...prev,
        [format]: prev[format].map((a, i) => i === idx ? { file: cropped, url: URL.createObjectURL(cropped), w: dim.w, h: dim.h } : a),
      }));
      toast({ title: "Imagem recortada", description: `Agora em ${dim.w}×${dim.h}` });
    } catch (e: any) {
      toast({ title: "Falha no recorte", description: e.message, variant: "destructive" });
    }
  }

  async function handleAiResize(idx: number) {
    const target = filesByFormat[format][idx]; if (!target) return;
    setAiResizingIdx(idx);
    try {
      const tempUrls = await uploadAdPhotos(consultantId, [target.file]);
      const { data, error } = await supabase.functions.invoke("ai-resize-image", {
        body: { url: tempUrls[0], format },
      });
      if (error) throw error;
      if (!data?.url) throw new Error(data?.detail || "IA não retornou imagem");
      const blob = await (await fetch(data.url)).blob();
      const aiFile = new File([blob], target.file.name.replace(/\.[^.]+$/, "") + `-ai-${format}.jpg`, { type: blob.type || "image/jpeg" });
      const dim = await readImageDimensions(aiFile);
      setFilesByFormat(prev => ({
        ...prev,
        [format]: prev[format].map((a, i) => i === idx ? { file: aiFile, url: URL.createObjectURL(aiFile), w: dim.w, h: dim.h } : a),
      }));
      toast({ title: "Reenquadrada com IA ✨", description: `Agora em ${dim.w}×${dim.h} sem cortar o sujeito.` });
    } catch (e: any) {
      toast({ title: "IA não conseguiu reenquadrar", description: e?.message || "Tente cortar manualmente", variant: "destructive" });
    } finally {
      setAiResizingIdx(null);
    }
  }

  async function handleSaveAsTemplate(meta: { title: string; description: string }) {
    if (!headline.trim() || !primaryText.trim())
      return toast({ title: "Preencha headline e texto antes", variant: "destructive" });
    if (totalFiles === 0 && pickedLibrary.length === 0)
      return toast({ title: "Adicione ao menos 1 imagem", variant: "destructive" });
    if (!meta.title.trim()) return toast({ title: "Informe um nome para o template", variant: "destructive" });
    setSavingTemplate(true);
    try {
      const tagged: { file: AdFile; format: AdFormat }[] = [
        ...filesByFormat.square.map((f) => ({ file: f, format: "square" as const })),
        ...filesByFormat.vertical.map((f) => ({ file: f, format: "vertical" as const })),
        ...filesByFormat.story.map((f) => ({ file: f, format: "story" as const })),
      ].filter((x) => isFileValidAny(x.file));
      const photoUrls = tagged.length
        ? await uploadAdPhotos(consultantId, tagged.map((t) => t.file.file), { formats: tagged.map((t) => t.format) })
        : [];
      const photos = [
        ...photoUrls.map((url, i) => ({ url, format: tagged[i].format })),
        ...pickedLibrary.map((it) => ({ url: it.url, format: it.format as AdFormat })),
      ];
      await upsertAdTemplate({
        title: meta.title.trim(),
        description: meta.description.trim() || null,
        photos,
        headline,
        primary_text: primaryText,
        description_text: description,
        age_min: 28, age_max: 60,
        suggested_daily_budget_cents: Math.round(budget * 100),
        status: isSuperAdmin ? "published" : "draft",
        target_distribuidora_ids: Array.from(selectedPresetIds),
        // Salva nomes das cidades selecionadas: assim, ao reutilizar o template
        // via UseTemplateDialog, as mesmas cidades já vêm pré-filtradas.
        target_cidades: cities.map((c) => c.name),
      });
      toast({
        title: "Template salvo ✓",
        description: isSuperAdmin ? "Publicado para todos os consultores." : "Salvo como rascunho pessoal.",
      });
      setSaveTplOpen(false);
    } catch (e: any) {
      toast({ title: "Erro ao salvar template", description: e?.message || "Tente novamente", variant: "destructive" });
    } finally {
      setSavingTemplate(false);
    }
  }

  function isFileValidFor(a: AdFile, fmt: AdFormat): boolean {
    const spec = FORMAT_SPEC[fmt];
    if (a.w < spec.w || a.h < spec.h) return false;
    const ratio = a.w / a.h;
    return Math.abs(ratio - spec.ratio) / spec.ratio <= 0.02;
  }
  function isFileValid(a: AdFile): boolean { return isFileValidFor(a, format); }
  function isFileValidAny(a: AdFile): boolean {
    return (Object.keys(FORMAT_SPEC) as AdFormat[]).some(f => isFileValidFor(a, f));
  }
  function removeFile(idx: number) {
    setFilesByFormat(prev => ({ ...prev, [format]: prev[format].filter((_, i) => i !== idx) }));
  }

  const visibleIssues = (issues || []).filter(i => !i.includes("Pixel"));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !submitting && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Nova campanha — Passo {step} de 4
          </DialogTitle>
        </DialogHeader>

        {issues === null ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <div className="space-y-5">
            {visibleIssues.length > 0 && (
              <div className="text-xs rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200 p-3">
                ⚠️ {visibleIssues.join(" ")}
              </div>
            )}

            {step === 1 && (
              <div className="space-y-3">
                {/* Modo de geo: cidades inteiras OU endereço com raio (ultra-local). */}
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setGeoMode("cities")}
                    className={`p-3 rounded-lg border text-left transition ${geoMode === "cities" ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}>
                    <div className="font-semibold text-sm flex items-center gap-1.5">
                      {geoMode === "cities" && <Check className="w-3.5 h-3.5 text-primary" />}
                      <MapPin className="w-3.5 h-3.5" /> Cidades inteiras
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">Selecione distribuidoras ou cidades específicas.</div>
                  </button>
                  <button type="button" onClick={() => setGeoMode("radius")}
                    className={`p-3 rounded-lg border text-left transition ${geoMode === "radius" ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}>
                    <div className="font-semibold text-sm flex items-center gap-1.5">
                      {geoMode === "radius" && <Check className="w-3.5 h-3.5 text-primary" />}
                      <Target className="w-3.5 h-3.5" /> Endereço + raio
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">Anuncie a 1–50 km de uma rua, casa ou bairro específico.</div>
                  </button>
                </div>

                {geoMode === "radius" ? (
                  <div className="space-y-2">
                    <AddressRadiusPicker value={radiusPoints} onChange={setRadiusPoints} />
                  </div>
                ) : (
                <>
                <div>


                  <Label className="flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5 text-primary" /> Distribuidoras alvo (multi-seleção)</Label>
                  <p className="text-xs text-muted-foreground mb-2">Clique pra carregar/remover as cidades da distribuidora. Pode escolher várias — quanto mais cidades, mais barato fica o lead.</p>

                  <div className="space-y-2">
                    {/* TIER ALTO (100%) */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] uppercase tracking-wider text-primary/80 font-bold">🟢 Bônus até 100%</div>
                      <div className="flex gap-1">
                        <Button type="button" size="sm" variant="outline" className="h-6 text-[10px] px-2"
                          disabled={presetLoading} onClick={() => loadAllOfTier("alto")}>
                          Carregar TODAS 100%
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {DISTRIBUIDORAS_PRESETS.filter(p => p.tier === "alto").map(p => {
                        const active = selectedPresetIds.has(p.id);
                        const loading = presetLoadingId === p.id;
                        return (
                          <button key={p.id} type="button" disabled={presetLoading && !active}
                            onClick={() => togglePreset(p)}
                            className={`text-xs px-2.5 py-1.5 rounded-full border transition flex items-center gap-1 ${active ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-primary/10 border-border"}`}>
                            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : (active ? <Check className="w-3 h-3" /> : null)}
                            {p.nome} <span className="opacity-60">— {p.uf}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* TIER MEDIO (50%) */}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <div className="text-[10px] uppercase tracking-wider text-amber-400/80 font-bold">🟡 Bônus até 50%</div>
                      <div className="flex gap-1">
                        <Button type="button" size="sm" variant="outline" className="h-6 text-[10px] px-2"
                          disabled={presetLoading} onClick={() => loadAllOfTier("medio")}>
                          Carregar TODAS 50%
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {DISTRIBUIDORAS_PRESETS.filter(p => p.tier === "medio").map(p => {
                        const active = selectedPresetIds.has(p.id);
                        const loading = presetLoadingId === p.id;
                        return (
                          <button key={p.id} type="button" disabled={presetLoading && !active}
                            onClick={() => togglePreset(p)}
                            className={`text-xs px-2.5 py-1.5 rounded-full border transition flex items-center gap-1 ${active ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-primary/10 border-border"}`}>
                            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : (active ? <Check className="w-3 h-3" /> : null)}
                            {p.nome} <span className="opacity-60">— {p.uf}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* TIER SEM BÔNUS (separado pra não misturar com 100%) */}
                    {DISTRIBUIDORAS_PRESETS.some(p => p.tier === "sem_bonus") && (
                      <>
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">⚪ Sem bônus extra</div>
                          <div className="text-[10px] text-muted-foreground italic">não entra no "Carregar TODAS 100%"</div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {DISTRIBUIDORAS_PRESETS.filter(p => p.tier === "sem_bonus").map(p => {
                            const active = selectedPresetIds.has(p.id);
                            const loading = presetLoadingId === p.id;
                            return (
                              <button key={p.id} type="button" disabled={presetLoading && !active}
                                onClick={() => togglePreset(p)}
                                className={`text-xs px-2.5 py-1.5 rounded-full border transition flex items-center gap-1 ${active ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-primary/10 border-border"}`}>
                                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : (active ? <Check className="w-3 h-3" /> : null)}
                                {p.nome} <span className="opacity-60">— {p.uf}</span>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}

                    {/* Chips de presets ativos */}
                    {selectedPresetIds.size > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/40 mt-2">
                        <span className="text-[10px] uppercase text-muted-foreground">Ativas:</span>
                        {Array.from(selectedPresetIds).map((id) => {
                          const p = DISTRIBUIDORAS_PRESETS.find((x) => x.id === id);
                          if (!p) return null;
                          const count = cities.filter((c) => cityOrigin[c.key] === id).length;
                          return (
                            <Badge key={id} variant="secondary" className="gap-1.5 py-0.5 px-2 text-[11px] bg-primary/15 border border-primary/30">
                              {p.nome} • {count}
                              <button onClick={() => removePreset(id)}><X className="w-3 h-3" /></button>
                            </Badge>
                          );
                        })}
                        <Button type="button" size="sm" variant="ghost" className="h-5 text-[10px] px-2 text-muted-foreground" onClick={clearAllPresets}>
                          Limpar presets
                        </Button>
                      </div>
                    )}
                  </div>
                  {presetLoading && <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Carregando cidades...</div>}
                  {!presetLoading && warming && (
                    <div className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Pré-carregando cidades em background ({warmedCount}/{DISTRIBUIDORAS_PRESETS.length}) — próximas seleções serão instantâneas
                    </div>
                  )}
                </div>

                {/* Alcance ao vivo */}
                {(liveReach || liveReachLoading) && (
                  <div className="text-xs rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 flex items-center gap-2">
                    {liveReachLoading ? <Loader2 className="w-3 h-3 animate-spin text-primary" /> : <span>📡</span>}
                    {liveReach ? (
                      <>
                        <span className="text-muted-foreground">Alcance estimado:</span>
                        <strong className="text-foreground">{liveReach.lower.toLocaleString("pt-BR")}–{liveReach.upper.toLocaleString("pt-BR")}</strong>
                        <span className="text-muted-foreground">pessoas</span>
                        {liveReach.lower < 50000 && <span className="text-amber-400 ml-2">⚠ pequeno — adicione mais cidades</span>}
                        {liveReach.upper > 5_000_000 && <span className="text-amber-400 ml-2">⚠ muito amplo — divida em 2 campanhas</span>}
                      </>
                    ) : (
                      <span className="text-muted-foreground">Calculando alcance...</span>
                    )}
                  </div>
                )}

                {/* Auto-split: quando muito amplo, ajuda a dividir em 2 campanhas */}
                {liveReach && liveReach.upper > 5_000_000 && cities.length > 20 && (
                  <div className="text-xs rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                    <div className="font-bold text-amber-200">Está muito amplo — o algoritmo do Facebook gasta mal acima de 5M.</div>
                    <div className="text-amber-200/80">Recomendo dividir em 2 campanhas: mantém metade aqui e cria outra depois com a outra metade.</div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]"
                        onClick={() => {
                          // metade A: mantém os primeiros presets + cidades manuais; metade B: descarta o resto
                          const presetIds = Array.from(selectedPresetIds);
                          if (presetIds.length >= 2) {
                            const keep = new Set(presetIds.slice(0, Math.ceil(presetIds.length / 2)));
                            const drop = new Set(presetIds.filter((id) => !keep.has(id)));
                            const keepCities = cities.filter((c) => {
                              const o = cityOrigin[c.key];
                              return !o || o === "manual" || keep.has(o);
                            });
                            setCities(keepCities);
                            setCityOrigin((prev) => {
                              const next: Record<string, string> = {};
                              for (const k of Object.keys(prev)) if (!drop.has(prev[k])) next[k] = prev[k];
                              return next;
                            });
                            setSelectedPresetIds(keep);
                            toast({ title: "Dividido em 2 campanhas", description: `Mantive ${keep.size} distribuidora(s). Crie esta agora e depois faça outra com as restantes.` });
                          } else {
                            // só 1 preset — corta cidades pela metade
                            const half = Math.ceil(cities.length / 2);
                            const dropped = cities.slice(half);
                            setCities(cities.slice(0, half));
                            setCityOrigin((prev) => {
                              const next = { ...prev };
                              for (const c of dropped) delete next[c.key];
                              return next;
                            });
                            toast({ title: "Cidades divididas pela metade", description: `${half} cidades nesta campanha. Crie outra depois com as ${dropped.length} restantes.` });
                          }
                        }}>
                        Dividir agora (metade aqui, metade depois)
                      </Button>
                    </div>
                  </div>
                )}

                <div className="border-t border-border/50 pt-3" />

                <Label>Cidades onde quer anunciar ({cities.length}/200)</Label>
                <p className="text-[11px] text-muted-foreground -mt-1">Quanto mais cidades, mais barato fica o lead (mais inventário pro algoritmo otimizar).</p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Ex: São Paulo, Belo Horizonte..." value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                {searchLoading && <div className="text-xs text-muted-foreground">Buscando...</div>}
                {hits.length > 0 && (
                  <div className="border rounded-lg divide-y bg-card max-h-60 overflow-y-auto">
                    {hits.map(h => (
                      <button key={h.key} type="button" onClick={() => addCity(h)} className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex items-center gap-2">
                        <MapPin className="w-3.5 h-3.5 text-primary" />
                        <span className="font-medium">{h.name}</span>
                        <span className="text-muted-foreground text-xs">{h.region}</span>
                      </button>
                    ))}
                  </div>
                )}
                {cities.length > 0 && (
                  <div className="space-y-2 pt-2">
                    {/* Aviso de cidade fora da UF da(s) distribuidora(s) ativa(s).
                        iGreen só atende cidades da concessão — anunciar fora gera
                        lead que não pode ser ativado. */}
                    {(() => {
                      const activePresets = DISTRIBUIDORAS_PRESETS.filter((p) => selectedPresetIds.has(p.id));
                      if (!activePresets.length) return null;
                      const allowedUFs = new Set(activePresets.flatMap((p) => p.uf.split("/").map((u) => u.trim().toUpperCase())));
                      const offenders = cities.filter((c) => {
                        if (cityOrigin[c.key] !== "manual") return false;
                        const region = (c.region || "").toLowerCase().trim();
                        if (!region) return false;
                        // Mapeia o nome do estado retornado pelo Meta -> UF
                        const UF_MAP: Record<string, string> = {
                          acre:"AC", alagoas:"AL", amapá:"AP", amazonas:"AM", bahia:"BA", ceará:"CE",
                          "distrito federal":"DF", "espírito santo":"ES", goiás:"GO", maranhão:"MA",
                          "mato grosso":"MT", "mato grosso do sul":"MS", "minas gerais":"MG", pará:"PA",
                          paraíba:"PB", paraná:"PR", pernambuco:"PE", piauí:"PI", "rio de janeiro":"RJ",
                          "rio grande do norte":"RN", "rio grande do sul":"RS", rondônia:"RO", roraima:"RR",
                          "santa catarina":"SC", "são paulo":"SP", sergipe:"SE", tocantins:"TO",
                        };
                        const uf = UF_MAP[region] || (region.length === 2 ? region.toUpperCase() : "");
                        return uf && !allowedUFs.has(uf);
                      });
                      if (offenders.length === 0) return null;
                      const names = offenders.slice(0, 5).map((c) => c.name).join(", ");
                      const extra = offenders.length > 5 ? ` +${offenders.length - 5}` : "";
                      return (
                        <div className="text-xs rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex items-start justify-between gap-2">
                          <div>
                            <div className="font-bold text-amber-200">⚠ {offenders.length} cidade(s) fora da área da distribuidora</div>
                            <div className="text-amber-200/80 mt-0.5">
                              {names}{extra} — fora de {Array.from(allowedUFs).join("/")}. Lead daqui não pode ser ativado pela iGreen.
                            </div>
                          </div>
                          <Button type="button" size="sm" variant="outline" className="h-7 text-[11px] shrink-0"
                            onClick={() => offenders.forEach((c) => removeCityKey(c.key))}>
                            Remover
                          </Button>
                        </div>
                      );
                    })()}
                    {cities.length > 12 && (
                      <div className="flex items-center gap-2">
                        <Input
                          className="h-8 text-xs"
                          placeholder={`Filtrar entre ${cities.length} cidades...`}
                          value={cityFilter}
                          onChange={(e) => setCityFilter(e.target.value)}
                        />
                        <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={clearAllCities}>
                          Limpar tudo
                        </Button>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                      {cities
                        .filter((c) => !cityFilter || c.name.toLowerCase().includes(cityFilter.toLowerCase()))
                        .map((c) => (
                          <Badge key={c.key} variant="secondary" className="gap-1.5 py-1 px-2 text-xs">
                            {c.name}
                            <button onClick={() => removeCityKey(c.key)}><X className="w-3 h-3" /></button>
                          </Badge>
                        ))}
                    </div>
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  ✨ Pré-configurado: idade 25-65, Advantage+ Audience ON, posicionamentos automáticos FB+IG, lance Lowest Cost, objetivo Mensagens (WhatsApp).
                </div>
                </>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                {/* Modo do criativo: várias fotos (asset_feed_spec) OU 1 vídeo Reels. */}
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setCreativeMode("photo")}
                    className={`p-3 rounded-lg border text-left transition ${creativeMode === "photo" ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}>
                    <div className="font-semibold text-sm flex items-center gap-1.5">
                      {creativeMode === "photo" && <Check className="w-3.5 h-3.5 text-primary" />}
                      <ImageIcon className="w-3.5 h-3.5" /> Fotos
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">Até 4 imagens por formato — Meta escolhe a melhor.</div>
                  </button>
                  <button type="button" onClick={() => setCreativeMode("video")}
                    className={`p-3 rounded-lg border text-left transition ${creativeMode === "video" ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}>
                    <div className="font-semibold text-sm flex items-center gap-1.5">
                      {creativeMode === "video" && <Check className="w-3.5 h-3.5 text-primary" />}
                      <Video className="w-3.5 h-3.5" /> Vídeo Reels
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">1 vídeo vertical 9:16 — só Reels e Stories.</div>
                  </button>
                </div>

                {creativeMode === "video" ? (
                  <div className="space-y-3">
                    <div className={`border-2 border-dashed rounded-xl p-6 text-center ${videoFile ? "opacity-60" : ""}`}>
                      <input type="file" accept="video/mp4,video/quicktime,video/mov" id="video-input" className="hidden"
                        onChange={async (e) => {
                          const f = e.target.files?.[0]; e.currentTarget.value = "";
                          if (!f) return;
                          if (f.size > 50 * 1024 * 1024) { toast({ title: "Vídeo maior que 50 MB", description: "Comprima o vídeo (ex: HandBrake, CapCut) e tente de novo.", variant: "destructive" }); return; }
                          if (!/^video\/(mp4|quicktime|mov)$/.test(f.type)) { toast({ title: "Use MP4 ou MOV", variant: "destructive" }); return; }
                          // Lê metadata (duração e dimensões) p/ avisar se não for vertical.
                          const url = URL.createObjectURL(f);
                          const v = document.createElement("video");
                          v.preload = "metadata"; v.src = url;
                          v.onloadedmetadata = () => {
                            const meta = { duration: v.duration, w: v.videoWidth, h: v.videoHeight };
                            setVideoFile(f); setVideoUrl(url); setVideoMeta(meta);
                            if (meta.duration < 4) toast({ title: "Vídeo muito curto", description: "Mínimo 4 segundos.", variant: "destructive" });
                            else if (meta.w / meta.h > 0.65) toast({ title: "Atenção: vídeo não é vertical", description: "Recomendado 9:16 (1080×1920) p/ Reels.", variant: "destructive" });
                          };
                        }} />
                      <label htmlFor="video-input" className="cursor-pointer space-y-2 block">
                        <Video className="w-8 h-8 text-primary mx-auto" />
                        <div className="text-sm font-medium">Clique para enviar 1 vídeo Reels</div>
                        <div className="text-xs text-muted-foreground">
                          MP4 ou MOV · vertical <strong className="text-foreground">9:16 (1080×1920)</strong> · 4–60s · até 50 MB
                        </div>
                      </label>
                    </div>
                    {videoUrl && (
                      <div className="space-y-2">
                        <div className="relative rounded-lg overflow-hidden border border-primary/40 bg-black max-w-[280px] mx-auto">
                          <video src={videoUrl} controls className="w-full aspect-[9/16] object-cover" />
                          <div className="absolute top-1 right-1">
                            <button type="button" onClick={() => {
                              setVideoFile(null); setVideoUrl(null); setVideoMeta(null);
                              setVideoCaptionsSrt(null); setVideoCaptionsError(null); setVideoCaptionsLoading(false);
                            }}
                              className="bg-destructive text-destructive-foreground rounded-full p-1">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                          {videoMeta && (
                            <div className="text-[10px] text-center py-1 bg-black/60 text-white">
                              {videoMeta.w}×{videoMeta.h} · {videoMeta.duration.toFixed(1)}s
                            </div>
                          )}
                        </div>
                        {/* Legendas automáticas: 85% do Feed assiste sem som. */}
                        <div className="max-w-[320px] mx-auto rounded-lg border border-border bg-card/40 p-3 text-xs space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={videoCaptionsEnabled}
                                onChange={(e) => setVideoCaptionsEnabled(e.target.checked)}
                                className="accent-primary"
                              />
                              <span className="font-medium">Gerar legenda automática</span>
                            </label>
                            <span className="text-[10px] text-muted-foreground">recomendado</span>
                          </div>
                          {videoCaptionsLoading && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Loader2 className="w-3 h-3 animate-spin" /> Transcrevendo áudio…
                            </div>
                          )}
                          {!videoCaptionsLoading && videoCaptionsSrt && (
                            <div className="text-emerald-600 dark:text-emerald-400">
                              ✓ Legenda pronta — vai junto com o vídeo no Reels/Feed/Stories.
                            </div>
                          )}
                          {!videoCaptionsLoading && videoCaptionsError && (
                            <div className="text-amber-600 dark:text-amber-400">
                              ⚠ {videoCaptionsError} (vídeo sobe sem legenda)
                            </div>
                          )}
                          {!videoCaptionsLoading && !videoCaptionsSrt && !videoCaptionsError && videoCaptionsEnabled && videoFile && (
                            <button
                              type="button"
                              onClick={async () => {
                                if (!videoFile) return;
                                setVideoCaptionsLoading(true); setVideoCaptionsError(null);
                                try {
                                  const { supabase } = await import("@/integrations/supabase/client");
                                  // Sobe vídeo p/ storage primeiro (ad-video-captions precisa de URL pública)
                                  const up = await uploadAdVideo(consultantId, videoFile);
                                  const { data, error } = await supabase.functions.invoke("ad-video-captions", {
                                    body: { video_url: up.url },
                                  });
                                  if (error) throw error;
                                  if ((data as any)?.error) {
                                    setVideoCaptionsError((data as any).hint || (data as any).error);
                                  } else if ((data as any)?.srt) {
                                    setVideoCaptionsSrt((data as any).srt);
                                  } else {
                                    setVideoCaptionsError("Falha desconhecida ao gerar legenda");
                                  }
                                } catch (e: any) {
                                  setVideoCaptionsError(e?.message || "Erro ao gerar legenda");
                                } finally {
                                  setVideoCaptionsLoading(false);
                                }
                              }}
                              className="w-full px-2 py-1.5 rounded bg-primary/10 hover:bg-primary/20 text-primary font-medium"
                            >
                              Gerar legenda agora
                            </button>
                          )}
                          <div className="text-[10px] text-muted-foreground leading-snug">
                            85% das pessoas assistem vídeos sem som. Legenda costuma subir CTR em 30–60%.
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                <>
                <div>
                  <Label className="flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5 text-primary" /> Formato do anúncio</Label>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {(Object.keys(FORMAT_SPEC) as AdFormat[]).map(k => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setFormat(k)}
                        className={`text-left text-xs p-2.5 rounded-lg border transition ${format === k ? "border-primary bg-primary/10" : "border-border hover:bg-accent"}`}
                      >
                        <div className="font-bold">{FORMAT_SPEC[k].label}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{FORMAT_SPEC[k].desc}</div>
                        <div className="text-[10px] mt-1 font-bold text-primary">{filesByFormat[k].length}/{PER_FORMAT_LIMIT} foto(s)</div>
                      </button>
                    ))}
                  </div>
                </div>

                <Tabs value={photoTab} onValueChange={(v) => setPhotoTab(v as any)}>
                  <TabsList className="grid grid-cols-2 w-full">
                    <TabsTrigger value="upload">🆕 Enviar novo</TabsTrigger>
                    <TabsTrigger value="library">📁 Minhas imagens</TabsTrigger>
                  </TabsList>
                  <TabsContent value="upload" className="space-y-3 mt-3">
                    <div className={`border-2 border-dashed rounded-xl p-6 text-center ${adFiles.length >= PER_FORMAT_LIMIT ? "opacity-50 pointer-events-none" : ""}`}>
                      <input type="file" accept="image/jpeg,image/png,image/webp" multiple id="photos-input" className="hidden"
                        onChange={e => { handleFiles(e.target.files); e.currentTarget.value = ""; }} />
                      <label htmlFor="photos-input" className="cursor-pointer space-y-2 block">
                        <Upload className="w-8 h-8 text-primary mx-auto" />
                        <div className="text-sm font-medium">Clique para enviar fotos {FORMAT_SPEC[format].label} ({adFiles.length}/{PER_FORMAT_LIMIT})</div>
                        <div className="text-xs text-muted-foreground">
                          Tamanho exigido: <strong className="text-foreground">{FORMAT_SPEC[format].w}×{FORMAT_SPEC[format].h}</strong> · JPG/PNG/WebP · até 8 MB
                        </div>
                      </label>
                    </div>
                    {adFiles.length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {adFiles.map((a, i) => {
                          const ok = isFileValid(a);
                          return (
                            <div key={i} className={`relative group rounded-lg overflow-hidden border-2 ${ok ? "border-primary/50" : "border-amber-500/60"} bg-muted`}>
                              <div className={FORMAT_SPEC[format].ratio === 0.5625 ? "aspect-[9/16]" : FORMAT_SPEC[format].ratio === 0.8 ? "aspect-[4/5]" : "aspect-square"}>
                                <img src={a.url} alt="" className="w-full h-full object-cover" />
                              </div>
                              <div className="absolute bottom-0 inset-x-0 bg-black/70 text-[10px] text-white px-1.5 py-1 flex items-center justify-between">
                                <span>{a.w}×{a.h}</span>
                                {ok ? <span className="text-primary">✓</span> : (
                                  <div className="flex gap-1.5">
                                    <button type="button" onClick={() => handleCrop(i)} className="text-amber-300 underline">Cortar</button>
                                    <button type="button" onClick={() => handleAiResize(i)} disabled={aiResizingIdx === i}
                                      className="text-emerald-300 underline flex items-center gap-0.5">
                                      {aiResizingIdx === i ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Wand2 className="w-2.5 h-2.5" />}
                                      IA
                                    </button>
                                  </div>
                                )}
                              </div>
                              <button onClick={() => removeFile(i)} className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </TabsContent>
                  <TabsContent value="library" className="mt-3">
                    <AdImageLibraryPanel
                      consultantId={consultantId}
                      format={format}
                      selectedUrls={new Set(pickedLibrary.map((it) => it.url))}
                      onPick={(it) => setPickedLibrary((prev) =>
                        prev.find((x) => x.url === it.url)
                          ? prev.filter((x) => x.url !== it.url)
                          : [...prev, it]
                      )}
                    />
                  </TabsContent>
                </Tabs>
                {pickedLibrary.length > 0 && (
                  <div className="text-[11px] text-emerald-400">
                    📁 {pickedLibrary.length} imagem(ns) da biblioteca selecionada(s) — sem novo upload.
                  </div>
                )}
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <Smartphone className="w-3 h-3" /> Total: <strong className="text-foreground">{totalFiles + pickedLibrary.length}</strong> foto(s). Misture formatos — Meta usa cada um no posicionamento ideal.
                </div>
                </>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="grid lg:grid-cols-[1fr_320px] gap-5">
                <div className="space-y-4">
                {copyLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Gerando copy com IA...</div>
                ) : (
                  <>
                    <div>
                      <Label className="flex justify-between"><span>Título principal</span><span className={`text-[10px] ${headline.length > COPY_LIMITS.headline ? "text-destructive" : "text-muted-foreground"}`}>{headline.length}/{COPY_LIMITS.headline}</span></Label>
                      <Input maxLength={COPY_LIMITS.headline} value={headline} onChange={e => setHeadline(e.target.value)} placeholder="Conta 20% mais barata" />
                      {copy && copy.headlines.length > 1 && (
                        <div className="flex flex-col gap-1.5 mt-2">
                          {(copy.variations?.headlines || copy.headlines.map((t) => ({ text: t, framework: "geral", score: 75 }))).map((h, i) => (
                            <button key={i} onClick={() => setHeadline(h.text)} className={`text-xs text-left px-2.5 py-1.5 rounded-lg border transition flex items-center justify-between gap-2 ${headline === h.text ? "border-primary bg-primary/10" : "border-border bg-secondary hover:bg-primary/10"}`}>
                              <span className="truncate">{h.text}</span>
                              <span className="flex items-center gap-1 shrink-0">
                                <span className="text-[9px] uppercase text-muted-foreground">{h.framework}</span>
                                <span className={`text-[10px] font-bold ${h.score >= 85 ? "text-emerald-400" : h.score >= 70 ? "text-amber-400" : "text-muted-foreground"}`}>{h.score}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <Label className="flex justify-between"><span>Texto principal (curto e certeiro)</span><span className={`text-[10px] ${primaryText.length > COPY_LIMITS.primary ? "text-destructive" : "text-muted-foreground"}`}>{primaryText.length}/{COPY_LIMITS.primary}</span></Label>
                      <Textarea rows={3} maxLength={COPY_LIMITS.primary} value={primaryText} onChange={e => setPrimaryText(e.target.value)} placeholder="Sua conta de luz 20% mais barata. Sem obra. Fala no zap 👇" />
                      {copy && copy.primary_texts.length > 1 && (
                        <div className="flex flex-col gap-1.5 mt-2">
                          {(copy.variations?.primary_texts || copy.primary_texts.map((t) => ({ text: t, framework: "geral", score: 75 }))).map((t, i) => (
                            <button key={i} onClick={() => setPrimaryText(t.text)} className={`text-xs text-left px-2.5 py-1.5 rounded-lg border transition ${primaryText === t.text ? "border-primary bg-primary/10" : "border-border bg-secondary hover:bg-primary/10"}`}>
                              <div className="flex items-center justify-between gap-2 mb-0.5">
                                <span className="text-[9px] uppercase text-muted-foreground">{t.framework}</span>
                                <span className={`text-[10px] font-bold ${t.score >= 85 ? "text-emerald-400" : t.score >= 70 ? "text-amber-400" : "text-muted-foreground"}`}>{t.score}/100</span>
                              </div>
                              <div className="line-clamp-2">{t.text}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <Label className="flex justify-between"><span>Descrição curta</span><span className={`text-[10px] ${description.length > COPY_LIMITS.description ? "text-destructive" : "text-muted-foreground"}`}>{description.length}/{COPY_LIMITS.description}</span></Label>
                      <Input maxLength={COPY_LIMITS.description} value={description} onChange={e => setDescription(e.target.value)} placeholder="Sem obra. Sem taxa." />
                    </div>
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-2">
                      <Label className="flex justify-between items-center">
                        <span className="flex items-center gap-1.5">
                          <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                          Primeira mensagem no WhatsApp
                        </span>
                        <span className={`text-[10px] ${initialMessage.length > INITIAL_MSG_LIMIT ? "text-destructive" : "text-muted-foreground"}`}>
                          {initialMessage.length}/{INITIAL_MSG_LIMIT}
                        </span>
                      </Label>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        É o que vai aparecer escrito quando o lead clicar no anúncio. Escreva curto, em 1ª pessoa, como se fosse o cliente falando.
                      </p>
                      <Textarea
                        rows={2}
                        maxLength={INITIAL_MSG_LIMIT}
                        value={initialMessage}
                        onChange={(e) => { setInitialMessage(e.target.value); setInitialMessageTouched(true); }}
                        placeholder="Olá! Quero saber mais sobre a redução na conta de luz."
                        className="bg-background/50"
                      />
                      <div className="flex items-start gap-2 mt-1">
                        <div className="shrink-0 w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center text-[10px] font-bold text-emerald-300">EU</div>
                        <div className="bg-emerald-500 text-white text-xs px-3 py-2 rounded-2xl rounded-tl-sm max-w-[85%] shadow">
                          {initialMessage || <span className="opacity-60 italic">sua mensagem aparece aqui</span>}
                        </div>
                      </div>
                      {initialMessageTouched && (
                        <button
                          type="button"
                          onClick={() => { setInitialMessage(buildDefaultInitialMessage(distribuidoraPrimary)); setInitialMessageTouched(false); }}
                          className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                        >
                          voltar para a sugestão automática
                        </button>
                      )}
                    </div>
                  </>
                )}
                </div>
                <AdPreview
                  imagesByFormat={{
                    square: filesByFormat.square[0]?.url,
                    vertical: filesByFormat.vertical[0]?.url,
                    story: filesByFormat.story[0]?.url,
                  }}
                  pageName={connection?.page_name || "iGreen Energy"}
                  headline={headline}
                  primaryText={primaryText}
                  description={description}
                  whatsappNumber={consultantPhone || ""}
                />
                <div className="lg:col-start-2">
                  <AdQualityPanel
                    headline={headline}
                    primary={primaryText}
                    description={description}
                    cityCount={cities.length}
                    distribuidora={distribuidoraPrimary}
                    primaryImage={creativeMode === "video" ? null : (() => {
                      const f = filesByFormat.vertical[0] || filesByFormat.square[0] || filesByFormat.story[0];
                      const fmt: AdFormat = filesByFormat.vertical[0] ? "vertical" : filesByFormat.square[0] ? "square" : "story";
                      return f ? { url: f.url, w: f.w, h: f.h, format: fmt } : null;
                    })()}
                    primaryVideo={creativeMode === "video" && videoMeta ? { w: videoMeta.w, h: videoMeta.h, duration: videoMeta.duration } : null}
                    onChange={setQuality}
                  />
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-5">
                <CtwaPreflightCard consultantId={consultantId} onReadyChange={setCtwaReady} />

                {/* Aviso sobre a Página da plataforma — toda a rede compartilha 1 Page hoje. */}
                {connection?.page_name && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                    <div className="font-semibold text-amber-700 dark:text-amber-400 mb-0.5">
                      Página que vai aparecer no anúncio: <strong>{connection.page_name}</strong>
                    </div>
                    <div className="text-muted-foreground leading-snug">
                      Essa é a Página única da plataforma. Para sua marca aparecer no lugar, peça
                      ao admin pra conectar uma Página própria sua no Meta Business Suite.
                    </div>
                  </div>
                )}


                {/* Modo Econômico × Padrão × Personalizado — presets de orçamento */}
                <div>
                  <Label className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-primary" /> Preset de orçamento</Label>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {[
                      { id: "eco", label: "Modo Econômico", budget: 15, days: 3, hint: "R$ 45 total · testa rápido" },
                      { id: "std", label: "Padrão", budget: 25, days: 7, hint: "R$ 175 total · recomendado" },
                      { id: "custom", label: "Personalizado", budget, days: duration, hint: "ajuste manual" },
                    ].map((p) => {
                      const active = (p.id === "eco" && budget === 15 && duration === 3)
                        || (p.id === "std" && budget === 25 && duration === 7)
                        || (p.id === "custom" && !(budget === 15 && duration === 3) && !(budget === 25 && duration === 7));
                      return (
                        <button key={p.id} type="button"
                          onClick={() => { if (p.id === "eco") { setBudget(15); setDuration(3); } else if (p.id === "std") { setBudget(25); setDuration(7); } }}
                          className={`p-2.5 rounded-lg border text-left transition ${active ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}>
                          <div className="font-semibold text-xs flex items-center gap-1">
                            {active && <Check className="w-3 h-3 text-primary" />} {p.label}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{p.hint}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <Label>Orçamento diário: <span className="text-primary font-bold">R$ {budget}</span></Label>
                  <Slider min={10} max={500} step={5} value={[budget]} onValueChange={v => setBudget(v[0])} />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1"><span>R$ 10</span><span>R$ 500</span></div>
                </div>

                <div>
                  <Label>Duração: <span className="text-primary font-bold">{duration === 0 ? "Sem fim (até pausar)" : `${duration} dias`}</span></Label>
                  <Slider min={0} max={30} step={1} value={[duration]} onValueChange={v => setDuration(v[0])} />
                </div>
                <Card className="p-4 bg-primary/5 border-primary/20 space-y-2 text-sm">
                  <div className="font-bold flex items-center gap-2"><Check className="w-4 h-4 text-primary" /> Resumo</div>
                  {geoMode === "radius" ? (
                    <div className="text-muted-foreground">📍 {radiusPoints.length} endereço(s) — raio {radiusPoints[0]?.radius || 0} km</div>
                  ) : (
                    <div className="text-muted-foreground">📍 {cities.length} cidade(s) — {cities.slice(0, 3).map(c => c.name).join(", ")}{cities.length > 3 ? "..." : ""}</div>
                  )}
                  {creativeMode === "video" ? (
                    <div className="text-muted-foreground">🎬 1 vídeo Reels {videoMeta ? `(${videoMeta.duration.toFixed(1)}s)` : ""}</div>
                  ) : (
                    <div className="text-muted-foreground">🖼️ {totalFiles} foto(s) — {filesByFormat.square.length} quadrada(s), {filesByFormat.vertical.length} vertical(is), {filesByFormat.story.length} story</div>
                  )}
                  <div className="text-muted-foreground">💰 R$ {budget}/dia × {duration === 0 ? "contínuo" : `${duration} dias`} = <strong className="text-foreground">R$ {duration === 0 ? `${budget * 30}/mês est.` : (budget * duration)}</strong></div>
                  <div className="text-[11px] text-muted-foreground border-t border-border/30 pt-1.5">
                    Estimativa honesta: a R$ {budget}/dia, espere ~{Math.max(1, Math.round(budget / 6))}–{Math.round(budget / 3)} conversas no WhatsApp/dia, das quais ~20–35% viram lead qualificado.
                  </div>
                  <div className={`rounded-md p-2 mt-1 ${consultantPhone ? "bg-primary/10 border border-primary/30" : "bg-destructive/10 border border-destructive/40"}`}>
                    <div className={consultantPhone ? "text-foreground" : "text-destructive font-semibold"}>
                      🎯 Click-to-WhatsApp <strong>nativo</strong> (sem link wa.me)
                    </div>
                    {consultantPhone ? (
                      <>
                        <div className="text-xs mt-1">
                          Ao clicar no anúncio, o WhatsApp Business abre direto no número:
                        </div>
                        <div className="text-base font-bold text-primary mt-1">
                          {formatBrPhone(consultantPhone)}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-1">
                          Esse número precisa estar vinculado à sua Página no Meta Business Suite → WhatsApp → Contas.
                        </div>
                      </>
                    ) : phoneLoading ? (
                      <div className="text-xs mt-1">carregando número...</div>
                    ) : (
                      <div className="text-xs mt-1">
                        ⚠️ Número não configurado. Adicione seu WhatsApp Business na aba <strong>Dados</strong> antes de publicar.
                      </div>
                    )}
                  </div>
                </Card>

                <Card className="p-4 space-y-3 text-sm">
                  <div className="font-bold flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Onde publicar</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setPlacementMode("auto")}
                      className={`p-3 rounded-lg border text-left transition ${placementMode === "auto" ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}>
                      <div className="font-semibold flex items-center gap-1.5">
                        {placementMode === "auto" && <Check className="w-3.5 h-3.5 text-primary" />}
                        Automático
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Advantage+ Placements — Meta distribui em todos os posicionamentos elegíveis e otimiza CPL. <strong className="text-primary">Recomendado.</strong></div>
                    </button>
                    <button type="button" onClick={() => setPlacementMode("manual")}
                      className={`p-3 rounded-lg border text-left transition ${placementMode === "manual" ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}>
                      <div className="font-semibold flex items-center gap-1.5">
                        {placementMode === "manual" && <Check className="w-3.5 h-3.5 text-primary" />}
                        Manual
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Você escolhe exatamente onde o anúncio aparece.</div>
                    </button>
                  </div>
                  {placementMode === "manual" && (
                    <div className="space-y-2 pt-2 border-t border-border/40">
                      {([
                        { label: "Feed & Descoberta", items: [["fb:feed","Facebook Feed"],["ig:stream","Instagram Feed"],["fb:marketplace","Marketplace"],["ig:explore","Explore"]] },
                        { label: "Stories", items: [["fb:story","Facebook Stories"],["ig:story","Instagram Stories"]] },
                        { label: "Reels", items: [["fb:facebook_reels","Facebook Reels"],["ig:reels","Instagram Reels"]] },
                        { label: "Vídeo", items: [["fb:video_feeds","Facebook Video Feeds"],["fb:instream_video","In-stream Video"]] },
                        { label: "Busca", items: [["fb:search","Facebook Search"]] },
                      ] as const).map((group) => (
                        <div key={group.label}>
                          <div className="text-xs font-semibold text-muted-foreground mb-1">{group.label}</div>
                          <div className="flex flex-wrap gap-1.5">
                            {group.items.map(([key, label]) => {
                              const active = placements.includes(key);
                              return (
                                <button key={key} type="button"
                                  onClick={() => setPlacements(active ? placements.filter(p => p !== key) : [...placements, key])}
                                  className={`px-2.5 py-1 rounded-full text-xs border transition ${active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/50"}`}>
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      <div className="text-[11px] text-amber-400 pt-1">⚠ Audience Network e Messenger não suportam destino WhatsApp.</div>
                    </div>
                  )}
                </Card>

                {preflightLoading && (
                  <Card className="p-3 text-xs flex items-center gap-2 text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Validando com Facebook (token, conta, alcance)...</Card>
                )}
                {preflight && (
                  <Card className={`p-3 text-xs space-y-2 border ${preflight.ok ? "bg-emerald-500/10 border-emerald-500/30" : "bg-destructive/10 border-destructive/30"}`}>
                    <div className={`font-bold flex items-center gap-2 ${preflight.ok ? "text-emerald-400" : "text-destructive"}`}>
                      {preflight.ok ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                      {preflight.ok ? "Pré-voo aprovado" : "Pré-voo bloqueado"}
                    </div>
                    {preflight.blockers.map((b, i) => <div key={i} className="text-destructive">• {b}</div>)}
                    {preflight.warnings.map((w, i) => <div key={i} className="text-amber-400">⚠ {w}</div>)}
                    {preflight.reach && (
                      <div className="text-muted-foreground border-t border-border/40 pt-2">
                        📡 Alcance estimado: <strong className="text-foreground">{preflight.reach.lower.toLocaleString("pt-BR")}–{preflight.reach.upper.toLocaleString("pt-BR")}</strong> pessoas elegíveis
                        {preflight.reach.lower > 0 && (
                          <div className="text-[11px] mt-0.5">~{preflight.reach.daily_min.toLocaleString("pt-BR")}–{preflight.reach.daily_max.toLocaleString("pt-BR")} pessoas/dia atingíveis</div>
                        )}
                      </div>
                    )}
                  </Card>
                )}
              </div>
            )}

            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => step > 1 ? setStep((step - 1) as Step) : onClose()} disabled={submitting}>
                {step === 1 ? "Cancelar" : "Voltar"}
              </Button>
              <div className="flex gap-2">
                {step === 4 && (
                  <Button type="button" variant="outline" onClick={() => setSaveTplOpen(true)} disabled={submitting || savingTemplate} className="gap-1.5">
                    {savingTemplate ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Salvar como template
                  </Button>
                )}
                <Button
                  onClick={handleNext}
                  disabled={
                    submitting ||
                    copyLoading ||
                    (step === 4 && preflightLoading) ||
                    (step === 4 && !ctwaReady && !isSuperAdmin)
                  }
                  title={step === 4 && !ctwaReady && !isSuperAdmin ? "Complete a pré-checagem CTWA acima antes de publicar" : undefined}
                >
                  {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Publicando...</> : (
                    <>{step === 4 ? "Publicar campanha" : "Próximo"} <ChevronRight className="w-4 h-4 ml-1" /></>
                  )}
                </Button>

              </div>
            </div>
          </div>
        )}
      </DialogContent>
      <SaveTemplateDialog
        open={saveTplOpen}
        onClose={() => setSaveTplOpen(false)}
        defaultTitle={`${distribuidoraPrimary || "Multi"} — ${headline.slice(0, 40)}`}
        saving={savingTemplate}
        isSuperAdmin={isSuperAdmin}
        onConfirm={(meta) => handleSaveAsTemplate(meta)}
      />
      <AlertDialog open={lowScoreConfirm} onOpenChange={setLowScoreConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Score {quality?.score ?? 0}/100 — abaixo do ideal</AlertDialogTitle>
            <AlertDialogDescription>
              Anúncios com score abaixo de 70 tendem a ter CPL mais alto e menos alcance. Você pode voltar e ajustar copy/foto, ou publicar mesmo assim.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar a ajustar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setLowScoreConfirm(false); setStep(4); runPreflight(); }}>
              Publicar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
