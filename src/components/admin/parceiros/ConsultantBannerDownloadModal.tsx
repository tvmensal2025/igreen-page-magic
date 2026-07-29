import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
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
import {
  drawFlyerFooter,
  clampFooterBand,
  previewFooterFontSize,
} from "@/components/admin/flyerFooter";
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
} from "lucide-react";
import { useFlyerPreviewSize } from "@/components/admin/flyerPreviewSize";
import { useIsMobile } from "@/hooks/use-mobile";

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

type Format = "a4" | "banner";

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
  spots: BannerSpot[];
  onSpotsChanged: () => void;
}

const TEMPLATES: Record<
  Format,
  {
    bg: string;
    canvasW: number;
    canvasH: number;
    pdfWmm: number;
    pdfHmm: number;
    qrX: number;
    qrY: number;
    qrSize: number;
    footerY: number;
    footerH: number;
  }
> = {
  a4: {
    bg: "/images/banner-a4.jpg",
    canvasW: 905,
    canvasH: 1280,
    pdfWmm: 210,
    pdfHmm: 297,
    qrX: 25,
    qrY: 91,
    qrSize: 16,
    footerY: 99,
    footerH: 2.6,
  },
  banner: {
    bg: "/images/banner-504x904.jpg",
    canvasW: 1008,
    canvasH: 1808,
    pdfWmm: 504,
    pdfHmm: 904,
    qrX: 15,
    qrY: 89,
    qrSize: 23,
    footerY: 100,
    footerH: 3,
  },
};

const PREVIEW_W = 380;
const PREVIEW_MAX_H = 440;
const QR_QUIET_PX = 2;
const QR_BORDER_PX = 1;

