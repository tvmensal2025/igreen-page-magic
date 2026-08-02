import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import jsPDF from "jspdf";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FlyerStaticPreview } from "@/components/admin/FlyerStaticPreview";
import {
  drawImageCover,
  drawQrWithThinFrame,
  loadFlyerImage,
} from "@/components/admin/flyerCanvasDraw";
import { drawFlyerFooter } from "@/components/admin/flyerFooter";
import { formatFlyerPhoneDisplay } from "@/components/admin/flyerPhoneDisplay";
import {
  FLYER_TEMPLATES,
  flyerFooterLeft,
  flyerFooterRight,
  type FlyerFormatId,
} from "@/components/admin/flyerTemplates";
import {
  Download,
  FileText,
  Loader2,
  MapPin,
  Wifi,
  Pencil,
  LayoutGrid,
  Store,
  Info,
  Lock,
  Users,
  History,
  QrCode,
  RotateCcw,
  Eye,
  AlertTriangle,
} from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  buildConsultantBannerInitials,
  buildConsultantLiveBannerUrl,
  slugifyBannerSpotCode,
} from "@/lib/consultantBannerLink";
import {
  buildDefaultQrPhrase,
  isGenericKeyword,
  QR_PHRASE_MAX,
} from "./qrPhrase";
import { HelpHint } from "@/components/ui/help-hint";
import { Badge } from "@/components/ui/badge";

export type BannerSpot = {
  id: string;
  code: string;
  keyword: string;
  phrase: string | null;
  is_active: boolean;
};

interface Props {
  open: boolean;
  onClose: () => void;
  consultantId: string;
  consultantName?: string;
  consultantIgreenId?: string;
  consultantPhone: string;
  /** Frase padrão do QR raiz /{ini}/{id} */
  defaultPhrase?: string | null;
  /** Todos os spots (ativos + arquivados). Download usa só ativos. */
  spots: BannerSpot[];
  onSpotsChanged: () => void;
  /** Aba inicial ao abrir o modal. */
  initialMode?: "root" | "spot";
  /** Spot pré-selecionado (ex.: vindo da hub). */
  initialSpotId?: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

/**
 * Banner VIVO do consultor.
 * QR = igreen.cloud/{iniciais}/{igreen_id}/{local?}
 * Frase/keyword no Supabase — edita sem reimprimir.
 */
export function ConsultantBannerDownloadModal({
  open,
  onClose,
  consultantId,
  consultantName = "",
  consultantIgreenId = "",
  consultantPhone,
  defaultPhrase = null,
  spots,
  onSpotsChanged,
  initialMode = "spot",
  initialSpotId,
}: Props) {
  const { toast } = useToast();
  const qrSvgWrapperRef = useRef<HTMLDivElement>(null);

  const [format, setFormat] = useState<FlyerFormatId>("a4");
  const [mode, setMode] = useState<"root" | "spot">("spot");
  const [selectedSpotId, setSelectedSpotId] = useState<string>("");
  const [newKeyword, setNewKeyword] = useState("");
  const [newCode, setNewCode] = useState("");
  const [editPhrase, setEditPhrase] = useState("");
  const [rootPhrase, setRootPhrase] = useState("");
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spotLeadCounts, setSpotLeadCounts] = useState<Record<string, number>>(
    {},
  );
  const [loadingCounts, setLoadingCounts] = useState(false);

  const template = FLYER_TEMPLATES[format];
  const initials = useMemo(
    () => buildConsultantBannerInitials(consultantName),
    [consultantName],
  );
  const igreenId = String(consultantIgreenId || "").replace(/\D/g, "");

  /** Só ativos no seletor de download — arquivados ficam na hub. */
  const activeSpots = useMemo(
    () => spots.filter((s) => s.is_active !== false),
    [spots],
  );

  const selectedSpot =
    activeSpots.find((s) => s.id === selectedSpotId) ||
    activeSpots[0] ||
    null;

