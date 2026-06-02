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
import { Download, Upload, Trash2, ImageIcon, FileText, Lock, Unlock } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import jsPDF from "jspdf";

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
    qrX: 20,
    qrY: 87,
    qrSize: 30,
    footerY: 99,
  },
};
const DEFAULT_TEMPLATE_ID: TemplateId = "a4";

/** Layouts travados (não-editáveis) — garantem que o impresso bate 1:1 com o preview. */
const DEFAULT_LOCKED: Record<TemplateId, boolean> = {
  a4: false,
  banner: true,
};

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
 * Dimensões físicas e de canvas por template. O canvas usa a proporção
 * nativa da arte (sem corte/distorção). O PDF usa o tamanho físico real.
 */
const TEMPLATE_DIMS: Record<
  TemplateId,
  { canvasW: number; canvasH: number; pdfWmm: number; pdfHmm: number }
> = {
  a4: { canvasW: 1240, canvasH: 1754, pdfWmm: 210, pdfHmm: 297 }, // A4 real
  banner: { canvasW: 1008, canvasH: 1808, pdfWmm: 504, pdfHmm: 904 },
};
const PREVIEW_W = 320;

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

  const [unlockedMap, setUnlockedMap] = useState<Record<TemplateId, boolean>>({ a4: false, banner: false });
  const locked = DEFAULT_LOCKED[templateId] && !unlockedMap[templateId];

  // Quando travado, força sempre os valores oficiais do template (ignora drift do estado).
  const effQrX = locked ? template.qrX : qrX;
  const effQrY = locked ? template.qrY : qrY;
  const effQrSize = locked ? template.qrSize : qrSize;
  const effFooterY = locked ? template.footerY : footerY;
  const effShowFooter = locked ? true : showFooter;

  // Ao re-travar via toggle, restaura valores oficiais para refletir no preview/sliders.
  const setLockedFor = (id: TemplateId, unlocked: boolean) => {
    setUnlockedMap((m) => ({ ...m, [id]: unlocked }));
    if (!unlocked && DEFAULT_LOCKED[id]) {
      const t = TEMPLATES[id];
      setQrX(t.qrX);
      setQrY(t.qrY);
      setQrSize(t.qrSize);
      setFooterY(t.footerY);
      setShowFooter(true);
    }
  };

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

  /**
   * Renderiza o flyer num canvas com a proporção nativa do template
   * selecionado (sem corte/distorção). Background usa "contain" e faixas
   * verdes preenchem o residual caso a arte enviada não bata a proporção.
   */
  const renderToCanvas = async (): Promise<HTMLCanvasElement | null> => {
    const svgElement = qrSvgWrapperRef.current?.querySelector("svg");
    if (!svgElement) return null;

    const dims = TEMPLATE_DIMS[templateId];
    const CW = dims.canvasW;
    const CH = dims.canvasH;

    const canvas = document.createElement("canvas");
    canvas.width = CW;
    canvas.height = CH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // 1. Fundo verde escuro.
    ctx.fillStyle = "#0a3d2c";
    ctx.fillRect(0, 0, CW, CH);

    // 2. Arte de fundo (cover — sem barras; igual ao preview/PDF).
    if (bgImage) {
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          drawImageCover(ctx, img, 0, 0, CW, CH);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = bgImage;
      });
    }

    // 3. QR com cartão branco.
    const svgData = new XMLSerializer().serializeToString(svgElement);
    const svgUrl =
      "data:image/svg+xml;base64," +
      btoa(unescape(encodeURIComponent(svgData)));
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const qrPx = (effQrSize / 100) * CW;
        const cx = (effQrX / 100) * CW;
        const cy = (effQrY / 100) * CH;
        const dx = cx - qrPx / 2;
        const dy = cy - qrPx / 2;
        const pad = qrPx * 0.06;
        ctx.fillStyle = "#ffffff";
        roundRect(ctx, dx - pad, dy - pad, qrPx + pad * 2, qrPx + pad * 2, qrPx * 0.04);
        ctx.fill();
        ctx.drawImage(img, dx, dy, qrPx, qrPx);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = svgUrl;
    });

    // 4. Faixa de rodapé.
    if (effShowFooter) {
      const bandHeight = CH * 0.03;
      const bandY = (effFooterY / 100) * CH - bandHeight / 2;
      ctx.fillStyle = "#0a3d2c";
      ctx.fillRect(0, bandY, CW, bandHeight);

      const footerLeft = consultantName
        ? `LICENCIADO: ${consultantName.toUpperCase()}${consultantIgreenId ? ` • ID ${consultantIgreenId}` : ""}`
        : "";
      const footerRight = consultantPhone
        ? `WHATSAPP: ${formatPhoneDisplay(consultantPhone)}`
        : "";

      ctx.fillStyle = "#fff200";
      ctx.textBaseline = "middle";
      const cyText = bandY + bandHeight / 2;
      const sidePad = CW * 0.025;
      const gap = CW * 0.02;
      const available = CW - sidePad * 2 - gap;
      // Auto-shrink pra caber nome+id+telefone sem cortar
      let fSize = Math.round(bandHeight * 0.36);
      while (fSize > 8) {
        ctx.font = `700 ${fSize}px sans-serif`;
        const wL = footerLeft ? ctx.measureText(footerLeft).width : 0;
        const wR = footerRight ? ctx.measureText(footerRight).width : 0;
        if (wL + wR <= available) break;
        fSize -= 1;
      }
      ctx.font = `700 ${fSize}px sans-serif`;
      ctx.textAlign = "left";
      if (footerLeft) ctx.fillText(footerLeft, sidePad, cyText);
      ctx.textAlign = "right";
      if (footerRight) ctx.fillText(footerRight, CW - sidePad, cyText);
    }

    return canvas;
  };

  const handleDownload = async () => {
    const canvas = await renderToCanvas();
    if (!canvas) return;
    const a = document.createElement("a");
    a.download = `flyer-${templateId}-${partnerName.toLowerCase().replace(/[^a-z0-9]/g, "-")}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  };

  const handleDownloadPDF = async () => {
    const canvas = await renderToCanvas();
    if (!canvas) return;
    const { pdfWmm: wmm, pdfHmm: hmm } = TEMPLATE_DIMS[templateId];
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: [wmm, hmm] });
    pdf.setFillColor("#0a3d2c");
    pdf.rect(0, 0, wmm, hmm, "F");
    const scale = Math.min(wmm / canvas.width, hmm / canvas.height);
    const drawW = canvas.width * scale;
    const drawH = canvas.height * scale;
    const dx = (wmm - drawW) / 2;
    const dy = (hmm - drawH) / 2;
    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    pdf.addImage(imgData, "JPEG", dx, dy, drawW, drawH);
    pdf.save(`flyer-${templateId}-${partnerName.toLowerCase().replace(/[^a-z0-9]/g, "-")}.pdf`);
  };

  // Preview com proporção real do template (largura fixa, altura calculada).
  const previewAspect =
    TEMPLATE_DIMS[templateId].canvasH / TEMPLATE_DIMS[templateId].canvasW;
  const PREVIEW_H = Math.round(PREVIEW_W * previewAspect);

  // Preview-space sizes (percentages → pixels).
  const qrCorePxPreview = (effQrSize / 100) * PREVIEW_W;
  const qrPadPreview = qrCorePxPreview * 0.06;
  const qrCardPxPreview = qrCorePxPreview + qrPadPreview * 2;
  const footerHPreview = PREVIEW_H * 0.03;
  const footerFontPreview = Math.max(7, Math.round(footerHPreview * 0.36));

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
                backgroundRepeat: "no-repeat",
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
                className={`absolute select-none touch-none bg-white rounded-md p-1.5 shadow-md ring-1 ring-black/10 ${locked ? "cursor-not-allowed" : "cursor-move"}`}
                style={{
                  left: `calc(${effQrX}% - ${qrCardPxPreview / 2}px)`,
                  top: `calc(${effQrY}% - ${qrCardPxPreview / 2}px)`,
                  width: qrCardPxPreview,
                  height: qrCardPxPreview,
                  padding: qrPadPreview,
                }}
              >
                <QRCodeSVG
                  value={url}
                  size={qrCorePxPreview}
                  level="M"
                  style={{ display: "block" }}
                />
              </div>

              {/* Footer band, draggable */}
              {effShowFooter && (
                <div
                  onPointerDown={handlePointerDown("footer")}
                  className={`absolute left-0 right-0 select-none touch-none bg-emerald-900/95 flex items-center justify-between leading-tight px-2 ${locked ? "cursor-not-allowed" : "cursor-row-resize"}`}
                  style={{
                    top: `calc(${effFooterY}% - ${footerHPreview / 2}px)`,
                    minHeight: footerHPreview,
                    fontSize: footerFontPreview,
                    color: "#fff200",
                    fontWeight: 700,
                  }}
                >
                  <span className="whitespace-nowrap overflow-hidden text-ellipsis">{footerLeftPreview}</span>
                  <span className="whitespace-nowrap pl-2">{footerRightPreview}</span>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground text-center max-w-[320px]">
              {locked
                ? "Layout travado — bate 1:1 com a impressão."
                : "Arraste o QR ou a faixa de rodapé. Use os sliders para ajuste fino."}
            </p>
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label className="text-sm">Formato do template</Label>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(TEMPLATES) as TemplateId[]).map((id) => (
                  <Button
                    key={id}
                    type="button"
                    size="sm"
                    variant={templateId === id ? "default" : "outline"}
                    onClick={() => setTemplateId(id)}
                  >
                    {TEMPLATES[id].label}
                  </Button>
                ))}
              </div>
              {DEFAULT_LOCKED[templateId] && (
                <button
                  type="button"
                  onClick={() => setLockedFor(templateId, !unlockedMap[templateId])}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 hover:bg-muted border border-border rounded-md px-2 py-1.5 mt-1 transition-colors w-full text-left"
                  title={locked ? "Clique para destravar e ajustar manualmente" : "Clique para travar novamente"}
                >
                  {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5 text-emerald-500" />}
                  {locked
                    ? "Layout travado — clique para destravar e ajustar"
                    : "Layout destravado — clique para travar de novo"}
                </button>
              )}
            </div>

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
                  disabled={locked}
                >
                  <Upload className="h-4 w-4" /> Enviar imagem
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setBgImage(template.src)}
                  className="gap-2"
                  disabled={locked || bgImage === template.src}
                >
                  <ImageIcon className="h-4 w-4" /> Usar template padrão
                </Button>
                {bgImage && bgImage !== template.src && !locked && (
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
                  {Math.round(effQrY)}%
                </span>
              </div>
              <Slider
                value={[effQrY]}
                onValueChange={([v]) => setQrY(v)}
                min={0}
                max={100}
                step={1}
                disabled={locked}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-sm">Posição do QR (horizontal)</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {Math.round(effQrX)}%
                </span>
              </div>
              <Slider
                value={[effQrX]}
                onValueChange={([v]) => setQrX(v)}
                min={0}
                max={100}
                step={1}
                disabled={locked}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-sm">Tamanho do QR</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {Math.round(effQrSize)}%
                </span>
              </div>
              <Slider
                value={[effQrSize]}
                onValueChange={([v]) => setQrSize(v)}
                min={12}
                max={45}
                step={1}
                disabled={locked}
              />
            </div>

            <div className="space-y-1.5 border-t pt-3">
              <div className="flex justify-between items-center">
                <Label className="text-sm">Posição do rodapé (vertical)</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {Math.round(effFooterY)}%
                </span>
              </div>
              <Slider
                value={[effFooterY]}
                onValueChange={([v]) => setFooterY(v)}
                min={0}
                max={100}
                step={1}
                disabled={locked || !effShowFooter}
              />
              <label className={`flex items-center gap-2 text-xs text-muted-foreground mt-2 ${locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
                <input
                  type="checkbox"
                  checked={effShowFooter}
                  onChange={(e) => setShowFooter(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-input"
                  disabled={locked}
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
          <Button variant="outline" onClick={handleDownload} className="gap-2">
            <Download className="h-4 w-4" /> Baixar PNG
          </Button>
          <Button onClick={handleDownloadPDF} className="gap-2">
            <FileText className="h-4 w-4" />
            Baixar PDF ({TEMPLATE_DIMS[templateId].pdfWmm}×{TEMPLATE_DIMS[templateId].pdfHmm}mm)
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
