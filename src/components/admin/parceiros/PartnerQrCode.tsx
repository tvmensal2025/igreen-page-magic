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
import { Download, Upload, Trash2, ImageIcon, FileText, Lock, Unlock, Copy, ExternalLink, Check, Share2, Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import jsPDF from "jspdf";
import {
  drawFlyerFooter,
  clampFooterBand,
  previewFooterFontSize,
} from "@/components/admin/flyerFooter";
import { resolveQrMessage } from "./qrPhrase";
import {
  templatePlaceholderArt,
  templateSizeHint,
  drawFlyerPlaceholderBackground,
} from "@/components/admin/flyerPlaceholder";
import { useFlyerPreviewSize } from "@/components/admin/flyerPreviewSize";
import { buildPartnerPublicShortLink } from "@/lib/partnerShortLink";
import { useToast } from "@/hooks/use-toast";

interface PartnerQrCodeProps {
  open: boolean;
  onClose: () => void;
  partnerName: string;
  keyword: string;
  consultantPhone: string;
  consultantName?: string;
  consultantIgreenId?: string;
  qrPhrase?: string | null;
  /** Licença do consultor — slug na URL curta (`/r/{licenca}/...`). */
  license?: string | null;
  /** Código numérico do parceiro (gerado no banco) — vai na URL curta. */
  shortCode?: string | null;
}

/**
 * Link curto com marca: `igreen.cloud/r/{ref}/{code}`.
 * No celular o `index.html` redireciona na hora pra edge → WhatsApp (sem site).
 */
function buildShortLink(
  license?: string | null,
  shortCode?: string | null,
  consultantIgreenId?: string | null,
): string | null {
  const ref = (consultantIgreenId ?? "").trim() || (license ?? "").trim();
  const code = (shortCode ?? "").trim();
  if (!ref || !code) return null;
  return buildPartnerPublicShortLink(ref, code);
}

/**
 * Modelos de impressão. Cada modelo tem proporção física FIXA: a arte enviada
 * é sempre recortada (cover) para caber exatamente no tamanho de impressão, sem
 * distorcer e sem mudar a proporção. O PDF sai no tamanho físico real (mm).
 *
 *  - a4:       210×297mm   (folha sulfite, arte oficial)
 *  - banner:   504×904mm   (banner 360imprimir / gráfica360)
 *  - faixa200: 2000×800mm  (2,00×0,80m, faixa horizontal — envie sua arte)
 *  - faixa110: 1100×800mm  (1,10×0,80m, faixa horizontal — envie sua arte)
 */
type TemplateId =
  | "a4"
  | "banner"
  | "banner60x90"
  | "banner80x120"
  | "banner90x120"
  | "banner100x150"
  | "rollup80x200"
  | "faixa200"
  | "faixa110"
  | "faixa100x70"
  | "faixa300x100"
  | "story"
  | "post";

const TEMPLATES: Record<
  TemplateId,
  {
    label: string;
    src: string | null;
    qrX: number;
    qrY: number;
    qrSize: number;
    footerY: number;
    /** Altura da faixa de rodapé (% da altura do canvas). */
    footerH?: number;
  }
> = {
  a4: {
    label: "Folha A4",
    src: "/images/banner-a4.jpg",
    // Calibrado no preview (travado — bate 1:1 com impressão).
    qrX: 25,
    qrY: 91,
    qrSize: 16,
    footerY: 99,
    footerH: 2.6,
  },
  banner: {
    label: "Banner 504×904mm",
    src: "/images/banner-504x904.jpg",
    // Calibrado no preview (travado — bate 1:1 com impressão).
    qrX: 15,
    qrY: 89,
    qrSize: 23,
    footerY: 100,
    footerH: 3,
  },
  // ---- Banners verticais (envie sua arte) ----
  banner60x90: {
    label: "Banner 60×90cm",
    src: null,
    qrX: 50,
    qrY: 80,
    qrSize: 28,
    footerY: 95,
  },
  banner80x120: {
    label: "Banner 80×120cm",
    src: null,
    qrX: 50,
    qrY: 80,
    qrSize: 26,
    footerY: 95,
  },
  banner90x120: {
    label: "Banner 90×120cm",
    src: null,
    qrX: 50,
    qrY: 78,
    qrSize: 28,
    footerY: 94,
  },
  banner100x150: {
    label: "Banner 100×150cm",
    src: null,
    qrX: 50,
    qrY: 80,
    qrSize: 26,
    footerY: 95,
  },
  rollup80x200: {
    label: "Roll-up 80×200cm",
    src: null,
    qrX: 50,
    qrY: 75,
    qrSize: 24,
    footerY: 93,
  },
  // ---- Faixas horizontais (envie sua arte) ----
  faixa200: {
    label: "Faixa 2,00×0,80m",
    src: null,
    qrX: 88,
    qrY: 50,
    qrSize: 20,
    footerY: 90,
  },
  faixa110: {
    label: "Faixa 1,10×0,80m",
    src: null,
    qrX: 84,
    qrY: 52,
    qrSize: 28,
    footerY: 90,
  },
  faixa100x70: {
    label: "Faixa 1,00×0,70m",
    src: null,
    qrX: 80,
    qrY: 50,
    qrSize: 30,
    footerY: 92,
  },
  faixa300x100: {
    label: "Faixa 3,00×1,00m",
    src: null,
    qrX: 90,
    qrY: 50,
    qrSize: 16,
    footerY: 92,
  },
  // ---- Digitais (story / post — envie sua arte) ----
  story: {
    label: "Story / Status 9:16",
    src: null,
    qrX: 50,
    qrY: 78,
    qrSize: 26,
    footerY: 95,
  },
  post: {
    label: "Post Instagram 1:1",
    src: null,
    qrX: 50,
    qrY: 70,
    qrSize: 32,
    footerY: 93,
  },
};
const DEFAULT_TEMPLATE_ID: TemplateId = "a4";

/**
 * Layouts com arte oficial começam travados (impresso bate 1:1 com o preview).
 * As faixas são de upload do usuário, então começam destravadas para posicionar
 * o QR e a faixa de rodapé livremente.
 */
const DEFAULT_LOCKED: Record<TemplateId, boolean> = {
  a4: true,
  banner: true,
  banner60x90: false,
  banner80x120: false,
  banner90x120: false,
  banner100x150: false,
  rollup80x200: false,
  faixa200: false,
  faixa110: false,
  faixa100x70: false,
  faixa300x100: false,
  story: false,
  post: false,
};

/**
 * Build the wa.me URL with the partner's keyword/phrase pre-filled.
 * Phone is normalized to BR format if it doesn't already start with 55.
 *
 * A mensagem passa por `resolveQrMessage`: usa a frase padrão curta quando não
 * há `qrPhrase`, ou respeita a frase do consultor (garantindo que a keyword
 * permaneça no texto para não perder a atribuição). Isso mantém a URL enxuta
 * inclusive para parceiros antigos com frase longa salva.
 */
function buildWaMeUrl(
  phone: string,
  keyword: string,
  qrPhrase?: string | null,
  shortCode?: string | null,
): string {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.startsWith("55") ? digits : `55${digits}`;
  const message = resolveQrMessage(qrPhrase, keyword, shortCode);
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
  a4: { canvasW: 1240, canvasH: 1754, pdfWmm: 210, pdfHmm: 297 }, // 210×297mm — canvas na proporção EXATA da folha (0,707): fundo cobre tudo, sem barra lateral nem distorção
  banner: { canvasW: 1008, canvasH: 1808, pdfWmm: 504, pdfHmm: 904 }, // 504×904mm (360imprimir)
  // Banners verticais (proporção física travada; canvas escalado ~1.18px/mm).
  banner60x90: { canvasW: 708, canvasH: 1063, pdfWmm: 600, pdfHmm: 900 }, // 60×90cm
  banner80x120: { canvasW: 945, canvasH: 1417, pdfWmm: 800, pdfHmm: 1200 }, // 80×120cm
  banner90x120: { canvasW: 1063, canvasH: 1417, pdfWmm: 900, pdfHmm: 1200 }, // 90×120cm
  banner100x150: { canvasW: 1181, canvasH: 1772, pdfWmm: 1000, pdfHmm: 1500 }, // 100×150cm
  rollup80x200: { canvasW: 945, canvasH: 2362, pdfWmm: 800, pdfHmm: 2000 }, // 80×200cm
  // Faixas horizontais (landscape).
  faixa200: { canvasW: 2000, canvasH: 800, pdfWmm: 2000, pdfHmm: 800 }, // 2,00×0,80m
  faixa110: { canvasW: 1375, canvasH: 1000, pdfWmm: 1100, pdfHmm: 800 }, // 1,10×0,80m
  faixa100x70: { canvasW: 1181, canvasH: 827, pdfWmm: 1000, pdfHmm: 700 }, // 1,00×0,70m
  faixa300x100: { canvasW: 2362, canvasH: 787, pdfWmm: 3000, pdfHmm: 1000 }, // 3,00×1,00m
  // Digitais (px reais; PDF em mm só pra manter o fluxo — uso real é o PNG).
  story: { canvasW: 1080, canvasH: 1920, pdfWmm: 108, pdfHmm: 192 }, // 1080×1920px (9:16)
  post: { canvasW: 1080, canvasH: 1080, pdfWmm: 108, pdfHmm: 108 }, // 1080×1080px (1:1)
};
const PREVIEW_W = 320;
const PREVIEW_MAX_H = 440;
/** Margem branca interna + moldura fina ao redor do QR (preview, px). */
const QR_QUIET_PX = 2;
const QR_BORDER_PX = 1;

/** Desenha QR com faixa branca fina + contorno escuro para leitura limpa na arte. */
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
  license,
  shortCode,
}: PartnerQrCodeProps) {
  // `phrase` é a mensagem que o lead vai ver no WhatsApp (exibida no card).
  // Inclui o marcador `#R{short_code}` quando há short_code — esse é o sinal
  // determinístico que o webhook usa para atribuir o lead a este parceiro
  // mesmo se o lead apagar/editar o resto da mensagem.
  const phrase = resolveQrMessage(qrPhrase, keyword, shortCode);
  // Link curto com marca (igreen.cloud/r/...) — bounce imediato → WhatsApp.
  const shortLink = buildShortLink(license, shortCode, consultantIgreenId);
  const url =
    shortLink ?? buildWaMeUrl(consultantPhone, keyword, qrPhrase, shortCode);
  const { toast } = useToast();
  const [sharingWa, setSharingWa] = useState(false);

  // Template selecionado (Sulfite A4 ou Banner 504×904mm).
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

  const [unlockedMap, setUnlockedMap] = useState<Record<TemplateId, boolean>>(
    () =>
      Object.fromEntries(
        (Object.keys(TEMPLATES) as TemplateId[]).map((id) => [id, false]),
      ) as Record<TemplateId, boolean>,
  );

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
    if (DEFAULT_LOCKED[templateId]) {
      setUnlockedMap((m) => ({ ...m, [templateId]: false }));
    }
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

    // 2. Arte de fundo ou placeholder (embaçado + tamanho).
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
    } else {
      const digital = templateId === "story" || templateId === "post";
      const sizeLabel = templateSizeHint(
        dims.pdfWmm,
        dims.pdfHmm,
        dims.canvasW,
        dims.canvasH,
        digital,
      );
      await drawFlyerPlaceholderBackground(
        ctx,
        CW,
        CH,
        templatePlaceholderArt(dims.canvasW, dims.canvasH),
        sizeLabel,
      );
    }

    // 3. QR com moldura fina (faixa branca + contorno escuro).
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
        drawQrWithThinFrame(ctx, img, cx, cy, qrPx);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = svgUrl;
    });

    // 4. Faixa de rodapé (clamp + 2 linhas se nome longo).
    if (effShowFooter) {
      const footerLeft = consultantName
        ? `LICENCIADO: ${consultantName.toUpperCase()}${consultantIgreenId ? ` • ID ${consultantIgreenId}` : ""}`
        : "";
      const footerRight = consultantPhone
        ? `WHATSAPP: ${formatPhoneDisplay(consultantPhone)}`
        : "";
      drawFlyerFooter(ctx, {
        canvasW: CW,
        canvasH: CH,
        footerYPercent: effFooterY,
        footerHPercent: template.footerH ?? 2.8,
        footerLeft,
        footerRight,
      });
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
    const orientation = wmm > hmm ? "landscape" : "portrait";
    const pdf = new jsPDF({ orientation, unit: "mm", format: [wmm, hmm] });
    // O canvas de cada template já tem a proporção física EXATA do papel, então
    // a arte preenche a página inteira sem esticar e sem barras (borda do lado).
    const imgData = canvas.toDataURL("image/png");
    pdf.addImage(imgData, "PNG", 0, 0, wmm, hmm);
    pdf.save(`flyer-${templateId}-${partnerName.toLowerCase().replace(/[^a-z0-9]/g, "-")}.pdf`);
  };

  /** Gera PNG em alta (canvas full) e abre o share do celular / fallback desktop. */
  const handleSendWhatsApp = async () => {
    setSharingWa(true);
    try {
      const canvas = await renderToCanvas();
      if (!canvas) {
        toast({
          title: "Não foi possível gerar a arte",
          description: "Tente baixar o PNG e enviar manualmente.",
          variant: "destructive",
        });
        return;
      }
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png"),
      );
      if (!blob) {
        toast({
          title: "Falha ao gerar PNG",
          variant: "destructive",
        });
        return;
      }
      const fileName = `flyer-${templateId}-${partnerName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}.png`;
      const file = new File([blob], fileName, { type: "image/png" });
      const shareText = shortLink
        ? `Meu link: ${shortLink}`
        : phrase;

      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };
      if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
        await nav.share({
          files: [file],
          title: `Flyer — ${partnerName}`,
          text: shareText,
        });
        toast({
          title: "Pronto para enviar",
          description: "Escolha o WhatsApp na lista de apps.",
          duration: 2500,
        });
        return;
      }

      // Desktop / sem Web Share com arquivo: baixa PNG HQ + abre WhatsApp com o link.
      const a = document.createElement("a");
      a.download = fileName;
      a.href = URL.createObjectURL(blob);
      a.click();
      URL.revokeObjectURL(a.href);

      const waText = encodeURIComponent(
        shortLink
          ? `Olá! Segue meu material. Link: ${shortLink}`
          : phrase,
      );
      window.open(`https://wa.me/?text=${waText}`, "_blank", "noopener,noreferrer");
      toast({
        title: "PNG baixado em alta qualidade",
        description: "No WhatsApp, anexe a imagem que acabou de baixar.",
        duration: 4500,
      });
    } catch (err) {
      // Usuário cancelou o share nativo — não é erro.
      if ((err as Error)?.name === "AbortError") return;
      toast({
        title: "Não foi possível compartilhar",
        description: "Baixe o PNG e envie pelo WhatsApp.",
        variant: "destructive",
      });
    } finally {
      setSharingWa(false);
    }
  };

  // Preview na tela (responsivo). Export PNG/PDF usa TEMPLATE_DIMS — tamanhos fixos.
  const dims = TEMPLATE_DIMS[templateId];
  const { width: PREVIEW_W_EFF, height: PREVIEW_H } = useFlyerPreviewSize(
    dims.canvasW,
    dims.canvasH,
    PREVIEW_W,
    PREVIEW_MAX_H,
  );

  // Preview-space sizes (percentages → pixels).
  const qrCorePxPreview = (effQrSize / 100) * PREVIEW_W_EFF;
  const qrFramePxPreview =
    qrCorePxPreview + QR_QUIET_PX * 2 + QR_BORDER_PX * 2;
  const footerLeftPreview = consultantName
    ? `LICENCIADO: ${consultantName.toUpperCase()}${consultantIgreenId ? ` • ID ${consultantIgreenId}` : ""}`
    : "LICENCIADO: (preencha em Configurações)";
  const footerRightPreview = consultantPhone
    ? `WHATSAPP: ${formatPhoneDisplay(consultantPhone)}`
    : "WHATSAPP: —";

  const footerHPercent = template.footerH ?? 2.8;
  const { bandTop: footerTopPreview, bandHeight: footerHPreview } = clampFooterBand(
    PREVIEW_H,
    effFooterY,
    footerHPercent,
  );
  const footerFontPreview = previewFooterFontSize(
    PREVIEW_W_EFF,
    footerHPreview,
    footerLeftPreview,
    footerRightPreview,
    "700",
  );

  const isDigitalTemplate = templateId === "story" || templateId === "post";
  const placeholderSizeHint = templateSizeHint(
    dims.pdfWmm,
    dims.pdfHmm,
    dims.canvasW,
    dims.canvasH,
    isDigitalTemplate,
  );
  const placeholderArt = templatePlaceholderArt(dims.canvasW, dims.canvasH);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[calc(100%-1rem)] sm:w-full max-w-3xl max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>QR Code — {partnerName}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[auto_1fr] py-2 min-w-0">
          {/* Preview canvas — só escala visual; % do QR/rodapé = export */}
          <div className="flex flex-col items-center gap-3 w-full min-w-0 max-w-full">
            <div
              ref={previewRef}
              role="application"
              aria-label="Editor do flyer. Arraste o QR ou a faixa de rodapé. Use os controles para ajuste fino."
              className="relative overflow-hidden rounded-xl border bg-primary shadow-sm max-w-full shrink-0"
              style={{
                width: PREVIEW_W_EFF,
                height: PREVIEW_H,
              }}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              {bgImage ? (
                <div
                  className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                  style={{ backgroundImage: `url(${bgImage})` }}
                />
              ) : (
                <>
                  <div
                    className="absolute inset-0 scale-110 bg-cover bg-center bg-no-repeat blur-md opacity-75"
                    style={{ backgroundImage: `url(${placeholderArt})` }}
                  />
                  <div className="absolute inset-0 bg-black/50" />
                  <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center pointer-events-none px-3 text-center">
                    <p className="text-white font-bold text-sm drop-shadow-md">
                      Envie a sua arte aqui
                    </p>
                    <p className="text-[#fff200] font-semibold text-xs mt-1 drop-shadow-md">
                      Tamanho para impressão: {placeholderSizeHint}
                    </p>
                  </div>
                </>
              )}
              {/* QR com moldura fina branca + contorno escuro */}
              <div
                ref={qrSvgWrapperRef}
                onPointerDown={handlePointerDown("qr")}
                className={`absolute z-[2] select-none touch-none bg-white box-border border border-neutral-900 ${locked ? "cursor-not-allowed" : "cursor-move"}`}
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
                  value={url}
                  size={qrCorePxPreview}
                  level="M"
                  includeMargin={false}
                  style={{ display: "block" }}
                />
              </div>

              {/* Footer band, draggable */}
              {effShowFooter && (
                <div
                  onPointerDown={handlePointerDown("footer")}
                  className={`absolute z-[2] left-0 right-0 select-none touch-none bg-primary/95 leading-none px-2 py-0 flex items-center justify-between overflow-hidden whitespace-nowrap ${locked ? "cursor-not-allowed" : "cursor-row-resize"}`}
                  style={{
                    top: footerTopPreview,
                    height: footerHPreview,
                    minHeight: footerHPreview,
                    maxHeight: footerHPreview,
                    fontSize: footerFontPreview,
                    color: "#fff200",
                    fontWeight: 700,
                  }}
                >
                  <span>{footerLeftPreview}</span>
                  <span className="shrink-0 pl-1">{footerRightPreview}</span>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground text-center max-w-[320px]">
              {locked
                ? "Layout travado — bate 1:1 com a impressão."
                : "Arraste o QR ou a faixa de rodapé. Use os sliders para ajuste fino."}
            </p>

            {/* Link direto do WhatsApp — alternativa ao QR para quem quer copiar/colar */}
            <PartnerLinkCard url={url} phrase={phrase} isShort={!!shortLink} />
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-4 min-w-0">
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
                  {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5 text-primary" />}
                  {locked
                    ? "Layout travado — clique para destravar e ajustar"
                    : "Layout destravado — clique para travar de novo"}
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label className="text-sm">Imagem de fundo</Label>
              {!template.src && (
                <p className="text-xs text-muted-foreground leading-snug">
                  Este formato não tem arte pronta. Envie a sua imagem no tamanho
                  mostrado no preview (exemplo embaçado).
                </p>
              )}
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
                  disabled={
                    locked ||
                    (template.src ? bgImage === template.src : !bgImage)
                  }
                >
                  <ImageIcon className="h-4 w-4" />{" "}
                  {template.src ? "Usar template padrão" : "Voltar ao exemplo de tamanho"}
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
                Ao escanear o QR ou abrir o link, abre WhatsApp com:{" "}
                <span className="font-medium">&quot;{phrase}&quot;</span>
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button
            variant="default"
            onClick={handleSendWhatsApp}
            disabled={sharingWa}
            className="gap-2"
          >
            {sharingWa ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Share2 className="h-4 w-4" />
            )}
            Enviar no WhatsApp (alta qualidade)
          </Button>
          <Button variant="outline" onClick={handleDownload} className="gap-2">
            <Download className="h-4 w-4" /> Baixar PNG
          </Button>
          <Button onClick={handleDownloadPDF} className="gap-2" variant="outline">
            <FileText className="h-4 w-4" />
            Baixar PDF ({TEMPLATE_DIMS[templateId].pdfWmm}×{TEMPLATE_DIMS[templateId].pdfHmm}mm)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Cartão com o link do WhatsApp pronto pra copiar/abrir — fica ao lado do QR
 * pra atender quem prefere mandar o link no lugar de escanear o QR code.
 */
function PartnerLinkCard({
  url,
  phrase,
  isShort,
}: {
  url: string;
  phrase: string;
  isShort: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore — alguns browsers bloqueiam sem HTTPS; usuário pode copiar manual
    }
  };
  return (
    <div className="w-full max-w-full sm:max-w-[320px] rounded-lg border bg-card p-2.5 space-y-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {isShort ? "Link curto para compartilhar" : "Link direto para WhatsApp"}
      </div>
      <div className="text-[11px] break-all font-mono leading-snug text-foreground/90 bg-muted/40 rounded px-2 py-1.5">
        {url}
      </div>
      <div className="flex gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={copied ? "default" : "outline"}
          onClick={handleCopy}
          className="flex-1 gap-1.5 h-8 text-xs"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copiado!" : "Copiar link"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          asChild
          className="flex-1 gap-1.5 h-8 text-xs"
        >
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5" /> Abrir
          </a>
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground leading-snug">
        Link curto <span className="font-medium">igreen.cloud</span> — no
        celular abre o WhatsApp na hora, já com a frase{" "}
        <span className="font-medium">"{phrase}"</span>.
      </p>
    </div>
  );
}
