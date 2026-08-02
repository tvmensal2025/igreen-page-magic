import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import jsPDF from "jspdf";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  drawFlyerFooter,
  clampFooterBand,
  previewFooterFontSize,
} from "@/components/admin/flyerFooter";
import { Download, Copy, FileText, Loader2, RotateCcw } from "lucide-react";
import { useFlyerPreviewSize } from "@/components/admin/flyerPreviewSize";
import { useToast } from "@/hooks/use-toast";

/** Frase padrão usada pelo `qr-redirect` quando `?msg=` não vem. Mantida em
 *  sincronia para o placeholder do campo refletir exatamente o que o lead
 *  veria sem personalizar nada. */
const DEFAULT_QR_MESSAGE =
  "Oi! 👋 Vi sobre a iGreen Energy e quero saber como economizar na minha conta de luz.";
const QR_MESSAGE_MAX = 200;

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



// ============ Dimensões nativas (na proporção física EXATA do papel) ============
// A4 = 210×297mm (0,707) · Banner = 504×904mm (360imprimir). Manter a proporção do
// canvas igual à do papel garante impressão sem barra lateral e sem esticar o QR.
const A4_W = 905;
const A4_H = 1280;
const BANNER_W = 1008;
const BANNER_H = 1808;

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
    bg: "/images/banner-a4.jpg",
    canvasW: A4_W,
    canvasH: A4_H,
    pdfWmm: 210,
    pdfHmm: 297,
    // Mesmos defaults travados do PartnerQrCode (Folha A4).
    qrX: 25,
    qrY: 91,
    qrSize: 16,
    footerY: 99,
    footerH: 2.6,
  },
  banner: {
    bg: "/images/banner-504x904.jpg",
    canvasW: BANNER_W,
    canvasH: BANNER_H,
    pdfWmm: 504,
    pdfHmm: 904,
    // Mesmos defaults travados do PartnerQrCode (Banner 504×904mm).
    qrX: 15,
    qrY: 89,
    qrSize: 23,
    footerY: 100,
    footerH: 3,
  },
};

