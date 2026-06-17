import { useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import jsPDF from "jspdf";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Download, Copy, FileText, Loader2 } from "lucide-react";

type Format = "a4" | "banner";

interface PanfletoModalProps {
  open: boolean;
  onClose: () => void;
  licenca: string;
  nomeConsultor: string;
  telefoneConsultor?: string;
  igreenId?: string;
  /** URL alvo do QR. Se ausente, usa o redirect padrão do panfleto. */
  shareUrl?: string;
  /** Título customizado do modal (ex.: "QR Code — Link pessoal"). */
  title?: string;
}

const SUPABASE_URL = "https://zlzasfhcxcznaprrragl.supabase.co";

// ============ Dimensões nativas (na proporção física EXATA do papel) ============
// A4 = 210×297mm (0,707) · Banner = 504×940mm (0,536). Manter a proporção do
// canvas igual à do papel garante impressão sem barra lateral e sem esticar o QR.
const A4_W = 905;
const A4_H = 1280;
const BANNER_W = 1008;
const BANNER_H = 1881;

// ============ Templates (defaults em % do canvas — TRAVADOS) ============
type TemplateCfg = {
  bg: string;
  canvasW: number;
  canvasH: number;
  pdfWmm: number;
  pdfHmm: number;
  qrX: number; // centro X em %
  qrY: number; // centro Y em %
  qrSize: number; // % da largura
  footerY: number; // centro Y em %
  footerH: number; // altura em % da altura
};

const TEMPLATES: Record<Format, TemplateCfg> = {
  a4: {
    bg: "/images/mutirao-lei-14300-base.jpg",
    canvasW: A4_W,
    canvasH: A4_H,
    pdfWmm: 210,
    pdfHmm: 297,
    qrX: 25,
    qrY: 91,
    qrSize: 18,
    footerY: 99,
    footerH: 3,
  },
  banner: {
    bg: "/images/banner-lei-14300-base.jpg",
    canvasW: BANNER_W,
    canvasH: BANNER_H,
    pdfWmm: 504,
    pdfHmm: 940,
    qrX: 19.9,
    qrY: 87.3,
    qrSize: 30,
    footerY: 98.7,
    footerH: 2.65,
  },
};