  useEffect(() => {
    if (!open) return;
    setFormat("a4");
    setMode(initialMode);
    const preferred =
      (initialSpotId &&
        activeSpots.find((s) => s.id === initialSpotId)?.id) ||
      activeSpots[0]?.id ||
      "";
    setSelectedSpotId(preferred);
    setNewKeyword("");
    setNewCode("");
    setError(null);
    setRootPhrase(defaultPhrase || "");
    const spot =
      activeSpots.find((s) => s.id === preferred) || activeSpots[0] || null;
    if (spot) {
      setEditPhrase(spot.phrase || buildDefaultQrPhrase(spot.keyword));
    }
  }, [open, initialMode, initialSpotId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Carrega quantos leads vieram de cada banner (spot keyword = referral_keyword_matched).
  useEffect(() => {
    if (!open || !consultantId) return;
    setLoadingCounts(true);
    (async () => {
      try {
        const { data, error: err } = await supabase
          .from("customers")
          .select("referral_keyword_matched")
          .eq("consultant_id", consultantId)
          .not("referral_keyword_matched", "is", null);
        if (err) throw err;
        const counts: Record<string, number> = {};
        (data || []).forEach((row) => {
          const kw = String(row.referral_keyword_matched || "").trim();
          if (!kw) return;
          counts[kw] = (counts[kw] || 0) + 1;
        });
        setSpotLeadCounts(counts);
      } catch (e) {
        console.warn("[banner-lead-counts]", e);
      } finally {
        setLoadingCounts(false);
      }
    })();
  }, [open, consultantId, spots]);

  useEffect(() => {
    if (!selectedSpot) return;
    setEditPhrase(
      selectedSpot.phrase || buildDefaultQrPhrase(selectedSpot.keyword),
    );
  }, [selectedSpot?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const qrUrl = useMemo(() => {
    if (!igreenId) return "https://igreen.cloud";
    if (mode === "root") {
      return buildConsultantLiveBannerUrl({ initials, igreenId });
    }
    const code = selectedSpot?.code;
    if (!code) return buildConsultantLiveBannerUrl({ initials, igreenId });
    return buildConsultantLiveBannerUrl({
      initials,
      igreenId,
      spotCode: code,
    });
  }, [initials, igreenId, mode, selectedSpot?.code]);

  const previewPhrase = useMemo(() => {
    if (mode === "root") {
      return (rootPhrase || defaultPhrase || "").trim() ||
        "Oi! 👋 Vi sobre a iGreen Energy e quero saber como economizar na minha conta de luz.";
    }
    if (!selectedSpot) return "Cadastre um local abaixo para gerar o QR.";
    return (
      editPhrase.trim() ||
      buildDefaultQrPhrase(selectedSpot.keyword)
    );
  }, [mode, rootPhrase, defaultPhrase, selectedSpot, editPhrase]);

  /** Une keywords de TODOS os spots (ativos+arquivados) + existentes — nunca apaga histórico. */
  const syncBannerKeywords = useCallback(
    async (extraKeyword?: string) => {
      const { data: cons } = await supabase
        .from("consultants")
        .select("banner_keywords")
        .eq("id", consultantId)
        .maybeSingle();
      const existing = Array.isArray(
        (cons as { banner_keywords?: string[] | null } | null)?.banner_keywords,
      )
        ? ((cons as { banner_keywords: string[] }).banner_keywords || [])
        : [];
      const fromSpots = spots.map((s) => s.keyword.trim()).filter(Boolean);
      const next = Array.from(
        new Set(
          [...existing, ...fromSpots, extraKeyword?.trim()].filter(
            Boolean,
          ) as string[],
        ),
      );
      await supabase
        .from("consultants")
        .update({ banner_keywords: next })
        .eq("id", consultantId);
    },
    [consultantId, spots],
  );

  const handleCreateSpot = async () => {
    const kw = newKeyword.trim();
    if (!kw) {
      setError("Nome do banner é obrigatório (ex.: Posto Shell Centro).");
      return;
    }
    if (kw.length < 3) {
      setError("Nome muito curto. Use pelo menos 3 caracteres.");
      return;
    }
    if (isGenericKeyword(kw)) {
      setError(
        "Nome genérico demais (“energia”, “luz”…). Use o nome do ponto físico.",
      );
      return;
    }
    if (
      activeSpots.some(
        (s) => s.keyword.trim().toLowerCase() === kw.toLowerCase(),
      )
    ) {
      setError("Já existe um banner ativo com esse nome. Use outro nome.");
      return;
    }
    const code =
      slugifyBannerSpotCode(newCode || kw) ||
      slugifyBannerSpotCode(kw);
    if (!code) {
      setError("Código do local inválido.");
      return;
    }
    if (activeSpots.some((s) => s.code === code)) {
      setError(
        "Já existe um banner com esse código na URL. Mude o nome ou o código.",
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const phrase = buildDefaultQrPhrase(kw);
      const { data, error: err } = await supabase
        .from("consultant_banner_spots")
        .insert({
          consultant_id: consultantId,
          code,
          keyword: kw,
          phrase,
        } as never)
        .select("id, code, keyword, phrase, is_active")
        .single();
      if (err) throw err;
      await syncBannerKeywords(kw);
      onSpotsChanged();
      if (data) {
        setSelectedSpotId((data as BannerSpot).id);
        setEditPhrase(phrase);
        setMode("spot");
      }
      setNewKeyword("");
      setNewCode("");
      toast({
        title: "Local criado",
        description: `QR vivo: /${initials}/${igreenId}/${code}`,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Falha ao criar local.");
    } finally {
      setSaving(false);
    }
  };

  const handleSavePhrase = async () => {
    setSaving(true);
    setError(null);
    try {
      if (mode === "root") {
        const phrase = rootPhrase.trim().slice(0, QR_PHRASE_MAX + 40);
        const { error: err } = await supabase
          .from("consultants")
          .update({ banner_default_phrase: phrase || null } as never)
          .eq("id", consultantId);
        if (err) throw err;
        onSpotsChanged();
        toast({
          title: "Frase padrão salva",
          description: "Banners raiz já impressos passam a abrir esta frase.",
        });
      } else if (selectedSpot) {
        const phrase = editPhrase.trim().slice(0, QR_PHRASE_MAX + 40);
        const { error: err } = await supabase
          .from("consultant_banner_spots")
          .update({
            phrase: phrase || null,
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id", selectedSpot.id);
        if (err) throw err;
        onSpotsChanged();
        toast({
          title: "Frase do local salva",
          description:
            "Banner já impresso deste local abre a frase nova — sem reimprimir.",
        });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const footerLeft = flyerFooterLeft(
    consultantName || "CONSULTOR IGREEN",
    igreenId,
  );
  const footerRight = flyerFooterRight(
    formatFlyerPhoneDisplay(consultantPhone) || "FALE COMIGO",
  );

  const renderToCanvas = async (): Promise<HTMLCanvasElement | null> => {
    const svgEl = qrSvgWrapperRef.current?.querySelector("svg");
    if (!svgEl) return null;
    const CW = template.canvasW * 2;
    const CH = template.canvasH * 2;
    const canvas = document.createElement("canvas");
    canvas.width = CW;
    canvas.height = CH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#0a3d2c";
    ctx.fillRect(0, 0, CW, CH);
    try {
      const bg = await loadFlyerImage(template.bg);
      drawImageCover(ctx, bg, 0, 0, CW, CH);
    } catch {
      /* ignore */
    }
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const svgUrl =
      "data:image/svg+xml;base64," +
      btoa(unescape(encodeURIComponent(svgData)));
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        drawQrWithThinFrame(
          ctx,
          img,
          (template.qrX / 100) * CW,
          (template.qrY / 100) * CH,
          (template.qrSize / 100) * CW,
        );
        resolve();
      };
      img.onerror = () => resolve();
      img.src = svgUrl;
    });
    drawFlyerFooter(ctx, {
      canvasW: CW,
      canvasH: CH,
      footerYPercent: template.footerY,
      footerHPercent: template.footerH,
      footerLeft,
      footerRight,
      bgColor: "#0d3b1f",
      textColor: "#ffd700",
      fontFamily: 'Montserrat, "Arial Black", sans-serif',
      fontWeight: "900",
    });
    return canvas;
  };

  const fileBase = () => {
    const spot = mode === "spot" ? selectedSpot?.code || "local" : "raiz";
    return `${format === "a4" ? "panfleto-a4" : "banner-504x904"}-${initials}-${igreenId}-${slugify(spot)}`;
  };

  const canDownload =
    !!igreenId && (mode === "root" || !!selectedSpot);

  const downloadPNG = async () => {
    if (!canDownload) return;
    setRendering(true);
    try {
      const canvas = await renderToCanvas();
      if (!canvas) return;
      const a = document.createElement("a");
      a.download = `${fileBase()}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
      toast({ title: "PNG baixado!" });
    } finally {
      setRendering(false);
    }
  };

  const downloadQrOnly = async () => {
    if (!canDownload) return;
    setRendering(true);
    try {
      const svgEl = qrSvgWrapperRef.current?.querySelector("svg");
      const ok = await downloadQrOnlyPng(svgEl, fileBase());
      toast(
        ok
          ? { title: "QR Code baixado!" }
          : { title: "Não foi possível gerar o QR Code", variant: "destructive" },
      );
    } finally {
      setRendering(false);
    }
  };


  const downloadPDF = async () => {
    if (!canDownload) return;
    setRendering(true);
    try {
      const canvas = await renderToCanvas();
      if (!canvas) return;
      const { pdfWmm: wmm, pdfHmm: hmm } = template;
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: [wmm, hmm],
      });
      pdf.addImage(
        canvas.toDataURL("image/jpeg", 0.95),
        "JPEG",
        0,
        0,
        wmm,
        hmm,
      );
      pdf.save(`${fileBase()}.pdf`);
      toast({ title: "PDF baixado!" });
    } finally {
      setRendering(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100%-1rem)] sm:w-full max-w-4xl max-h-[90dvh] overflow-y-auto p-3 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <QrCode className="w-5 h-5 text-primary" /> Meus Banners (QR vivo)
            <HelpHint
              size={14}
              title="Como funciona o banner vivo"
              summary="Edite frase, arte e WhatsApp depois de impresso"
              details={
                "O QR aponta para um link SEU que nunca muda: igreen.cloud/{suas iniciais}/{seu ID}.\n\n" +
                "O que é VIVO (edita sem reimprimir): frase que abre no WhatsApp, arte do banner e número de WhatsApp de destino.\n\n" +
                "O que é FIXO depois de impresso: o endereço/código na URL. Se trocar, o papel pendurado na rua para de funcionar.\n\n" +
                "Geral é eterno (imprima 4.000 vezes). Criar um local novo NÃO apaga o anterior — só adiciona à lista.\n\n" +
                "Para saber QUAL ponto trouxe o lead: use Com local e dê um NOME (obrigatório), ex.: Posto Shell Centro. A tabela Nome | leituras | leads separa cada um."
              }
              example="Rafael Ferreira Dias → igreen.cloud/rfd/130392 (fixo) | frase e WhatsApp podem mudar"
            />
          </DialogTitle>
          <DialogDescription>
            Baixe e edite a frase. Criar outro local{" "}
            <span className="font-semibold">não apaga</span> os anteriores. O{" "}
            <span className="font-semibold">código da URL</span> é fixo depois de
            impresso.
          </DialogDescription>
        </DialogHeader>

        <Alert className="border-primary/20 bg-primary/5">
          <Info className="h-4 w-4 text-primary" />
          <AlertTitle className="text-sm">
            Antes de imprimir, entenda a regra
          </AlertTitle>
          <AlertDescription className="text-xs leading-relaxed">
            <ul className="list-disc pl-4 mt-1 space-y-1">
              <li>
                <strong>QR vivo:</strong> você pode mudar a frase do WhatsApp, a
                arte e o número de destino a qualquer momento.
              </li>
              <li>
                <strong>Endereço fixo:</strong> o que está no papel é{" "}
                <span className="font-mono text-foreground">
                  igreen.cloud/{initials}/{igreenId || "SEU_ID"}
                  {mode === "spot" && selectedSpot
                    ? `/${selectedSpot.code}`
                    : ""}
                </span>
                . Depois de impresso, não mude esse código.
              </li>
              <li>
                <strong>Nada some sozinho:</strong> o Geral é eterno; cada local
                novo só adiciona. Excluir (arquivar) é só se você pedir na página
                Meus Banners.
              </li>
            </ul>
          </AlertDescription>
        </Alert>

        <div className="grid gap-4 sm:gap-6 md:grid-cols-[auto_1fr] py-2 min-w-0">
          <div className="flex flex-col items-center gap-3 w-full min-w-0 max-w-full">
            <FlyerStaticPreview
              format={format}
              liveUrl={qrUrl}
              consultantName={consultantName || "CONSULTOR IGREEN"}
              consultantIgreenId={igreenId}
              consultantPhone={consultantPhone}
              qrSvgRef={qrSvgWrapperRef}
              previewMaxW={380}
              previewMaxH={440}
            />
            <p className="text-xs text-muted-foreground text-center max-w-[320px] flex items-center gap-1.5 justify-center">
              <Wifi className="h-3.5 w-3.5" />
              WhatsApp = chip vivo (Whapi ou Evolution conectado)
            </p>
            <p className="text-[10px] font-mono text-muted-foreground break-all text-center max-w-[320px]">
              {qrUrl}
            </p>
          </div>

          <div className="flex flex-col gap-4 min-w-0">
            <div className="flex flex-col gap-2">
              <Label className="text-sm">Formato</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={format === "a4" ? "default" : "outline"}
                  onClick={() => setFormat("a4")}
                >
                  Folha A4
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={format === "banner" ? "default" : "outline"}
                  onClick={() => setFormat("banner")}
                >
                  Banner 504×904mm
                </Button>
              </div>
            </div>

            {/* ESCOLHA DE TIPO DE BANNER — EXPLICAÇÃO VISUAL */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-sm">Qual tipo de banner você quer?</Label>
                <HelpHint
                  size={14}
                  title="Banner geral ou banner com local?"
                  summary="Escolha se quer rastrear de onde veio o lead"
                  details={
                    "Banner Geral: um único QR para tudo. Você sabe que o lead veio do banner, mas não sabe de qual lugar.\n\n" +
                    "Banner com Local: um QR para cada ponto (posto, padaria, feira). Você sabe exatamente qual lugar trouxe cada lead.\n\n" +
                    "Dica: use local sempre que quiser saber qual ponto de divulgação vale mais a pena."
                  }
                  example="Banner geral: igreen.cloud/rfd/130392 | Banner Posto Shell: igreen.cloud/rfd/130392/posto-shell"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Card: Banner com local */}
                <button
                  type="button"
                  onClick={() => setMode("spot")}
                  className={`text-left rounded-xl border p-3 transition-all ${
                    mode === "spot"
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg bg-primary/10 p-1.5">
                        <MapPin className="h-4 w-4 text-primary" />
                      </div>
                      <span className="font-medium text-sm">Com local</span>
                    </div>
                    {mode === "spot" && (
                      <Badge variant="default" className="text-[10px] h-5 px-1.5">
                        selecionado
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Crie um QR para cada ponto físico: posto, padaria, feira,
                    condomínio. Assim você sabe exatamente qual lugar trouxe cada
                    lead.
                  </p>
                  <p className="text-[10px] font-mono text-primary mt-2 break-all">
                    {`igreen.cloud/${initials || "rfd"}/${igreenId || "130392"}/posto-shell`}
                  </p>
                </button>

                {/* Card: Banner geral */}
                <button
                  type="button"
                  onClick={() => setMode("root")}
                  className={`text-left rounded-xl border p-3 transition-all ${
                    mode === "root"
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg bg-muted p-1.5">
                        <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <span className="font-medium text-sm">Geral</span>
                    </div>
                    {mode === "root" && (
                      <Badge variant="default" className="text-[10px] h-5 px-1.5">
                        selecionado
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Um único QR para todos os lugares. Você sabe que o lead veio
                    do banner, mas não sabe de qual ponto exato.
                  </p>
                  <p className="text-[10px] font-mono text-primary mt-2 break-all">
                    {`igreen.cloud/${initials || "rfd"}/${igreenId || "130392"}`}
                  </p>
                </button>
              </div>
            </div>

            {mode === "spot" ? (
              <Card className="border-border/60 bg-muted/30">
                <CardHeader className="p-3 pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <Store className="h-3.5 w-3.5 text-primary" />
                    Locais ativos — criar outro só adiciona (não apaga)
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0 space-y-3">
                  {activeSpots.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {activeSpots.map((s) => {
                        const count = spotLeadCounts[s.keyword] || 0;
                        const isSelected = selectedSpot?.id === s.id;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setSelectedSpotId(s.id)}
                            className={`text-left rounded-lg border p-2.5 transition-all ${
                              isSelected
                                ? "border-primary bg-primary/5 ring-1 ring-primary"
                                : "border-border bg-card hover:border-primary/40"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-medium text-xs truncate">
                                  {s.keyword}
                                </p>
                                <p className="text-[10px] font-mono text-muted-foreground break-all">
                                  igreen.cloud/{initials}/{igreenId}/{s.code}
                                </p>
                              </div>
                              <Badge
                                variant={isSelected ? "default" : "secondary"}
                                className="text-[10px] h-5 px-1.5 shrink-0"
                              >
                                <Users className="h-3 w-3 mr-1" />
                                {loadingCounts ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  count
                                )}
                              </Badge>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1.5">
                              {isSelected
                                ? "Selecionado — edite a frase abaixo"
                                : "Clique para editar frase / baixar"}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-border p-3 text-center">
                      <p className="text-[11px] text-muted-foreground">
                        Nenhum banner de local ainda. Crie o primeiro abaixo.
                      </p>
                    </div>
                  )}

                  <div className="grid gap-2 sm:grid-cols-2 pt-1 border-t border-border/40">
                    <div>
                      <Label className="text-[11px]">
                        Nome do banner <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        value={newKeyword}
                        onChange={(e) => {
                          setNewKeyword(e.target.value);
                          setNewCode(slugifyBannerSpotCode(e.target.value));
                          if (error) setError(null);
                        }}
                        placeholder="Ex.: Posto Shell Centro"
                        className="h-8 text-xs"
                        required
                        aria-required
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Obrigatório. É assim que Resultados mostra de qual ponto
                        veio cada lead.
                      </p>
                    </div>
                    <div>
                      <Label className="text-[11px] flex items-center gap-1">
                        <Lock className="h-3 w-3" />
                        Código fixo na URL
                      </Label>
                      <Input
                        value={newCode}
                        onChange={(e) =>
                          setNewCode(slugifyBannerSpotCode(e.target.value))
                        }
                        placeholder="posto-shell-centro"
                        className="h-8 text-xs font-mono"
                      />
                      <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Depois de imprimir, não mude esse código.
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={saving || !newKeyword.trim()}
                    onClick={handleCreateSpot}
                    className="w-full"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Criar banner com este nome"
                    )}
                  </Button>

                  {selectedSpot && (
                    <div className="space-y-1.5 pt-2 border-t border-border/40">
                      <Label className="text-[11px] flex items-center gap-1">
                        <Pencil className="h-3 w-3" />
                        Frase deste local (viva — pode editar sem reimprimir)
                      </Label>
                      <Textarea
                        value={editPhrase}
                        onChange={(e) => setEditPhrase(e.target.value)}
                        rows={3}
                        className="text-xs resize-none"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Mensagem que aparece no WhatsApp do cliente ao escanear.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleSavePhrase}
                        disabled={saving}
                        className="w-full"
                      >
                        Salvar frase (atualiza banners já impressos)
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card className="border-border/60 bg-muted/30">
                <CardHeader className="p-3 pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />
                    Banner geral (eterno)
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0 space-y-3">
                  <div className="rounded-lg border border-border bg-card p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-xs">Geral</p>
                        <p className="text-[10px] font-mono text-muted-foreground break-all">
                          igreen.cloud/{initials}/{igreenId}
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-[10px] h-5 px-1.5 shrink-0">
                        <Lock className="h-3 w-3 mr-1" />
                        eterno
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1.5">
                      Imprima quantas vezes quiser (ex.: 4.000) — o link não muda
                      e não some. Edite a frase abaixo sem reimprimir.
                    </p>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-border/40">
                    <Label className="text-[11px] flex items-center gap-1">
                      <Pencil className="h-3 w-3" />
                      Frase do banner geral (viva — pode editar sem reimprimir)
                    </Label>
                    <Textarea
                      value={rootPhrase}
                      onChange={(e) => setRootPhrase(e.target.value)}
                      rows={3}
                      className="text-xs resize-none"
                      placeholder="Oi! Vi sobre a iGreen e quero economizar na conta de luz."
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSavePhrase}
                      disabled={saving}
                      className="w-full"
                    >
                      Salvar frase padrão (atualiza banners já impressos)
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {error && (
              <p className="text-[11px] text-destructive">{error}</p>
            )}

            <div className="text-xs text-muted-foreground rounded-md border border-border/40 bg-card/50 p-2.5 space-y-1">
              <p>
                Ao escanear, abre com:{" "}
                <span className="font-medium text-foreground">
                  &quot;{previewPhrase}&quot;
                </span>
              </p>
              <p className="text-[10px]">
                Exemplos: você →{" "}
                <span className="font-mono">
                  /{initials}/{igreenId || "130392"}
                </span>
                ; outro consultor Maria Silva ID 998877 →{" "}
                <span className="font-mono">/ms/998877</span>
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={rendering}>
            Fechar
          </Button>
          <Button
            variant="outline"
            onClick={downloadPNG}
            disabled={rendering || !canDownload}
            className="gap-2"
          >
            {rendering ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Baixar PNG
          </Button>
          <Button
            onClick={downloadPDF}
            disabled={rendering || !canDownload}
            className="gap-2"
          >
            {rendering ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            Baixar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
