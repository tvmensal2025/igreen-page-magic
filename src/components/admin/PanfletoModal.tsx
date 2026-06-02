import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import jsPDF from "jspdf";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
}

const SUPABASE_URL = "https://zlzasfhcxcznaprrragl.supabase.co";

// ============ FORMATO A4 (sulfite) ============
// public/images/mutirao-lei-14300-base.jpg (853 x 1280) → render 2x
const A4_SCALE = 2;
const A4_BG_W = 853;
const A4_BG_H = 1280;
const A4_W = A4_BG_W * A4_SCALE;
const A4_H = A4_BG_H * A4_SCALE;
const A4_QR_BOX = { x: 32, y: 855, size: 170 };

// ============ FORMATO BANNER (504mm x 940mm, proporção ~9:16) ============
// public/images/banner-lei-14300-base.jpg (1069 x 1920) — usamos resolução nativa
const BANNER_W = 1069;
const BANNER_H = 1920;
// Caixa vazia inferior-esquerda já desenhada no banner — só preenchemos com QR.
const BANNER_QR_BOX = { x: 60, y: 1480, size: 310 };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => {
      console.error("[panfleto] image load failed:", src, e);
      reject(new Error(`Failed to load ${src}`));
    };
    img.src = src;
  });
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

async function renderA4(
  canvas: HTMLCanvasElement,
  redirectUrl: string,
  nomeConsultor: string,
  telefoneConsultor: string,
  igreenId: string,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = A4_W, H = A4_H, SCALE = A4_SCALE, QR_BOX = A4_QR_BOX;
  canvas.width = W;
  canvas.height = H;

  const bg = await loadImage("/images/mutirao-lei-14300-base.jpg");
  ctx.drawImage(bg, 0, 0, W, H);

  const qrPad = 8;
  const qrBoxX = (QR_BOX.x - qrPad) * SCALE;
  const qrBoxY = (QR_BOX.y - qrPad) * SCALE;
  const qrBoxW = (QR_BOX.size + qrPad * 2) * SCALE;
  const qrBoxH = (QR_BOX.size + qrPad * 2) * SCALE;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 16 * SCALE;
  ctx.shadowOffsetY = 4 * SCALE;
  ctx.fillStyle = "#d4a017";
  ctx.fillRect(qrBoxX - 4 * SCALE, qrBoxY - 4 * SCALE, qrBoxW + 8 * SCALE, qrBoxH + 8 * SCALE);
  ctx.restore();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(qrBoxX, qrBoxY, qrBoxW, qrBoxH);

  const qrPx = QR_BOX.size * SCALE;
  const qrDataUrl = await QRCode.toDataURL(redirectUrl, {
    errorCorrectionLevel: "H",
    margin: 1,
    width: qrPx,
    color: { dark: "#0a0a0a", light: "#ffffff" },
  });
  const qrImg = await loadImage(qrDataUrl);
  ctx.drawImage(qrImg, QR_BOX.x * SCALE, QR_BOX.y * SCALE, qrPx, qrPx);

  const STRIPE_Y = 1040;
  const STRIPE_H = 38;
  const stripeY = STRIPE_Y * SCALE;
  const stripeH = STRIPE_H * SCALE;
  ctx.fillStyle = "#0d3b1f";
  ctx.fillRect(0, stripeY, W, stripeH);
  ctx.fillStyle = "#d4a017";
  ctx.fillRect(0, stripeY, W, 2 * SCALE);
  ctx.fillRect(0, stripeY + stripeH - 2 * SCALE, W, 2 * SCALE);

  const nomeUpper = (nomeConsultor || "CONSULTOR IGREEN").toUpperCase();
  const idLabel = igreenId ? ` • ID ${igreenId}` : "";
  const phoneFmt = formatBrPhone(telefoneConsultor) || "FALE COMIGO";

  ctx.textBaseline = "middle";
  const stripeMidY = stripeY + stripeH / 2;
  ctx.fillStyle = "#ffd700";
  ctx.font = `900 ${15 * SCALE}px Montserrat, "Arial Black", sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(`LICENCIADO: ${nomeUpper}${idLabel}`, 28 * SCALE, stripeMidY);
  ctx.textAlign = "right";
  ctx.fillText(`WHATSAPP: +55 ${phoneFmt}`, W - 28 * SCALE, stripeMidY);
}

// Tamanhos do bloco "APONTE A CÂMERA" desenhado no canvas do banner
const CAMERA_BLOCK = {
  line1Size: 36,
  line2Size: 36,
  lineGap: 10,
  arrowH: 30,
  arrowW: 36,
  arrowGap: 14,
};

function drawCameraBlock(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
) {
  const { line1Size, line2Size, lineGap, arrowH, arrowW, arrowGap } = CAMERA_BLOCK;
  const totalH = line1Size + lineGap + line2Size + arrowGap + arrowH;
  const topY = cy - totalH / 2;

  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  ctx.fillStyle = "#c8ff3e";
  ctx.font = `900 ${line1Size}px Montserrat, "Arial Black", sans-serif`;
  ctx.fillText("APONTE A CÂMERA", cx, topY);

  ctx.fillStyle = "#ffffff";
  ctx.font = `900 ${line2Size}px Montserrat, "Arial Black", sans-serif`;
  ctx.fillText("DO SEU CELULAR AQUI", cx, topY + line1Size + lineGap);

  // Seta pra baixo (verde)
  ctx.fillStyle = "#c8ff3e";
  const arrowTop = topY + line1Size + lineGap + line2Size + arrowGap;
  ctx.beginPath();
  ctx.moveTo(cx - arrowW / 2, arrowTop);
  ctx.lineTo(cx + arrowW / 2, arrowTop);
  ctx.lineTo(cx, arrowTop + arrowH);
  ctx.closePath();
  ctx.fill();
}

async function renderBanner(
  canvas: HTMLCanvasElement,
  redirectUrl: string,
  nomeConsultor: string,
  telefoneConsultor: string,
  igreenId: string,
  cameraPos: { xPct: number; yPct: number },
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = BANNER_W;
  canvas.height = BANNER_H;

  const bg = await loadImage("/images/banner-lei-14300-base.jpg");
  ctx.drawImage(bg, 0, 0, BANNER_W, BANNER_H);

  // QR dentro da caixa vazia bordada inferior-esquerda
  const { x, y, size } = BANNER_QR_BOX;
  const pad = 12;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x - pad, y - pad, size + pad * 2, size + pad * 2);
  ctx.strokeStyle = "#d4a017";
  ctx.lineWidth = 6;
  ctx.strokeRect(x - pad, y - pad, size + pad * 2, size + pad * 2);

  const qrDataUrl = await QRCode.toDataURL(redirectUrl, {
    errorCorrectionLevel: "H",
    margin: 1,
    width: size,
    color: { dark: "#0a0a0a", light: "#ffffff" },
  });
  const qrImg = await loadImage(qrDataUrl);
  ctx.drawImage(qrImg, x, y, size, size);

  // Bloco "APONTE A CÂMERA" arrastável (posição em % do canvas)
  drawCameraBlock(
    ctx,
    (cameraPos.xPct / 100) * BANNER_W,
    (cameraPos.yPct / 100) * BANNER_H,
  );

  // Faixa LICENCIADO + WHATSAPP no rodapé — menor
  const stripeH = 70;
  const stripeY = BANNER_H - stripeH;
  ctx.fillStyle = "#0d3b1f";
  ctx.fillRect(0, stripeY, BANNER_W, stripeH);
  ctx.fillStyle = "#d4a017";
  ctx.fillRect(0, stripeY, BANNER_W, 3);
  ctx.fillRect(0, stripeY + stripeH - 3, BANNER_W, 3);

  const nomeUpper = (nomeConsultor || "CONSULTOR IGREEN").toUpperCase();
  const idLabel = igreenId ? ` • ID ${igreenId}` : "";
  const phoneFmt = formatBrPhone(telefoneConsultor) || "FALE COMIGO";

  ctx.textBaseline = "middle";
  const midY = stripeY + stripeH / 2;
  ctx.fillStyle = "#ffd700";
  const leftText = `LICENCIADO: ${nomeUpper}${idLabel}`;
  const rightText = `WHATSAPP: +55 ${phoneFmt}`;
  const gap = 30;
  const sidePad = 40;
  const available = BANNER_W - sidePad * 2 - gap;
  // Auto-shrink: encontra a maior fonte (até 26px) que caiba ambos os textos
  let fontSize = 26;
  while (fontSize > 12) {
    ctx.font = `900 ${fontSize}px Montserrat, "Arial Black", sans-serif`;
    const wL = ctx.measureText(leftText).width;
    const wR = ctx.measureText(rightText).width;
    if (wL + wR <= available) break;
    fontSize -= 1;
  }
  ctx.font = `900 ${fontSize}px Montserrat, "Arial Black", sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(leftText, sidePad, midY);
  ctx.textAlign = "right";
  ctx.fillText(rightText, BANNER_W - sidePad, midY);
}