const PREVIEW_W = 380;
// Altura máxima do preview para caber numa tela de notebook sem scroll.
// O Banner 504×940mm é alto e, calculado só pela largura, estouraria a tela;
// então reduzimos proporcionalmente até esse teto.
const PREVIEW_MAX_H = 440;

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
  x: number, y: number, w: number, h: number,
) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function PanfletoModal({
  open,
  onClose,
  licenca,
  nomeConsultor,
  telefoneConsultor = "",
  igreenId = "",
  shareUrl,
  title,
}: PanfletoModalProps) {
  const [format, setFormat] = useState<Format>("a4");
  const template = TEMPLATES[format];

  const qrSvgWrapperRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const redirectUrl =
    shareUrl ?? `${SUPABASE_URL}/functions/v1/qr-redirect?l=${encodeURIComponent(licenca)}`;

  // Posições TRAVADAS nos defaults do template
  const effQrX = template.qrX;
  const effQrY = template.qrY;
  const effQrSize = template.qrSize;
  const effFooterY = template.footerY;

  const previewAspect = template.canvasH / template.canvasW;
  let previewW = PREVIEW_W;
  let previewH = PREVIEW_W * previewAspect;
  if (previewH > PREVIEW_MAX_H) {
    previewH = PREVIEW_MAX_H;
    previewW = previewH / previewAspect;
  }
  const PREVIEW_W_EFF = Math.round(previewW);
  const PREVIEW_H = Math.round(previewH);

  const qrCorePxPreview = (effQrSize / 100) * PREVIEW_W_EFF;
  const qrPadPreview = qrCorePxPreview * 0.06;
  const qrCardPxPreview = qrCorePxPreview + qrPadPreview * 2;
  const footerHPreview = Math.max(14, PREVIEW_H * (template.footerH / 100));
  const footerFontPreview = Math.max(7, Math.round(footerHPreview * 0.36));

  const nomeUpper = (nomeConsultor || "CONSULTOR IGREEN").toUpperCase();
  const idLabel = igreenId ? ` • ID ${igreenId}` : "";
  const phoneFmt = formatBrPhone(telefoneConsultor) || "FALE COMIGO";
  const footerLeft = `LICENCIADO: ${nomeUpper}${idLabel}`;
  const footerRight = `WHATSAPP: +55 ${phoneFmt}`;

  const [rendering, setRendering] = useState(false);

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
      console.warn("[panfleto] bg load failed", e);
    }

    const svgData = new XMLSerializer().serializeToString(svgEl);
    const svgUrl = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const qrPx = (effQrSize / 100) * CW;
        const cx = (effQrX / 100) * CW;
        const cy = (effQrY / 100) * CH;
        const dx = cx - qrPx / 2;
        const dy = cy - qrPx / 2;
        const pad = qrPx * 0.06;
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = 16;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = "#d4a017";
        roundRect(ctx, dx - pad - 4, dy - pad - 4, qrPx + pad * 2 + 8, qrPx + pad * 2 + 8, qrPx * 0.05);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = "#ffffff";
        roundRect(ctx, dx - pad, dy - pad, qrPx + pad * 2, qrPx + pad * 2, qrPx * 0.04);
        ctx.fill();
        ctx.drawImage(img, dx, dy, qrPx, qrPx);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = svgUrl;
    });

    const bandHeight = CH * (template.footerH / 100);
    const bandY = (effFooterY / 100) * CH - bandHeight / 2;
    ctx.fillStyle = "#0d3b1f";
    ctx.fillRect(0, bandY, CW, bandHeight);
    ctx.fillStyle = "#d4a017";
    ctx.fillRect(0, bandY, CW, Math.max(2, bandHeight * 0.05));
    ctx.fillRect(0, bandY + bandHeight - Math.max(2, bandHeight * 0.05), CW, Math.max(2, bandHeight * 0.05));

    ctx.fillStyle = "#ffd700";
    ctx.textBaseline = "middle";
    const cyText = bandY + bandHeight / 2;
    const sidePad = CW * 0.025;
    const gap = CW * 0.02;
    const available = CW - sidePad * 2 - gap;
    let fSize = Math.round(bandHeight * 0.42);
    while (fSize > 8) {
      ctx.font = `900 ${fSize}px Montserrat, "Arial Black", sans-serif`;
      const wL = ctx.measureText(footerLeft).width;
      const wR = ctx.measureText(footerRight).width;
      if (wL + wR <= available) break;
      fSize -= 1;
    }
    ctx.font = `900 ${fSize}px Montserrat, "Arial Black", sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(footerLeft, sidePad, cyText);
    ctx.textAlign = "right";
    ctx.fillText(footerRight, CW - sidePad, cyText);

    return canvas;
  };

  const downloadPNG = async () => {
    setRendering(true);
    try {
      const canvas = await renderToCanvas();
      if (!canvas) return;
      const link = document.createElement("a");
      link.download = `${format === "a4" ? "panfleto-a4" : "banner-504x940"}-igreen-${licenca}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast({ title: "✅ PNG baixado!" });
    } finally {
      setRendering(false);
    }
  };

  const downloadPDF = async () => {
    setRendering(true);
    try {
      const canvas = await renderToCanvas();
      if (!canvas) return;
      const { pdfWmm: wmm, pdfHmm: hmm } = template;
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: [wmm, hmm] });
      // O canvas já está na proporção física EXATA do papel, então a arte
      // preenche a página inteira sem esticar e sem barra verde nas laterais.
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      pdf.addImage(imgData, "JPEG", 0, 0, wmm, hmm);
      const name = format === "a4" ? "panfleto-a4-210x297" : "banner-504x940";
      pdf.save(`${name}-igreen-${licenca}.pdf`);
      toast({ title: "✅ PDF baixado!" });
    } finally {
      setRendering(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(redirectUrl);
    toast({ title: "✅ Link copiado!" });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <FileText className="w-5 h-5 text-primary" /> {title ?? "Arte Mutirão Lei 14.300"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[auto_1fr] py-2">
          {/* Preview */}
          <div className="flex flex-col items-center gap-3">
            <div
              className="relative overflow-hidden rounded-xl border bg-primary shadow-sm"
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
                className="absolute select-none bg-white rounded-md shadow-md ring-2 ring-[#d4a017]"
                style={{
                  left: `calc(${effQrX}% - ${qrCardPxPreview / 2}px)`,
                  top: `calc(${effQrY}% - ${qrCardPxPreview / 2}px)`,
                  width: qrCardPxPreview,
                  height: qrCardPxPreview,
                  padding: qrPadPreview,
                }}
              >
                <QRCodeSVG
                  value={redirectUrl}
                  size={qrCorePxPreview}
                  level="H"
                  style={{ display: "block" }}
                />
              </div>

              <div
                className="absolute left-0 right-0 select-none flex items-center justify-between leading-tight px-2"
                style={{
                  top: `calc(${effFooterY}% - ${footerHPreview / 2}px)`,
                  height: footerHPreview,
                  fontSize: footerFontPreview,
                  color: "#ffd700",
                  fontWeight: 900,
                  background: "#0d3b1f",
                  borderTop: "2px solid #d4a017",
                  borderBottom: "2px solid #d4a017",
                }}
              >
                <span className="whitespace-nowrap overflow-hidden text-ellipsis">{footerLeft}</span>
                <span className="whitespace-nowrap pl-2">{footerRight}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center max-w-[320px]">
              Layout travado — bate 1:1 com a impressão.
            </p>
          </div>

          {/* Controles */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label className="text-sm">Formato</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={format === "a4" ? "default" : "outline"}
                  onClick={() => setFormat("a4")}
                >
                  Sulfite A4
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={format === "banner" ? "default" : "outline"}
                  onClick={() => setFormat("banner")}
                >
                  Banner 504×940mm
                </Button>
              </div>
            </div>

            <div className="text-xs text-muted-foreground space-y-1 mt-1">
              <p className="opacity-80">Link do QR:</p>
              <p className="break-all opacity-70">{redirectUrl}</p>
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-wrap gap-2 sm:justify-end">
          <Button variant="outline" onClick={copyLink} className="gap-2">
            <Copy className="w-4 h-4" /> Copiar link
          </Button>
          <Button variant="outline" onClick={downloadPNG} disabled={rendering} className="gap-2">
            {rendering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Baixar PNG
          </Button>
          <Button onClick={downloadPDF} disabled={rendering} className="gap-2">
            {rendering ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Baixar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