const PREVIEW_W = 380;
// Altura máxima do preview para caber numa tela de notebook sem scroll.
// O Banner 504×904mm é alto e, calculado só pela largura, estouraria a tela;
// então reduzimos proporcionalmente até esse teto.
const PREVIEW_MAX_H = 440;
const QR_QUIET_PX = 2;
const QR_BORDER_PX = 1;

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

  // Frase personalizada do WhatsApp (entra como `?msg=` no qr-redirect, que já
  // aceita esse parâmetro). Persiste por consultor no localStorage para o
  // usuário não perder ao reabrir o modal. Vazio = usa o DEFAULT do edge.
  const storageKey = `panfleto_msg_${licenca}`;
  const [phrase, setPhrase] = useState<string>("");
  useEffect(() => {
    if (!open) return;
    try {
      const saved = localStorage.getItem(storageKey);
      setPhrase(saved ?? "");
    } catch {
      setPhrase("");
    }
  }, [open, storageKey]);

  useEffect(() => {
    try {
      if (phrase.trim()) localStorage.setItem(storageKey, phrase);
      else localStorage.removeItem(storageKey);
    } catch {
      /* localStorage indisponível em modo privado */
    }
  }, [phrase, storageKey]);

  const redirectUrl = useMemo(() => {
    if (shareUrl) return shareUrl;
    // Link curto com marca. index.html redireciona na hora → WhatsApp.
    const base = `https://igreen.cloud/r/${encodeURIComponent(licenca)}`;
    const trimmed = phrase.trim();
    if (!trimmed) return base;
    return `${base}?msg=${encodeURIComponent(trimmed.slice(0, QR_MESSAGE_MAX))}`;
  }, [shareUrl, licenca, phrase]);

  // Posições TRAVADAS nos defaults do template
  const effQrX = template.qrX;
  const effQrY = template.qrY;
  const effQrSize = template.qrSize;
  const effFooterY = template.footerY;

  const [rendering, setRendering] = useState(false);

  // Preview na tela (responsivo). Export usa canvasW/canvasH do template — tamanhos fixos.
  const { width: PREVIEW_W_EFF, height: PREVIEW_H } = useFlyerPreviewSize(
    template.canvasW,
    template.canvasH,
    PREVIEW_W,
    PREVIEW_MAX_H,
  );

  const qrCorePxPreview = (effQrSize / 100) * PREVIEW_W_EFF;
  const qrFramePxPreview =
    qrCorePxPreview + QR_QUIET_PX * 2 + QR_BORDER_PX * 2;

  const nomeUpper = (nomeConsultor || "CONSULTOR IGREEN").toUpperCase();
  const idLabel = igreenId ? ` • ID ${igreenId}` : "";
  const phoneFmt = formatBrPhone(telefoneConsultor) || "FALE COMIGO";
  const footerLeft = `LICENCIADO: ${nomeUpper}${idLabel}`;
  const footerRight = `WHATSAPP: +55 ${phoneFmt}`;

  const { bandTop: footerTopPreview, bandHeight: footerHPreview } = clampFooterBand(
    PREVIEW_H,
    effFooterY,
    template.footerH,
  );
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
        drawQrWithThinFrame(ctx, img, cx, cy, qrPx);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = svgUrl;
    });

    drawFlyerFooter(ctx, {
      canvasW: CW,
      canvasH: CH,
      footerYPercent: effFooterY,
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

  const downloadPNG = async () => {
    setRendering(true);
    try {
      const canvas = await renderToCanvas();
      if (!canvas) return;
      const link = document.createElement("a");
      link.download = `${format === "a4" ? "panfleto-a4" : "banner-504x904"}-igreen-${licenca}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast({ title: "✅ PNG baixado!" });
    } finally {
      setRendering(false);
    }
  };

  const downloadQrOnly = async () => {
    setRendering(true);
    try {
      const svgEl = qrSvgWrapperRef.current?.querySelector("svg");
      const ok = await downloadQrOnlyPng(svgEl, `igreen-${licenca}`);
      toast(
        ok
          ? { title: "✅ QR Code baixado!" }
          : { title: "Não foi possível gerar o QR Code", variant: "destructive" },
      );
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
      const name = format === "a4" ? "panfleto-a4-210x297" : "banner-504x904";
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
      <DialogContent className="w-[calc(100%-1rem)] sm:w-full max-w-4xl max-h-[95dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <FileText className="w-5 h-5 text-primary" /> {title ?? "Arte Mutirão Lei 14.300"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[auto_1fr] py-2 min-w-0">
          {/* Preview */}
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
                  left: `calc(${effQrX}% - ${qrFramePxPreview / 2}px)`,
                  top: `calc(${effQrY}% - ${qrFramePxPreview / 2}px)`,
                  width: qrFramePxPreview,
                  height: qrFramePxPreview,
                  padding: QR_QUIET_PX,
                  borderWidth: QR_BORDER_PX,
                }}
              >
                <QRCodeSVG
                  value={redirectUrl}
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
            <p className="text-xs text-muted-foreground text-center max-w-[320px]">
              Layout travado — bate 1:1 com a impressão.
            </p>
          </div>

          {/* Controles */}
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
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="qr-phrase" className="text-sm">
                  Frase que abre junto com o WhatsApp
                </Label>
                {phrase.trim() && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={() => setPhrase("")}
                  >
                    <RotateCcw className="w-3 h-3" /> Padrão
                  </Button>
                )}
              </div>
              <Textarea
                id="qr-phrase"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value.slice(0, QR_MESSAGE_MAX))}
                placeholder={DEFAULT_QR_MESSAGE}
                rows={3}
                maxLength={QR_MESSAGE_MAX}
                className="text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                Ao escanear o QR, o WhatsApp abre com esta mensagem já preenchida.
                Deixe vazio para usar a frase padrão. {phrase.length}/{QR_MESSAGE_MAX}
              </p>
            </div>

            <div className="text-xs text-muted-foreground space-y-1 mt-1">
              <p className="opacity-80">Link do QR:</p>
              <p className="break-all opacity-70">{redirectUrl}</p>
            </div>

          </div>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
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