function formatBrPhone(raw?: string): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  if (local.length < 10) return raw;
  const ddd = local.slice(0, 2);
  const rest = local.slice(2);
  if (rest.length === 9) return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
  return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function drawQrWithThinFrame(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  cy: number,
  qrPx: number,
) {
  const quiet = Math.max(4, Math.round(qrPx * 0.012));
  const border = Math.max(2, Math.round(qrPx * 0.004));
  const dx = cx - qrPx / 2;
  const dy = cy - qrPx / 2;
  const outerX = dx - quiet;
  const outerY = dy - quiet;
  const outerW = qrPx + quiet * 2;
  const outerH = qrPx + quiet * 2;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(outerX, outerY, outerW, outerH);
  ctx.drawImage(img, dx, dy, qrPx, qrPx);
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = border;
  ctx.strokeRect(
    outerX + border / 2,
    outerY + border / 2,
    outerW - border,
    outerH - border,
  );
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
}: Props) {
  const { toast } = useToast();
  const qrSvgWrapperRef = useRef<HTMLDivElement>(null);

  const [format, setFormat] = useState<Format>("a4");
  const [mode, setMode] = useState<"root" | "spot">("spot");
  const [selectedSpotId, setSelectedSpotId] = useState<string>("");
  const [newKeyword, setNewKeyword] = useState("");
  const [newCode, setNewCode] = useState("");
  const [editPhrase, setEditPhrase] = useState("");
  const [rootPhrase, setRootPhrase] = useState("");
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = TEMPLATES[format];
  const initials = useMemo(
    () => buildConsultantBannerInitials(consultantName),
    [consultantName],
  );
  const igreenId = String(consultantIgreenId || "").replace(/\D/g, "");

  const selectedSpot =
    spots.find((s) => s.id === selectedSpotId) || spots[0] || null;

  useEffect(() => {
    if (!open) return;
    setFormat("a4");
    setMode(spots.length > 0 ? "spot" : "spot");
    setSelectedSpotId(spots[0]?.id || "");
    setNewKeyword("");
    setNewCode("");
    setError(null);
    setRootPhrase(defaultPhrase || "");
    if (spots[0]) {
      setEditPhrase(spots[0].phrase || buildDefaultQrPhrase(spots[0].keyword));
    }
  }, [open, spots, defaultPhrase]);

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

  const syncBannerKeywords = useCallback(
    async (extraKeyword?: string) => {
      const fromSpots = spots.map((s) => s.keyword.trim()).filter(Boolean);
      const next = Array.from(
        new Set(
          [...fromSpots, extraKeyword?.trim()].filter(Boolean) as string[],
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
      setError("Informe a palavra-chave do local.");
      return;
    }
    if (isGenericKeyword(kw)) {
      setError("Palavra-chave genérica demais. Use o nome do local.");
      return;
    }
    const code =
      slugifyBannerSpotCode(newCode || kw) ||
      slugifyBannerSpotCode(kw);
    if (!code) {
      setError("Código do local inválido.");
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

  const isMobile = useIsMobile();
  const { width: PREVIEW_W_EFF, height: PREVIEW_H } = useFlyerPreviewSize(
    template.canvasW,
    template.canvasH,
    isMobile ? 240 : PREVIEW_W,
    isMobile ? 240 : PREVIEW_MAX_H,
  );

  const qrCorePxPreview = (template.qrSize / 100) * PREVIEW_W_EFF;
  const qrFramePxPreview =
    qrCorePxPreview + QR_QUIET_PX * 2 + QR_BORDER_PX * 2;
  const nomeUpper = (consultantName || "CONSULTOR IGREEN").toUpperCase();
  const idLabel = igreenId ? ` • ID ${igreenId}` : "";
  const phoneFmt = formatBrPhone(consultantPhone) || "FALE COMIGO";
  const footerLeft = `LICENCIADO: ${nomeUpper}${idLabel}`;
  const footerRight = `WHATSAPP: +55 ${phoneFmt}`;
  const { bandTop: footerTopPreview, bandHeight: footerHPreview } =
    clampFooterBand(PREVIEW_H, template.footerY, template.footerH);
  const footerFontPreview = previewFooterFontSize(
    PREVIEW_W_EFF,
    footerHPreview,
    footerLeft,
    footerRight,
    "900",
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
      const bg = await loadImage(template.bg);
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
            <FileText className="w-5 h-5 text-primary" /> Meu Banner (vivo)
            <HelpHint
              size={14}
              title="Banner vivo do consultor"
              summary="Frase no banco — muda sem reimprimir"
              details={
                "O QR aponta para igreen.cloud/{suas iniciais}/{seu ID}.\n\n" +
                "A frase fica salva no sistema. Edite e salve aqui — banners já impressos usam a frase nova no próximo scan.\n\n" +
                "Se trocar o WhatsApp conectado, o mesmo QR continua válido (vai para o número novo)."
              }
              example="Rafael Ferreira Dias → igreen.cloud/rfd/130392"
            />
          </DialogTitle>
          <DialogDescription>
            QR permanente:{" "}
            <span className="font-mono text-foreground">
              igreen.cloud/{initials}/{igreenId || "SEU_ID"}
            </span>
            . Toque no <span className="font-semibold">?</span> para ver como
            mudar a frase sem reimprimir.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:gap-6 md:grid-cols-[auto_1fr] py-2 min-w-0">
          <div className="flex flex-col items-center gap-3 w-full min-w-0 max-w-full">
            <div
              className="relative overflow-hidden rounded-xl border bg-primary shadow-sm max-w-full shrink-0"
              style={{
                width: PREVIEW_W_EFF,
                height: PREVIEW_H,
                backgroundImage: `url(${template.bg})`,
                backgroundSize: "cover",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "center",
              }}
            >
              <div
                ref={qrSvgWrapperRef}
                className="absolute select-none bg-white box-border border border-neutral-900"
                style={{
                  left: `calc(${template.qrX}% - ${qrFramePxPreview / 2}px)`,
                  top: `calc(${template.qrY}% - ${qrFramePxPreview / 2}px)`,
                  width: qrFramePxPreview,
                  height: qrFramePxPreview,
                  padding: QR_QUIET_PX,
                  borderWidth: QR_BORDER_PX,
                }}
              >
                <QRCodeSVG
                  value={qrUrl}
                  size={qrCorePxPreview}
                  level="H"
                  includeMargin={false}
                  style={{ display: "block" }}
                />
              </div>
              <div
                className="absolute left-0 right-0 select-none leading-none px-2 py-0 flex items-center justify-between overflow-hidden whitespace-nowrap"
                style={{
                  top: footerTopPreview,
                  height: footerHPreview,
                  minHeight: footerHPreview,
                  maxHeight: footerHPreview,
                  fontSize: footerFontPreview,
                  color: "#ffd700",
                  fontWeight: 900,
                  background: "#0d3b1f",
                }}
              >
                <span>{footerLeft}</span>
                <span className="shrink-0 pl-1">{footerRight}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center max-w-[320px] flex items-center gap-1.5 justify-center">
              <Wifi className="h-3.5 w-3.5" />
              WhatsApp = número conectado agora (Whapi)
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
              <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Store className="h-3.5 w-3.5 text-primary" />
                  <Label className="text-sm">Locais cadastrados</Label>
                </div>
                {spots.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {spots.map((s) => (
                      <Button
                        key={s.id}
                        type="button"
                        size="sm"
                        className="h-7 text-xs"
                        variant={
                          selectedSpot?.id === s.id ? "default" : "outline"
                        }
                        onClick={() => setSelectedSpotId(s.id)}
                      >
                        {s.keyword}
                        <span className="opacity-60 ml-1">/{s.code}</span>
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Nenhum local ainda. Crie o primeiro abaixo.
                  </p>
                )}

                <div className="grid gap-2 sm:grid-cols-2 pt-1">
                  <div>
                    <Label className="text-[11px]">Nome do local</Label>
                    <Input
                      value={newKeyword}
                      onChange={(e) => {
                        setNewKeyword(e.target.value);
                        if (!newCode) {
                          setNewCode(slugifyBannerSpotCode(e.target.value));
                        }
                      }}
                      placeholder="Ex.: Posto Shell Centro"
                      className="h-8 text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Esse nome aparece para você identificar de onde veio o lead.
                    </p>
                  </div>
                  <div>
                    <Label className="text-[11px]">
                      Código fixo na URL (não mude depois de imprimir)
                    </Label>
                    <Input
                      value={newCode}
                      onChange={(e) =>
                        setNewCode(slugifyBannerSpotCode(e.target.value))
                      }
                      placeholder="posto-shell-centro"
                      className="h-8 text-xs font-mono"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      É o endereço do QR. Impresso uma vez, não muda mais.
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
                    "Criar local e liberar QR"
                  )}
                </Button>

                {selectedSpot && (
                  <div className="space-y-1.5 pt-2 border-t border-border/40">
                    <Label className="text-[11px] flex items-center gap-1">
                      <Pencil className="h-3 w-3" />
                      Frase deste local (viva no Supabase)
                    </Label>
                    <Textarea
                      value={editPhrase}
                      onChange={(e) => setEditPhrase(e.target.value)}
                      rows={3}
                      className="text-xs resize-none"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Mensagem que aparece no WhatsApp do cliente ao escanear.
                      Pode editar depois sem reimprimir.
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
              </div>
            ) : (
              <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/30 p-3">
                <Label className="text-sm">Frase do banner geral</Label>
                <p className="text-[11px] text-muted-foreground">
                  Link: /{initials}/{igreenId} — sem código de local.
                </p>
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
                >
                  Salvar frase padrão
                </Button>
              </div>
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