export function PanfletoModal({
  open,
  onClose,
  licenca,
  nomeConsultor,
  telefoneConsultor = "",
  igreenId = "",
}: PanfletoModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendering, setRendering] = useState(false);
  const [ready, setReady] = useState(false);
  const [format, setFormat] = useState<Format>("a4");
  // Posição do bloco "APONTE A CÂMERA" (banner) — % do canvas
  const [cameraPos, setCameraPos] = useState({ xPct: 50, yPct: 65 });
  const draggingCamera = useRef(false);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const redirectUrl = `${SUPABASE_URL}/functions/v1/qr-redirect?l=${encodeURIComponent(licenca)}`;

  const setCanvasRef = useCallback((el: HTMLCanvasElement | null) => {
    canvasRef.current = el;
    if (el) setReady(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setReady(false);
      return;
    }
    if (!ready || !canvasRef.current) return;
    setRendering(true);
    const p =
      format === "a4"
        ? renderA4(canvasRef.current, redirectUrl, nomeConsultor, telefoneConsultor, igreenId)
        : renderBanner(canvasRef.current, redirectUrl, nomeConsultor, telefoneConsultor, igreenId, cameraPos);
    p.catch((e) => {
        console.error("[panfleto] render error", e);
        toast({
          title: "Erro ao gerar arte",
          description: String(e?.message || e),
          variant: "destructive",
        });
      })
      .finally(() => setRendering(false));
  }, [open, ready, format, redirectUrl, nomeConsultor, telefoneConsultor, igreenId, cameraPos, toast]);

  const downloadPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${format === "a4" ? "panfleto-a4" : "banner-504x940"}-igreen-${licenca}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    toast({ title: "✅ PNG baixado!" });
  };

  const downloadPDF = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Tamanho físico real do PDF
    const wmm = format === "a4" ? 210 : 504;
    const hmm = format === "a4" ? 297 : 940;
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: [wmm, hmm] });

    // Fundo verde escuro pra letterbox (caso a proporção da arte não bata 100%)
    const bg = format === "a4" ? "#0d3b1f" : "#0a1f10";
    pdf.setFillColor(bg);
    pdf.rect(0, 0, wmm, hmm, "F");

    // Encaixa a arte dentro da página mantendo proporção (contain, sem cortar/esticar)
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
  };


  const copyLink = () => {
    navigator.clipboard.writeText(redirectUrl);
    toast({ title: "✅ Link do redirect copiado!" });
  };

  const canvasW = format === "a4" ? A4_W : BANNER_W;
  const canvasH = format === "a4" ? A4_H : BANNER_H;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <FileText className="w-5 h-5 text-primary" /> Arte Mutirão Lei 14.300
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Seletor de formato */}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={format === "a4" ? "default" : "outline"}
              onClick={() => setFormat("a4")}
              className="gap-2"
            >
              Sulfite A4
            </Button>
            <Button
              type="button"
              variant={format === "banner" ? "default" : "outline"}
              onClick={() => setFormat("banner")}
              className="gap-2"
            >
              Banner 504×940mm
            </Button>
          </div>

          <div className="bg-muted/30 rounded-xl p-4 border border-border">
            <p className="text-sm text-muted-foreground">
              QR único da licença <strong className="text-foreground">{licenca}</strong>. Sempre vai pro
              WhatsApp conectado da sua instância — se trocar de número, a mesma arte continua
              funcionando.{" "}
              {format === "a4"
                ? "Formato sulfite A4 — imprima quantos quiser."
                : "Formato banner 504mm × 940mm — pronto pra gráfica em lona/PVC."}
            </p>
          </div>

          <div className="relative bg-white rounded-xl border border-border overflow-hidden flex items-center justify-center p-4 min-h-[400px]">
            {rendering && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground bg-white/80 z-10">
                <Loader2 className="w-5 h-5 animate-spin" /> Gerando arte…
              </div>
            )}
            <div ref={canvasWrapRef} className="relative inline-block">
              <canvas
                ref={setCanvasRef}
                width={canvasW}
                height={canvasH}
                className="max-w-full h-auto shadow-lg block"
                style={{ maxHeight: "70vh" }}
              />
              {format === "banner" && (
                <div
                  className="absolute select-none touch-none cursor-move rounded ring-2 ring-yellow-400/70 hover:ring-yellow-400"
                  style={{
                    left: `${cameraPos.xPct}%`,
                    top: `${cameraPos.yPct}%`,
                    width: "32%",
                    height: "12%",
                    transform: "translate(-50%, -50%)",
                  }}
                  title="Arraste para posicionar a chamada APONTE A CÂMERA"
                  onPointerDown={(e) => {
                    draggingCamera.current = true;
                    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (!draggingCamera.current) return;
                    const wrap = canvasWrapRef.current?.querySelector("canvas");
                    if (!wrap) return;
                    const r = wrap.getBoundingClientRect();
                    const xPct = Math.max(5, Math.min(95, ((e.clientX - r.left) / r.width) * 100));
                    const yPct = Math.max(5, Math.min(95, ((e.clientY - r.top) / r.height) * 100));
                    setCameraPos({ xPct, yPct });
                  }}
                  onPointerUp={(e) => {
                    draggingCamera.current = false;
                    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
                  }}
                />
              )}
            </div>
          </div>
          {format === "banner" && (
            <p className="text-xs text-muted-foreground text-center -mt-2">
              Arraste a moldura amarela sobre o banner para posicionar a chamada "APONTE A CÂMERA".
            </p>
          )}

          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="outline" onClick={copyLink} className="gap-2">
              <Copy className="w-4 h-4" /> Copiar link
            </Button>
            <Button variant="outline" onClick={downloadPNG} disabled={rendering} className="gap-2">
              <Download className="w-4 h-4" /> Baixar PNG
            </Button>
            <Button onClick={downloadPDF} disabled={rendering} className="gap-2">
              <FileText className="w-4 h-4" /> Baixar PDF
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
