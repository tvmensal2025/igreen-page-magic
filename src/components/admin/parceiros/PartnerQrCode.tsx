import { useEffect, useRef, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Download, Upload, Trash2, ImageIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

interface PartnerQrCodeProps {
  open: boolean;
  onClose: () => void;
  partnerName: string;
  keyword: string;
  consultantPhone: string;
  consultantName?: string;
  consultantIgreenId?: string;
  qrPhrase?: string | null;
}

/**
 * Flyer templates ("Mutirão de Desconto na Fatura de Energia").
 * Ambos vivem em /public e são servidos via URL relativa.
 *  - a4:     853x1280  (sulfite A4)
 *  - banner: 1069x1920 (banner 504×940mm)
 */
type TemplateId = "a4" | "banner";

const TEMPLATES: Record<
  TemplateId,
  {
    label: string;
    src: string;
    qrX: number;
    qrY: number;
    qrSize: number;
    footerY: number;
  }
> = {
  a4: {
    label: "Sulfite A4",
    src: "/images/mutirao-lei-14300-base.jpg",
    qrX: 18,
    qrY: 60,
    qrSize: 22,
    footerY: 82,
  },
  banner: {
    label: "Banner 504×940mm",
    src: "/images/banner-lei-14300-base.jpg",
    qrX: 21,
    qrY: 88,
    qrSize: 22,
    footerY: 97,
  },
};
const DEFAULT_TEMPLATE_ID: TemplateId = "a4";

/**
 * Build the wa.me URL with the partner's keyword/phrase pre-filled.
 * Phone is normalized to BR format if it doesn't already start with 55.
 */
function buildWaMeUrl(
  phone: string,
  keyword: string,
  qrPhrase?: string | null,
): string {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.startsWith("55") ? digits : `55${digits}`;
  const message = qrPhrase || keyword;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

/**
 * Format a Brazilian phone in E.164-ish digits to "+55 (XX) XXXXX-XXXX".
 * Defensive: returns whatever the user typed if it's clearly malformed.
 */
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

/**
 * Output canvas dimensions. Keeps the same aspect ratio (~2:3) as the
 * default flyer template (853x1280) so the export looks right.
 */
const CANVAS_W = 1080;
const CANVAS_H = 1620;
const PREVIEW_W = 320;
const PREVIEW_H = 480;

/**
 * Editable flyer with draggable QR + footer band.
 *
 * Defaults to a built-in flyer template (Mutirão Lei 14.300) so the user gets
 * a finished-looking poster on first open. They can replace the background
 * via upload, drag the QR vertically, drag the footer vertically, and tweak
 * the QR size with a slider. Coordinates are stored as percentages of the
 * canvas height so preview (320×480) and export (1080×1620) stay aligned.
 */
export function PartnerQrCode({
  open,
  onClose,
  partnerName,
  keyword,
  consultantPhone,
  consultantName = "",
  consultantIgreenId = "",
  qrPhrase,
}: PartnerQrCodeProps) {
  const phrase = qrPhrase || keyword;
  const url = buildWaMeUrl(consultantPhone, keyword, qrPhrase);

  // Template selecionado (Sulfite A4 ou Banner 504×940mm).
  const [templateId, setTemplateId] = useState<TemplateId>(DEFAULT_TEMPLATE_ID);
  const template = TEMPLATES[templateId];

  // Default to the built-in template; user can upload to replace.
  const [bgImage, setBgImage] = useState<string | null>(template.src);

  // QR position/size (percentages of canvas).
  const [qrX, setQrX] = useState(template.qrX);
  const [qrY, setQrY] = useState(template.qrY);
  const [qrSize, setQrSize] = useState(template.qrSize);

  // Footer band Y (percentage of canvas height, anchor = vertical center of band).
  const [footerY, setFooterY] = useState(template.footerY);
  const [showFooter, setShowFooter] = useState(true);

  // Which element is being dragged ("qr" | "footer" | null).
  const draggingRef = useRef<null | "qr" | "footer">(null);

  const previewRef = useRef<HTMLDivElement>(null);
  const qrSvgWrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset (background + posições) sempre que o modal abre ou o template muda.
  useEffect(() => {
    if (!open) return;
    const t = TEMPLATES[templateId];
    setBgImage(t.src);
    setQrX(t.qrX);
    setQrY(t.qrY);
    setQrSize(t.qrSize);
    setFooterY(t.footerY);
    setShowFooter(true);
  }, [open, templateId]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setBgImage(reader.result);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const updatePosFromClient = useCallback(
    (clientX: number, clientY: number, what: "qr" | "footer") => {
      const el = previewRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const yPct = ((clientY - rect.top) / rect.height) * 100;
      const clamped = Math.max(0, Math.min(100, yPct));
      if (what === "qr") {
        const xPct = ((clientX - rect.left) / rect.width) * 100;
        setQrX(Math.max(0, Math.min(100, xPct)));
        setQrY(clamped);
      } else {
        setFooterY(clamped);
      }
    },
    [],
  );

  const handlePointerDown =
    (what: "qr" | "footer") => (e: React.PointerEvent<HTMLDivElement>) => {
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

  /**
   * Export PNG: draws background + QR + footer band into an offscreen canvas
   * at CANVAS_W×CANVAS_H and triggers a download. Background uses "cover" so
   * the aspect ratio is preserved without distortion.
   */
  const handleDownload = async () => {
    const svgElement = qrSvgWrapperRef.current?.querySelector("svg");
    if (!svgElement) return;

    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 1. Background.
    ctx.fillStyle = "#0a3d2c";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    if (bgImage) {
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const ratio = Math.max(CANVAS_W / img.width, CANVAS_H / img.height);
          const w = img.width * ratio;
          const h = img.height * ratio;
          const dx = (CANVAS_W - w) / 2;
          const dy = (CANVAS_H - h) / 2;
          ctx.drawImage(img, dx, dy, w, h);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = bgImage;
      });
    }

    // 2. QR with white border (matches reference flyer style).
    const svgData = new XMLSerializer().serializeToString(svgElement);
    const svgUrl =
      "data:image/svg+xml;base64," +
      btoa(unescape(encodeURIComponent(svgData)));
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const qrPx = (qrSize / 100) * CANVAS_W;
        const cx = (qrX / 100) * CANVAS_W;
        const cy = (qrY / 100) * CANVAS_H;
        const dx = cx - qrPx / 2;
        const dy = cy - qrPx / 2;
        const pad = qrPx * 0.06;
        // White card.
        ctx.fillStyle = "#ffffff";
        roundRect(
          ctx,
          dx - pad,
          dy - pad,
          qrPx + pad * 2,
          qrPx + pad * 2,
          qrPx * 0.04,
        );
        ctx.fill();
        // QR.
        ctx.drawImage(img, dx, dy, qrPx, qrPx);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = svgUrl;
    });

    // 3. Footer band (LICENCIADO ... | WHATSAPP ...).
    if (showFooter) {
      const bandHeight = CANVAS_H * 0.045;
      const bandY = (footerY / 100) * CANVAS_H - bandHeight / 2;
      ctx.fillStyle = "#0a3d2c";
      ctx.fillRect(0, bandY, CANVAS_W, bandHeight);

      const footerLeft = consultantName
        ? `LICENCIADO: ${consultantName.toUpperCase()}${consultantIgreenId ? ` • ID ${consultantIgreenId}` : ""}`
        : "";
      const footerRight = consultantPhone
        ? `WHATSAPP: ${formatPhoneDisplay(consultantPhone)}`
        : "";

      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${Math.round(bandHeight * 0.42)}px sans-serif`;
      ctx.textBaseline = "middle";
      const cy = bandY + bandHeight / 2;
      const sidePad = CANVAS_W * 0.04;
      ctx.textAlign = "left";
      if (footerLeft) ctx.fillText(footerLeft, sidePad, cy);
      ctx.textAlign = "right";
      if (footerRight) ctx.fillText(footerRight, CANVAS_W - sidePad, cy);
    }

    const a = document.createElement("a");
    a.download = `flyer-${partnerName.toLowerCase().replace(/[^a-z0-9]/g, "-")}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  };

  // Preview-space sizes (percentages → pixels).
  const qrPxPreview = (qrSize / 100) * PREVIEW_W;
  const footerHPreview = PREVIEW_H * 0.045;

  const footerLeftPreview = consultantName
    ? `LICENCIADO: ${consultantName.toUpperCase()}${consultantIgreenId ? ` • ID ${consultantIgreenId}` : ""}`
    : "LICENCIADO: (preencha em Configurações)";
  const footerRightPreview = consultantPhone
    ? `WHATSAPP: ${formatPhoneDisplay(consultantPhone)}`
    : "WHATSAPP: —";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>QR Code — {partnerName}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[auto_1fr] py-2">
          {/* Preview canvas */}
          <div className="flex flex-col items-center gap-3">
            <div
              ref={previewRef}
              role="application"
              aria-label="Editor do flyer. Arraste o QR ou a faixa de rodapé. Use os controles para ajuste fino."
              className="relative overflow-hidden rounded-xl border bg-emerald-900 shadow-sm"
              style={{
                width: PREVIEW_W,
                height: PREVIEW_H,
                backgroundImage: bgImage ? `url(${bgImage})` : undefined,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              {/* QR with white card, draggable */}
              <div
                ref={qrSvgWrapperRef}
                onPointerDown={handlePointerDown("qr")}
                className="absolute select-none touch-none cursor-move bg-white rounded-md p-1.5 shadow-md ring-1 ring-black/10"
                style={{
                  left: `calc(${qrX}% - ${qrPxPreview / 2}px)`,
                  top: `calc(${qrY}% - ${qrPxPreview / 2}px)`,
                  width: qrPxPreview,
                  height: qrPxPreview,
                }}
              >
                <QRCodeSVG
                  value={url}
                  size={qrPxPreview - 12}
                  level="M"
                  style={{ display: "block" }}
                />
              </div>

              {/* Footer band, draggable */}
              {showFooter && (
                <div
                  onPointerDown={handlePointerDown("footer")}
                  className="absolute left-0 right-0 select-none touch-none cursor-row-resize bg-emerald-900/95 text-white flex items-center justify-between px-2.5"
                  style={{
                    top: `calc(${footerY}% - ${footerHPreview / 2}px)`,
                    height: footerHPreview,
                    fontSize: Math.round(footerHPreview * 0.34),
                    fontWeight: 700,
                  }}
                >
                  <span className="truncate">{footerLeftPreview}</span>
                  <span className="truncate ml-2">{footerRightPreview}</span>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground text-center max-w-[320px]">
              Arraste o QR ou a faixa de rodapé. Use os sliders para ajuste
              fino.
            </p>
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label className="text-sm">Imagem de fundo</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileUpload}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-2"
                >
                  <Upload className="h-4 w-4" /> Enviar imagem
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setBgImage(DEFAULT_TEMPLATE)}
                  className="gap-2"
                  disabled={bgImage === DEFAULT_TEMPLATE}
                >
                  <ImageIcon className="h-4 w-4" /> Usar template padrão
                </Button>
                {bgImage && bgImage !== DEFAULT_TEMPLATE && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setBgImage(null)}
                    className="gap-2 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" /> Remover
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-sm">Posição do QR (vertical)</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {Math.round(qrY)}%
                </span>
              </div>
              <Slider
                value={[qrY]}
                onValueChange={([v]) => setQrY(v)}
                min={0}
                max={100}
                step={1}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-sm">Posição do QR (horizontal)</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {Math.round(qrX)}%
                </span>
              </div>
              <Slider
                value={[qrX]}
                onValueChange={([v]) => setQrX(v)}
                min={0}
                max={100}
                step={1}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-sm">Tamanho do QR</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {Math.round(qrSize)}%
                </span>
              </div>
              <Slider
                value={[qrSize]}
                onValueChange={([v]) => setQrSize(v)}
                min={12}
                max={45}
                step={1}
              />
            </div>

            <div className="space-y-1.5 border-t pt-3">
              <div className="flex justify-between items-center">
                <Label className="text-sm">Posição do rodapé (vertical)</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {Math.round(footerY)}%
                </span>
              </div>
              <Slider
                value={[footerY]}
                onValueChange={([v]) => setFooterY(v)}
                min={0}
                max={100}
                step={1}
                disabled={!showFooter}
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground mt-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showFooter}
                  onChange={(e) => setShowFooter(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-input"
                />
                Mostrar faixa com nome / ID / WhatsApp
              </label>
            </div>

            <div className="text-xs text-muted-foreground space-y-1 mt-1">
              <p>
                Ao escanear, abre WhatsApp com:{" "}
                <span className="font-medium">&quot;{phrase}&quot;</span>
              </p>
              <p className="break-all opacity-70">{url}</p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={handleDownload} className="gap-2">
            <Download className="h-4 w-4" /> Baixar PNG
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Helper: rounded rect path (no fill — caller fills). */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
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
