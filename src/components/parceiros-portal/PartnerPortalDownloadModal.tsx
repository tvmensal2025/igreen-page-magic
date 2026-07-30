import { useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import jsPDF from "jspdf";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, FileText, Loader2, QrCode } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useFlyerPreviewSize } from "@/components/admin/flyerPreviewSize";
import {
  clampFooterBand,
  drawFlyerFooter,
  previewFooterFontSize,
} from "@/components/admin/flyerFooter";
import { buildPartnerPublicShortLink } from "@/lib/partnerShortLink";
import { useToast } from "@/hooks/use-toast";

type FormatId = "a4" | "banner";

const TEMPLATES: Record<
  FormatId,
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
    canvasW: 1240,
    canvasH: 1754,
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

const PREVIEW_W = 320;
const PREVIEW_MAX_H = 440;
const QR_QUIET_PX = 2;
const QR_BORDER_PX = 1;

function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const noCountry = digits.startsWith("55") ? digits.slice(2) : digits;
  if (noCountry.length === 11) {
    return `+55 (${noCountry.slice(0, 2)}) ${noCountry.slice(2, 7)}-${noCountry.slice(7)}`;
  }
  if (noCountry.length === 10) {
    return `+55 (${noCountry.slice(0, 2)}) ${noCountry.slice(2, 6)}-${noCountry.slice(6)}`;
  }
  return phone || "";
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Falha ao carregar arte"));
    img.src = src;
  });
}

export type PortalDownloadTarget = {
  /** geral | local */
  kind: "geral" | "local";
  name: string;
  code?: string | null;
  keyword?: string | null;
};

interface Props {
  open: boolean;
  onClose: () => void;
  partnerName: string;
  shortCode: string;
  refLabel: string;
  consultantName: string;
  consultantIgreenId: string;
  consultantPhone: string;
  target: PortalDownloadTarget | null;
}

/**
 * Modal só-download no portal público do parceiro.
 * Calibração 1:1 com PartnerQrCode (A4 + Banner 504×904).
 */
