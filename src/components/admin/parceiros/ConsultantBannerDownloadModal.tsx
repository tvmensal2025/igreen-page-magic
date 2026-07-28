import { useEffect, useMemo, useRef, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  drawFlyerFooter,
  clampFooterBand,
  previewFooterFontSize,
} from "@/components/admin/flyerFooter";
import { Download, FileText, Loader2, MapPin, Wifi } from "lucide-react";
import { useFlyerPreviewSize } from "@/components/admin/flyerPreviewSize";
import { useToast } from "@/hooks/use-toast";
import { PUBLIC_PARTNER_BASE } from "@/lib/partnerShortLink";
import {
  buildDefaultQrPhrase,
  resolveQrMessage,
  isGenericKeyword,
  QR_PHRASE_MAX,
} from "./qrPhrase";

type Format = "a4" | "banner";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Licença ou igreen_id — segmento do link /r/{ref}. Preferir igreen_id. */
  licenseOrIgreenId: string;
  consultantName?: string;
  consultantIgreenId?: string;
  /** Telefone exibido no rodapé (Whapi conectado preferencial). */
  consultantPhone: string;
  /** Keywords já salvas em consultants.banner_keywords. */
  savedKeywords?: string[];
  /** Persiste keyword no consultor (não em parceiro). */
  onSaveKeyword: (keyword: string) => Promise<void>;
}

