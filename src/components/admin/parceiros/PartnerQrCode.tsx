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
import { Download, Upload, Trash2, ImageIcon, FileText, Lock, Unlock, Copy, ExternalLink, Check } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import jsPDF from "jspdf";
import { resolveQrMessage } from "./qrPhrase";

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

/** Domínio público do portal (mesmo usado em orçamentos/propostas). */
const PUBLIC_BASE = "https://igreen.cloud";

/**
 * Monta o LINK CURTO com a MARCA do portal: `igreen.cloud/r/{ref}/{short_code}`.
 *
 * `ref` é, de preferência, o **ID iGreen do consultor** (numérico e neutro,
 * ex.: 122160) — não expõe o nome do consultor na URL. Quando o consultor não
 * tem `igreen_id` cadastrado, cai na licença (slug). O `short_code` é numérico
 * e neutro (ex.: 482917) — não expõe a keyword pessoal do parceiro.
 *
 * A rota `/r/...` no SPA redireciona pra `qr-redirect`, que resolve o consultor
 * por igreen_id (numérico) ou por licença (slug, legado), monta telefone +
 * frase (com a keyword dentro da mensagem do WhatsApp).
 *
 * Sem identificador ou sem código, devolve `null` (fallback pro wa.me direto).
 */
function buildShortLink(
  license?: string | null,
  shortCode?: string | null,
  consultantIgreenId?: string | null,
): string | null {
  // Prioriza o ID iGreen numérico (neutro); senão, usa a licença (slug).
  const ref = (consultantIgreenId ?? "").trim() || (license ?? "").trim();
  const code = (shortCode ?? "").trim();
  if (!ref || !code) return null;
  return `${PUBLIC_BASE}/r/${encodeURIComponent(ref)}/${encodeURIComponent(code)}`;
}

/**
 * Modelos de impressão. Cada modelo tem proporção física FIXA: a arte enviada
 * é sempre recortada (cover) para caber exatamente no tamanho de impressão, sem
 * distorcer e sem mudar a proporção. O PDF sai no tamanho físico real (mm).
 *
 *  - a4:       210×297mm   (folha sulfite, arte oficial)
 *  - banner:   504×940mm   (banner vertical, arte oficial)
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
  }
> = {
  a4: {
    label: "Folha A4",
    src: "/images/mutirao-lei-14300-parceiro.jpg",
    qrX: 25,
    qrY: 91,
    qrSize: 18,
    footerY: 99,
  },
  banner: {
    label: "Banner 504×940mm",
    src: "/images/banner-lei-14300-base.jpg",
    qrX: 22,
    qrY: 87,
    qrSize: 28,
    footerY: 99,
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
): string {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.startsWith("55") ? digits : `55${digits}`;
  const message = resolveQrMessage(qrPhrase, keyword);
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
  banner: { canvasW: 1008, canvasH: 1881, pdfWmm: 504, pdfHmm: 940 }, // 504×940mm (retrato)
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
// Altura máxima do preview para caber em telas de notebook sem scroll.
// Templates muito altos (ex.: Banner 504×940mm) são reduzidos até esse teto.
const PREVIEW_MAX_H = 440;

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
  const phrase = resolveQrMessage(qrPhrase, keyword);
  // Link curto com marca: igreen.cloud/r/{ref}/{short_code}, onde ref é o ID
  // iGreen do consultor (neutro) ou a licença (fallback). Sem identificador ou
  // código (parceiro antigo sem backfill), cai no wa.me direto como fallback.
  const shortLink = buildShortLink(license, shortCode, consultantIgreenId);
  const url = shortLink ?? buildWaMeUrl(consultantPhone, keyword, qrPhrase);

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

  const [unlockedMap, setUnlockedMap] = useState<Record<TemplateId, boolean>>(
    () =>
      Object.fromEntries(
        (Object.keys(TEMPLATES) as TemplateId[]).map((id) => [id, false]),
      ) as Record<TemplateId, boolean>,
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
    const orientation = wmm > hmm ? "landscape" : "portrait";
    const pdf = new jsPDF({ orientation, unit: "mm", format: [wmm, hmm] });
    // O canvas de cada template já tem a proporção física EXATA do papel, então
    // a arte preenche a página inteira sem esticar e sem barras (borda do lado).
    const imgData = canvas.toDataURL("image/png");
    pdf.addImage(imgData, "PNG", 0, 0, wmm, hmm);
    pdf.save(`flyer-${templateId}-${partnerName.toLowerCase().replace(/[^a-z0-9]/g, "-")}.pdf`);
  };

  // Preview com proporção real do template, mas limitado por largura E altura
  // para caber numa tela de notebook sem scroll. Templates altos (ex.: Banner
  // 504×940mm) seriam grandes demais se calculássemos só pela largura, então
  // reduzimos proporcionalmente até respeitar a altura máxima.
  const previewAspect =
    TEMPLATE_DIMS[templateId].canvasH / TEMPLATE_DIMS[templateId].canvasW;
  let previewW = PREVIEW_W;
  let previewH = PREVIEW_W * previewAspect;
  if (previewH > PREVIEW_MAX_H) {
    previewH = PREVIEW_MAX_H;
    previewW = previewH / previewAspect;
  }
  const PREVIEW_W_EFF = Math.round(previewW);
  const PREVIEW_H = Math.round(previewH);

  // Preview-space sizes (percentages → pixels).
  const qrCorePxPreview = (effQrSize / 100) * PREVIEW_W_EFF;
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
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
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
              className="relative overflow-hidden rounded-xl border bg-primary shadow-sm"
              style={{
                width: PREVIEW_W_EFF,
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
                  className={`absolute left-0 right-0 select-none touch-none bg-primary/95 flex items-center justify-between leading-tight px-2 ${locked ? "cursor-not-allowed" : "cursor-row-resize"}`}
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

            {/* Link direto do WhatsApp — alternativa ao QR para quem quer copiar/colar */}
            <PartnerLinkCard url={url} phrase={phrase} isShort={!!shortLink} />
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
                  {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5 text-primary" />}
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
                Ao escanear o QR ou abrir o link, abre WhatsApp com:{" "}
                <span className="font-medium">&quot;{phrase}&quot;</span>
              </p>
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
    <div className="w-full max-w-[320px] rounded-lg border bg-card p-2.5 space-y-2">
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
        Cole esse link em status, story, bio do Instagram ou em qualquer
        mensagem.{" "}
        {isShort ? (
          <>
            Ele é curto e redireciona pro WhatsApp já com a frase{" "}
            <span className="font-medium">"{phrase}"</span>.
          </>
        ) : (
          <>
            Abre o WhatsApp já com a frase{" "}
            <span className="font-medium">"{phrase}"</span>.
          </>
        )}
      </p>
    </div>
  );
}