export function PartnerPortalDownloadModal({
  open,
  onClose,
  partnerName,
  shortCode,
  refLabel,
  consultantName,
  consultantIgreenId,
  consultantPhone,
  target,
}: Props) {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [format, setFormat] = useState<FormatId>("a4");
  const [busy, setBusy] = useState<"png" | "pdf" | "both" | null>(null);
  const qrSvgRef = useRef<HTMLDivElement>(null);

  const template = TEMPLATES[format];
  const { width: previewW, height: previewH } = useFlyerPreviewSize(
    template.canvasW,
    template.canvasH,
    isMobile ? 240 : PREVIEW_W,
    isMobile ? 240 : PREVIEW_MAX_H,
  );

  const liveUrl = useMemo(() => {
    if (!refLabel || !shortCode || !target) return "";
    if (target.kind === "local" && target.code) {
      return buildPartnerPublicShortLink(refLabel, shortCode, {
        keyword: target.keyword || target.name,
        spot: target.code,
      });
    }
    return buildPartnerPublicShortLink(refLabel, shortCode);
  }, [refLabel, shortCode, target]);

  const qrCorePx = (template.qrSize / 100) * previewW;
  const qrFramePx = qrCorePx + QR_QUIET_PX * 2 + QR_BORDER_PX * 2;

  const footerLeft = consultantName
    ? `LICENCIADO: ${consultantName.toUpperCase()}${consultantIgreenId ? ` • ID ${consultantIgreenId}` : ""}`
    : "LICENCIADO: CONSULTOR IGREEN";
  const footerRight = consultantPhone
    ? `WHATSAPP: ${formatPhoneDisplay(consultantPhone)}`
    : "WHATSAPP: —";
  const { bandTop: footerTop, bandHeight: footerHPx } = clampFooterBand(
    previewH,
    template.footerY,
    template.footerH,
  );
  const footerFont = previewFooterFontSize(
    previewW,
    footerHPx,
    footerLeft,
    footerRight,
    "700",
  );

  const fileSlug = () => {
    const spot =
      target?.kind === "local"
        ? String(target.code || target.name || "local")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 40)
        : "geral";
    const partner = partnerName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    return `${format}-${partner || "parceiro"}-${spot}`;
  };

  const renderFormatToCanvas = async (
    formatId: FormatId,
  ): Promise<HTMLCanvasElement | null> => {
    const svgEl = qrSvgRef.current?.querySelector("svg");
    if (!svgEl || !liveUrl) return null;
    const t = TEMPLATES[formatId];
    const CW = t.canvasW;
    const CH = t.canvasH;
    const canvas = document.createElement("canvas");
    canvas.width = CW;
    canvas.height = CH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#0a3d2c";
    ctx.fillRect(0, 0, CW, CH);
    try {
      const bg = await loadImage(t.bg);
      drawImageCover(ctx, bg, 0, 0, CW, CH);
    } catch {
      /* keep green */
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
          (t.qrX / 100) * CW,
          (t.qrY / 100) * CH,
          (t.qrSize / 100) * CW,
        );
        resolve();
      };
      img.onerror = () => resolve();
      img.src = svgUrl;
    });
    drawFlyerFooter(ctx, {
      canvasW: CW,
      canvasH: CH,
      footerYPercent: t.footerY,
      footerHPercent: t.footerH,
      footerLeft,
      footerRight,
      bgColor: "#0d3b1f",
      textColor: "#fff200",
      fontFamily: 'Montserrat, "Arial Black", sans-serif',
      fontWeight: "700",
    });
    return canvas;
  };

  const downloadPngOf = async (formatId: FormatId) => {
    const canvas = await renderFormatToCanvas(formatId);
    if (!canvas) return false;
    const a = document.createElement("a");
    const spot =
      target?.kind === "local"
        ? String(target.code || target.name || "local")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 40)
        : "geral";
    const partner = partnerName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    a.download = `${formatId}-${partner || "parceiro"}-${spot}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
    return true;
  };

  const handleDownloadPng = async () => {
    setBusy("png");
    try {
      const ok = await downloadPngOf(format);
      if (ok) toast({ title: "PNG baixado!" });
      else toast({ title: "Não foi possível gerar o PNG", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadPdf = async () => {
    setBusy("pdf");
    try {
      const canvas = await renderFormatToCanvas(format);
      if (!canvas) {
        toast({ title: "Não foi possível gerar o PDF", variant: "destructive" });
        return;
      }
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
      pdf.save(`${fileSlug()}.pdf`);
      toast({ title: "PDF baixado!" });
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadBothPng = async () => {
    setBusy("both");
    try {
      const a4 = await downloadPngOf("a4");
      await new Promise((r) => setTimeout(r, 400));
      const ban = await downloadPngOf("banner");
      if (a4 && ban) toast({ title: "A4 e Banner (PNG) baixados!" });
      else if (a4 || ban) toast({ title: "Um dos arquivos foi baixado" });
      else toast({ title: "Falha ao gerar os PNGs", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const titleName = target?.name || partnerName;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100%-1rem)] max-w-lg max-h-[92dvh] overflow-y-auto p-3 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <QrCode className="h-5 w-5 text-primary" />
            Baixar · {titleName}
          </DialogTitle>
          <DialogDescription>
            Só download — Folha A4 e Banner 504×904. Sem editar frase.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-1">
          <div className="flex flex-wrap gap-1.5 justify-center">
            {(Object.keys(TEMPLATES) as FormatId[]).map((id) => (
              <Button
                key={id}
                type="button"
                size="sm"
                variant={format === id ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setFormat(id)}
                disabled={!!busy}
              >
                {TEMPLATES[id].label}
              </Button>
            ))}
          </div>

          <div
            className="relative max-w-full shrink-0 overflow-hidden rounded-xl border bg-primary shadow-sm"
            style={{ width: previewW, height: previewH }}
          >
            <div
              className="absolute inset-0 bg-cover bg-center bg-no-repeat"
              style={{ backgroundImage: `url(${template.bg})` }}
            />
            {liveUrl ? (
              <div
                ref={qrSvgRef}
                className="absolute z-[2] box-border select-none border border-neutral-900 bg-white"
                style={{
                  left: `calc(${template.qrX}% - ${qrFramePx / 2}px)`,
                  top: `calc(${template.qrY}% - ${qrFramePx / 2}px)`,
                  width: qrFramePx,
                  height: qrFramePx,
                  padding: QR_QUIET_PX,
                  borderWidth: QR_BORDER_PX,
                }}
              >
                <QRCodeSVG
                  value={liveUrl}
                  size={qrCorePx}
                  level="M"
                  includeMargin={false}
                  style={{ display: "block" }}
                />
              </div>
            ) : null}
            <div
              className="absolute left-0 right-0 z-[2] flex items-center justify-between overflow-hidden whitespace-nowrap bg-primary/95 px-2 py-0 leading-none select-none"
              style={{
                top: footerTop,
                height: footerHPx,
                minHeight: footerHPx,
                maxHeight: footerHPx,
                fontSize: footerFont,
                color: "#fff200",
                fontWeight: 700,
              }}
            >
              <span>{footerLeft}</span>
              <span className="shrink-0 pl-1">{footerRight}</span>
            </div>
          </div>

          <p className="max-w-[320px] break-all text-center font-mono text-[10px] text-muted-foreground">
            {liveUrl || "Link indisponível"}
          </p>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <div className="flex w-full flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              className="w-full gap-1.5"
              disabled={!liveUrl || !!busy}
              onClick={() => void handleDownloadPng()}
            >
              {busy === "png" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Baixar PNG
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full gap-1.5"
              disabled={!liveUrl || !!busy}
              onClick={() => void handleDownloadPdf()}
            >
              {busy === "pdf" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              Baixar PDF ({template.pdfWmm}×{template.pdfHmm}mm)
            </Button>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="w-full gap-1.5"
            disabled={!liveUrl || !!busy}
            onClick={() => void handleDownloadBothPng()}
          >
            {busy === "both" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Baixar os dois (PNG)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
