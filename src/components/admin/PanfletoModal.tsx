import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import jsPDF from "jspdf";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { Download, Copy, FileText, Loader2, Lock, Unlock } from "lucide-react";

type Format = "a4" | "banner";

interface PanfletoModalProps {
  open: boolean;
  onClose: () => void;
  licenca: string;
  nomeConsultor: string;
  telefoneConsultor?: string;
  igreenId?: string;
}

const SUPABASE_URL = "https://zlzasfhcxcznaprrragl.supabase.co";

// ============ Dimensões nativas ============
const A4_W = 853;
const A4_H = 1280;
const BANNER_W = 1008;
const BANNER_H = 1808;

// ============ Templates (defaults em % do canvas) ============
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
}: PanfletoModalProps) {
  const [format, setFormat] = useState<Format>("a4");
  const template = TEMPLATES[format];

  const [qrX, setQrX] = useState(template.qrX);
  const [qrY, setQrY] = useState(template.qrY);
  const [qrSize, setQrSize] = useState(template.qrSize);
  const [footerY, setFooterY] = useState(template.footerY);
  const [unlockedMap, setUnlockedMap] = useState<Record<Format, boolean>>({ a4: false, banner: false });
  const locked = !unlockedMap[format];

  const draggingRef = useRef<null | "qr" | "footer">(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const qrSvgWrapperRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const redirectUrl = `${SUPABASE_URL}/functions/v1/qr-redirect?l=${encodeURIComponent(licenca)}`;

  // Reset posições ao abrir ou trocar formato
  useEffect(() => {
    if (!open) return;
    const t = TEMPLATES[format];
    setQrX(t.qrX);
    setQrY(t.qrY);
    setQrSize(t.qrSize);
    setFooterY(t.footerY);
  }, [open, format]);

  const effQrX = locked ? template.qrX : qrX;
  const effQrY = locked ? template.qrY : qrY;
  const effQrSize = locked ? template.qrSize : qrSize;
  const effFooterY = locked ? template.footerY : footerY;

  const setLocked = (v: boolean) => {
    setUnlockedMap((m) => ({ ...m, [format]: !v }));
    if (v) {
      setQrX(template.qrX);
      setQrY(template.qrY);
      setQrSize(template.qrSize);
      setFooterY(template.footerY);
    }
  };

  const updatePosFromClient = useCallback(
    (clientX: number, clientY: number, what: "qr" | "footer") => {
      const el = previewRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const yPct = ((clientY - rect.top) / rect.height) * 100;
      const xPct = ((clientX - rect.left) / rect.width) * 100;
      const cy = Math.max(0, Math.min(100, yPct));
      const cx = Math.max(0, Math.min(100, xPct));
      if (what === "qr") {
        setQrX(cx);
        setQrY(cy);
      } else {
        setFooterY(cy);
      }
    },
    [],
  );

  const handlePointerDown =
    (what: "qr" | "footer") => (e: React.PointerEvent<HTMLDivElement>) => {
      if (locked) return;
      e.stopPropagation();
      draggingRef.current = what;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      updatePosFromClient(e.clientX, e.clientY, what);
    };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    updatePosFromClient(e.clientX, e.clientY, draggingRef.current);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const previewAspect = template.canvasH / template.canvasW;
  const PREVIEW_H = Math.round(PREVIEW_W * previewAspect);

  const qrCorePxPreview = (effQrSize / 100) * PREVIEW_W;
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

    // Fundo verde caso a arte não cubra
    ctx.fillStyle = "#0a3d2c";
    ctx.fillRect(0, 0, CW, CH);

    // Background
    try {
      const bg = await loadImage(template.bg);
      drawImageCover(ctx, bg, 0, 0, CW, CH);
    } catch (e) {
      console.warn("[panfleto] bg load failed", e);
    }

    // QR
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
        // Borda dourada
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = 16;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = "#d4a017";
        roundRect(ctx, dx - pad - 4, dy - pad - 4, qrPx + pad * 2 + 8, qrPx + pad * 2 + 8, qrPx * 0.05);
        ctx.fill();
        ctx.restore();
        // Cartão branco
        ctx.fillStyle = "#ffffff";
        roundRect(ctx, dx - pad, dy - pad, qrPx + pad * 2, qrPx + pad * 2, qrPx * 0.04);
        ctx.fill();
        ctx.drawImage(img, dx, dy, qrPx, qrPx);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = svgUrl;
    });

    // Faixa
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
      pdf.setFillColor("#0d3b1f");
      pdf.rect(0, 0, wmm, hmm, "F");
      const cw = canvas.width;
      const ch = canvas.height;
      const scale = Math.min(wmm / cw, hmm / ch);
      const drawW = cw * scale;
      const drawH = ch * scale;
      const dx = (wmm - drawW) / 2;
      const dy = (hmm - drawH) / 2;
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      pdf.addImage(imgData, "JPEG", dx, dy, drawW, drawH);
      const name = format === "a4" ? "panfleto-a4-210x297" : "banner-504x940";
      pdf.save(`${name}-igreen-${licenca}.pdf`);
      toast({ title: "✅ PDF baixado!" });
    } finally {
      setRendering(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(redirectUrl);
    toast({ title: "✅ Link do redirect copiado!" });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <FileText className="w-5 h-5 text-primary" /> Arte Mutirão Lei 14.300
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[auto_1fr] py-2">
          {/* Preview */}
          <div className="flex flex-col items-center gap-3">
            <div
              ref={previewRef}
              role="application"
              aria-label="Editor do panfleto. Destrave para arrastar o QR e a faixa."
              className="relative overflow-hidden rounded-xl border bg-emerald-900 shadow-sm"
              style={{
                width: PREVIEW_W,
                height: PREVIEW_H,
                backgroundImage: `url(${template.bg})`,
                backgroundSize: "cover",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "center",
              }}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              {/* QR draggable */}
              <div
                ref={qrSvgWrapperRef}
                onPointerDown={handlePointerDown("qr")}
                className={`absolute select-none touch-none bg-white rounded-md shadow-md ring-2 ring-[#d4a017] ${locked ? "cursor-not-allowed" : "cursor-move"}`}
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

              {/* Footer band draggable */}
              <div
                onPointerDown={handlePointerDown("footer")}
                className={`absolute left-0 right-0 select-none touch-none flex items-center justify-between leading-tight px-2 ${locked ? "cursor-not-allowed" : "cursor-row-resize"}`}
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
              {locked
                ? "Layout travado — bate 1:1 com a impressão."
                : "Arraste o QR ou a faixa. Use os sliders para ajuste fino."}
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
                  Banner 504×904mm
                </Button>
              </div>
              <button
                type="button"
                onClick={() => setLocked(!locked)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 hover:bg-muted border border-border rounded-md px-2 py-1.5 mt-1 transition-colors w-full text-left"
              >
                {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5 text-emerald-500" />}
                {locked
                  ? "Layout travado — clique para destravar e ajustar"
                  : "Layout destravado — clique para travar de novo"}
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-sm">Posição do QR (vertical)</Label>
                <span className="text-xs text-muted-foreground tabular-nums">{Math.round(effQrY)}%</span>
              </div>
              <Slider value={[effQrY]} onValueChange={([v]) => setQrY(v)} min={0} max={100} step={0.5} disabled={locked} />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-sm">Posição do QR (horizontal)</Label>
                <span className="text-xs text-muted-foreground tabular-nums">{Math.round(effQrX)}%</span>
              </div>
              <Slider value={[effQrX]} onValueChange={([v]) => setQrX(v)} min={0} max={100} step={0.5} disabled={locked} />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-sm">Tamanho do QR</Label>
                <span className="text-xs text-muted-foreground tabular-nums">{Math.round(effQrSize)}%</span>
              </div>
              <Slider value={[effQrSize]} onValueChange={([v]) => setQrSize(v)} min={8} max={45} step={0.5} disabled={locked} />
            </div>

            <div className="space-y-1.5 border-t pt-3">
              <div className="flex justify-between items-center">
                <Label className="text-sm">Posição da faixa (vertical)</Label>
                <span className="text-xs text-muted-foreground tabular-nums">{Math.round(effFooterY)}%</span>
              </div>
              <Slider value={[effFooterY]} onValueChange={([v]) => setFooterY(v)} min={0} max={100} step={0.5} disabled={locked} />
            </div>

            <div className="text-xs text-muted-foreground space-y-1 mt-1">
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