const TEMPLATES: Record<
  Format,
  {
    label: string;
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
    label: "Folha A4",
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
    label: "Banner 504×904mm",
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
 * Banner do CONSULTOR (arte oficial A4/Banner).
 * QR aponta para /r/{igreen_id|licença} → Whapi/instância conectada.
 * Palavra-chave grava em consultants.banner_keywords (não em parceiro).
 */
export function ConsultantBannerDownloadModal({
  open,
  onClose,
  licenseOrIgreenId,
  consultantName = "",
  consultantIgreenId = "",
  consultantPhone,
  savedKeywords = [],
  onSaveKeyword,
}: Props) {
  const { toast } = useToast();
  const qrSvgWrapperRef = useRef<HTMLDivElement>(null);

  const [format, setFormat] = useState<Format>("a4");
  const [locationKeyword, setLocationKeyword] = useState("");
  const [saveKeyword, setSaveKeyword] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [keywordError, setKeywordError] = useState<string | null>(null);

  const template = TEMPLATES[format];
  const keyword = locationKeyword.trim();

  useEffect(() => {
    if (!open) return;
    setFormat("a4");
    setLocationKeyword("");
    setSaveKeyword(true);
    setKeywordError(null);
  }, [open]);

  const phrase = useMemo(() => {
    if (!keyword) {
      return buildDefaultQrPhrase("").slice(0, QR_PHRASE_MAX);
    }
    return resolveQrMessage(null, keyword, null);
  }, [keyword]);

  const ref =
    (consultantIgreenId || "").trim() ||
    (licenseOrIgreenId || "").trim();

  const qrUrl = useMemo(() => {
    if (!ref) return "https://igreen.cloud";
    const u = new URL(`${PUBLIC_PARTNER_BASE}/r/${encodeURIComponent(ref)}`);
    if (phrase) u.searchParams.set("msg", phrase.slice(0, 200));
    if (keyword) u.searchParams.set("k", keyword);
    return u.toString();
  }, [ref, phrase, keyword]);

  const { width: PREVIEW_W_EFF, height: PREVIEW_H } = useFlyerPreviewSize(
    template.canvasW,
    template.canvasH,
    PREVIEW_W,
    PREVIEW_MAX_H,
  );

  const qrCorePxPreview = (template.qrSize / 100) * PREVIEW_W_EFF;
  const qrFramePxPreview =
    qrCorePxPreview + QR_QUIET_PX * 2 + QR_BORDER_PX * 2;

  const nomeUpper = (consultantName || "CONSULTOR IGREEN").toUpperCase();
  const idLabel = consultantIgreenId ? ` • ID ${consultantIgreenId}` : "";
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

  const validateKeyword = (): boolean => {
    if (!keyword) {
      setKeywordError("Informe a palavra-chave deste local / banner.");
      return false;
    }
    if (isGenericKeyword(keyword)) {
      setKeywordError(
        "Muito genérica. Use algo do local (ex.: Posto Shell Centro).",
      );
      return false;
    }
    setKeywordError(null);
    return true;
  };

  const ensureKeywordSaved = async (): Promise<boolean> => {
    if (!validateKeyword()) return false;
    if (!saveKeyword) return true;
    const already = savedKeywords.some(
      (k) => k.trim().toLowerCase() === keyword.toLowerCase(),
    );
    if (already) return true;
    try {
      await onSaveKeyword(keyword);
      toast({
        title: "Palavra-chave salva no seu ID",
        description: `"${keyword}" — leads com essa frase aparecem no rastreio do seu banner.`,
      });
      return true;
    } catch (err: unknown) {
      toast({
        title: "Não foi possível salvar a palavra-chave",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
      return false;
    }
  };

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
    } catch (e) {
      console.warn("[consultant-banner] bg load failed", e);
    }

    const svgData = new XMLSerializer().serializeToString(svgEl);
    const svgUrl =
      "data:image/svg+xml;base64," +
      btoa(unescape(encodeURIComponent(svgData)));
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const qrPx = (template.qrSize / 100) * CW;
        const cx = (template.qrX / 100) * CW;
        const cy = (template.qrY / 100) * CH;
        drawQrWithThinFrame(ctx, img, cx, cy, qrPx);
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
    const idSlug = slugify(consultantIgreenId || licenseOrIgreenId || "consultor");
    const kwSlug = slugify(keyword || "local");
    return `${format === "a4" ? "panfleto-a4" : "banner-504x904"}-${idSlug}-${kwSlug}`;
  };

  const downloadPNG = async () => {
    setRendering(true);
    try {
      if (!(await ensureKeywordSaved())) return;
      const canvas = await renderToCanvas();
      if (!canvas) return;
      const link = document.createElement("a");
      link.download = `${fileBase()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast({ title: "PNG baixado!" });
    } finally {
      setRendering(false);
    }
  };

  const downloadPDF = async () => {
    setRendering(true);
    try {
      if (!(await ensureKeywordSaved())) return;
      const canvas = await renderToCanvas();
      if (!canvas) return;
      const { pdfWmm: wmm, pdfHmm: hmm } = template;
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: [wmm, hmm],
      });
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, wmm, hmm);
      pdf.save(`${fileBase()}.pdf`);
      toast({ title: "PDF baixado!" });
    } finally {
      setRendering(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100%-1rem)] sm:w-full max-w-4xl max-h-[95dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <FileText className="w-5 h-5 text-primary" /> Meu Banner
          </DialogTitle>
          <DialogDescription>
            Arte do consultor (seu ID). O QR abre o WhatsApp da instância
            conectada (Whapi). Cada local pode ter uma palavra-chave sua.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[auto_1fr] py-2 min-w-0">
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
              WhatsApp do QR = número conectado (Whapi / instância)
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
                  Folha A4 (210×297mm)
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

            <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/30 p-3">
              <Label className="text-sm flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                Palavra-chave deste local (seu ID)
              </Label>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Ex.: &quot;Mercado Central&quot;, &quot;Posto BR Centro&quot;.
                Quantas quiser — cada banner um local. Não é de parceiro.
              </p>
              <Input
                value={locationKeyword}
                onChange={(e) => {
                  setLocationKeyword(e.target.value);
                  if (keywordError) setKeywordError(null);
                }}
                placeholder="Nome do local ou ponto de divulgação"
                className="h-9"
              />
              {keywordError && (
                <p className="text-[11px] text-destructive">{keywordError}</p>
              )}
              {savedKeywords.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {savedKeywords.map((kw) => (
                    <button
                      key={kw}
                      type="button"
                      onClick={() => {
                        setLocationKeyword(kw);
                        setKeywordError(null);
                      }}
                      className="text-[11px] rounded-full border border-border bg-background px-2 py-0.5 hover:bg-muted"
                    >
                      {kw}
                    </button>
                  ))}
                </div>
              )}
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer mt-1">
                <input
                  type="checkbox"
                  checked={saveKeyword}
                  onChange={(e) => setSaveKeyword(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-input"
                />
                Salvar no meu ID ao baixar (para rastrear o local)
              </label>
            </div>

            <div className="text-xs text-muted-foreground space-y-1 rounded-md border border-border/40 bg-card/50 p-2.5">
              <p>
                WhatsApp abre com:{" "}
                <span className="font-medium text-foreground">
                  &quot;{phrase}&quot;
                </span>
              </p>
              <p className="text-[10px] break-all opacity-70">{qrUrl}</p>
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
            disabled={rendering || !ref}
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
            disabled={rendering || !ref}
            className="gap-2"
          >
            {rendering ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            Baixar PDF ({template.pdfWmm}×{template.pdfHmm}mm)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
