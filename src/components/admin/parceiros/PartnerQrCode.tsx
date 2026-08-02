import { useEffect, useRef, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Download, Upload, Trash2, ImageIcon, FileText, Lock, Unlock, Copy, ExternalLink, Check, Share2, Loader2, QrCode } from "lucide-react";
import { downloadQrOnlyPng } from "@/components/admin/qrOnlyDownload";
import { QRCodeSVG } from "qrcode.react";
import jsPDF from "jspdf";
import {
  drawFlyerFooter,
  clampFooterBand,
  previewFooterFontSize,
} from "@/components/admin/flyerFooter";
import {
  drawImageCover,
  drawQrWithThinFrame,
} from "@/components/admin/flyerCanvasDraw";
import { formatFlyerPhoneDisplay } from "@/components/admin/flyerPhoneDisplay";
import {
  FLYER_PREVIEW_MAX_H,
  FLYER_PREVIEW_W,
  FLYER_QR_BORDER_PX,
  FLYER_QR_QUIET_PX,
  FLYER_TEMPLATES,
  type FlyerFormatId,
} from "@/components/admin/flyerTemplates";
import {
  resolveQrMessage,
  buildDefaultQrPhrase,
  QR_PHRASE_MAX,
  isGenericKeyword,
} from "./qrPhrase";
import {
  templatePlaceholderArt,
  templateSizeHint,
  drawFlyerPlaceholderBackground,
} from "@/components/admin/flyerPlaceholder";
import { useFlyerPreviewSize } from "@/components/admin/flyerPreviewSize";
import { useIsMobile } from "@/hooks/use-mobile";

import { buildPartnerPublicShortLink } from "@/lib/partnerShortLink";
import { useToast } from "@/hooks/use-toast";
import { HelpHint } from "@/components/ui/help-hint";

interface PartnerQrCodeProps {
  open: boolean;
  onClose: () => void;
  partnerName: string;
  keyword: string;
  /** Todas as palavras-chave do parceiro — permite trocar e baixar vários banners. */
  keywords?: string[];
  consultantPhone: string;
  consultantName?: string;
  consultantIgreenId?: string;
  qrPhrase?: string | null;
  /** Licença do consultor — slug na URL curta (`/r/{licenca}/...`). */
  license?: string | null;
  /** Código numérico do parceiro (gerado no banco) — vai na URL curta. */
  shortCode?: string | null;
  /** Código do local (?s=) — banner nomeado do parceiro. */
  spotCode?: string | null;
  /** Ao baixar com keyword nova, persiste no parceiro. */
  onSaveKeyword?: (keyword: string) => Promise<void>;
}

/**
 * Link curto com marca: `igreen.cloud/r/{ref}/{code}`.
 * No celular o `index.html` redireciona na hora pra edge → WhatsApp (sem site).
 */
function buildShortLink(
  license?: string | null,
  shortCode?: string | null,
  consultantIgreenId?: string | null,
  keyword?: string | null,
  msg?: string | null,
  spot?: string | null,
): string | null {
  const ref = (consultantIgreenId ?? "").trim() || (license ?? "").trim();
  const code = (shortCode ?? "").trim();
  if (!ref || !code) return null;
  return buildPartnerPublicShortLink(ref, code, { keyword, msg, spot });
}

/**
 * Modelos de impressão — fonte: FLYER_TEMPLATES (A4 + Banner 504×904).
 */
type TemplateId = FlyerFormatId;

const TEMPLATES: Record<
  TemplateId,
  {
    label: string;
    src: string | null;
    qrX: number;
    qrY: number;
    qrSize: number;
    footerY: number;
    footerH?: number;
  }
> = {
  a4: {
    label: FLYER_TEMPLATES.a4.label,
    src: FLYER_TEMPLATES.a4.bg,
    qrX: FLYER_TEMPLATES.a4.qrX,
    qrY: FLYER_TEMPLATES.a4.qrY,
    qrSize: FLYER_TEMPLATES.a4.qrSize,
    footerY: FLYER_TEMPLATES.a4.footerY,
    footerH: FLYER_TEMPLATES.a4.footerH,
  },
  banner: {
    label: FLYER_TEMPLATES.banner.label,
    src: FLYER_TEMPLATES.banner.bg,
    qrX: FLYER_TEMPLATES.banner.qrX,
    qrY: FLYER_TEMPLATES.banner.qrY,
    qrSize: FLYER_TEMPLATES.banner.qrSize,
    footerY: FLYER_TEMPLATES.banner.footerY,
    footerH: FLYER_TEMPLATES.banner.footerH,
  },
};
const DEFAULT_TEMPLATE_ID: TemplateId = "a4";

/**
 * Layouts com arte oficial começam travados (impresso bate 1:1 com o preview).
 */
const DEFAULT_LOCKED: Record<TemplateId, boolean> = {
  a4: true,
  banner: true,
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

const formatPhoneDisplay = formatFlyerPhoneDisplay;

/**
 * Dimensões físicas e de canvas por template. O canvas usa a proporção
 * nativa da arte (sem corte/distorção). O PDF usa o tamanho físico real.
 */
const TEMPLATE_DIMS: Record<
  TemplateId,
  { canvasW: number; canvasH: number; pdfWmm: number; pdfHmm: number }
> = {
  a4: {
    canvasW: FLYER_TEMPLATES.a4.canvasW,
    canvasH: FLYER_TEMPLATES.a4.canvasH,
    pdfWmm: FLYER_TEMPLATES.a4.pdfWmm,
    pdfHmm: FLYER_TEMPLATES.a4.pdfHmm,
  },
  banner: {
    canvasW: FLYER_TEMPLATES.banner.canvasW,
    canvasH: FLYER_TEMPLATES.banner.canvasH,
    pdfWmm: FLYER_TEMPLATES.banner.pdfWmm,
    pdfHmm: FLYER_TEMPLATES.banner.pdfHmm,
  },
};
const PREVIEW_W = FLYER_PREVIEW_W;
const PREVIEW_MAX_H = FLYER_PREVIEW_MAX_H;
/** Margem branca interna + moldura fina ao redor do QR (preview, px). */
const QR_QUIET_PX = FLYER_QR_QUIET_PX;
const QR_BORDER_PX = FLYER_QR_BORDER_PX;

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
  keywords = [],
  consultantPhone,
  consultantName = "",
  consultantIgreenId = "",
  qrPhrase,
  license,
  shortCode,
  spotCode = null,
  onSaveKeyword,
}: PartnerQrCodeProps) {
  const keywordOptions = Array.from(
    new Set(
      [...keywords, keyword]
        .map((k) => (k ?? "").trim())
        .filter(Boolean),
    ),
  );
  const [selectedKeyword, setSelectedKeyword] = useState(
    () => keywordOptions[0] || keyword || "",
  );
  /** Frase custom só para este download (não grava no banco). */
  const [customPhrase, setCustomPhrase] = useState("");
  const [useCustomPhrase, setUseCustomPhrase] = useState(false);
  const [newKeywordDraft, setNewKeywordDraft] = useState("");

  // Ao reabrir o modal, alinha a keyword selecionada ao parceiro atual.
  useEffect(() => {
    if (!open) return;
    const opts = Array.from(
      new Set(
        [...keywords, keyword]
          .map((k) => (k ?? "").trim())
          .filter(Boolean),
      ),
    );
    setSelectedKeyword(opts[0] || keyword || "");
    setCustomPhrase("");
    setUseCustomPhrase(false);
    setNewKeywordDraft("");
  }, [open, keyword, keywords]);

  const activeKeyword = selectedKeyword.trim() || keyword || "";
  const phraseSource = useCustomPhrase
    ? customPhrase.trim() || null
    : qrPhrase;
  // `phrase` é a mensagem que o lead vai ver no WhatsApp (exibida no card).
  // Inclui o marcador `#R{short_code}` quando há short_code — esse é o sinal
  // determinístico que o webhook usa para atribuir o lead a este parceiro
  // mesmo se o lead apagar/editar o resto da mensagem.
  const phrase = resolveQrMessage(phraseSource, activeKeyword, shortCode);
  // Link curto com marca (igreen.cloud/r/...) — bounce imediato → WhatsApp.
  // O short_code atribui o parceiro; a keyword (`?k=`) muda o texto/local.
  // Frase custom neste download vai em `?msg=` (precisa baixar de novo).
  // Frase permanente sem reimprimir: editar o parceiro → "Frase QR Code".
  const shortLink = buildShortLink(
    license,
    shortCode,
    consultantIgreenId,
    activeKeyword,
    useCustomPhrase ? phrase : null,
    spotCode,
  );
  const url =
    shortLink ??
    buildWaMeUrl(consultantPhone, activeKeyword, phraseSource, shortCode);
  const { toast } = useToast();
  const [sharingWa, setSharingWa] = useState(false);
  const [savingKw, setSavingKw] = useState(false);

  const persistKeywordIfNeeded = async (): Promise<boolean> => {
    const kw = activeKeyword.trim();
    if (!kw || !onSaveKeyword) return true;
    const known = keywordOptions.some(
      (k) => k.trim().toLowerCase() === kw.toLowerCase(),
    );
    if (known) return true;
    if (isGenericKeyword(kw)) {
      toast({
        title: "Palavra-chave genérica demais",
        description: "Use algo único do local / parceiro.",
        variant: "destructive",
      });
      return false;
    }
    setSavingKw(true);
    try {
      await onSaveKeyword(kw);
      toast({
        title: "Palavra-chave salva no parceiro",
        description: `"${kw}" — assim você sabe de qual banner/local veio o lead.`,
      });
      return true;
    } catch (err: unknown) {
      toast({
        title: "Não foi possível salvar a palavra-chave",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
      return false;
    } finally {
      setSavingKw(false);
    }
  };

  const applyNewKeywordDraft = () => {
    const kw = newKeywordDraft.trim();
    if (!kw) return;
    if (isGenericKeyword(kw)) {
      toast({
        title: "Palavra-chave genérica demais",
        description: "Use algo único do parceiro (ex.: nome + cidade).",
        variant: "destructive",
      });
      return;
    }
    setSelectedKeyword(kw);
    setNewKeywordDraft("");
  };

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
      const digital = false;
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

  const slugName = partnerName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const slugKw = activeKeyword
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const fileBase = `flyer-${templateId}-${slugName}${slugKw ? `-${slugKw}` : ""}`;

  const handleDownload = async () => {
    if (!(await persistKeywordIfNeeded())) return;
    const canvas = await renderToCanvas();
    if (!canvas) return;
    const a = document.createElement("a");
    a.download = `${fileBase}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  };

  const handleDownloadPDF = async () => {
    if (!(await persistKeywordIfNeeded())) return;
    const canvas = await renderToCanvas();
    if (!canvas) return;
    const { pdfWmm: wmm, pdfHmm: hmm } = TEMPLATE_DIMS[templateId];
    const orientation = wmm > hmm ? "landscape" : "portrait";
    const pdf = new jsPDF({ orientation, unit: "mm", format: [wmm, hmm] });
    // O canvas de cada template já tem a proporção física EXATA do papel, então
    // a arte preenche a página inteira sem esticar e sem barras (borda do lado).
    const imgData = canvas.toDataURL("image/png");
    pdf.addImage(imgData, "PNG", 0, 0, wmm, hmm);
    pdf.save(`${fileBase}.pdf`);
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
      const fileName = `${fileBase}.png`;
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
  const isMobileQr = useIsMobile();
  const { width: PREVIEW_W_EFF, height: PREVIEW_H } = useFlyerPreviewSize(
    dims.canvasW,
    dims.canvasH,
    isMobileQr ? 240 : PREVIEW_W,
    isMobileQr ? 240 : PREVIEW_MAX_H,
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

  const isDigitalTemplate = false;
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
      <DialogContent className="w-[calc(100%-1rem)] sm:w-full max-w-3xl max-h-[90dvh] overflow-y-auto p-3 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            QR do parceiro: {partnerName}
            <HelpHint
              size={14}
              title="Como funciona este QR"
              summary="Toque no ? para entender o que acontece se trocar o WhatsApp ou a frase"
              details={
                "1) O QR aponta para o WhatsApp do consultor que está conectado agora. Se trocar o número, o mesmo QR continua válido.\n\n" +
                "2) A palavra (ex.: Daniel) é como o sistema sabe que o lead veio deste banner.\n\n" +
                "3) Para mudar a frase SEM reimprimir: volte → Editar parceiro → Frase que abre no WhatsApp → Salvar.\n\n" +
                "4) Nesta tela, marque \"Trocar a frase só para este banner\" para personalizar APENAS este download."
              }
              example="Link do Daniel: igreen.cloud/r/130392/365524?k=Daniel — o código 365524 é do parceiro; o telefone não fica no papel."
            />
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Toque no <span className="font-semibold">?</span> ao lado do título
            para ver dicas sobre troca de frase, WhatsApp e impressão.
          </DialogDescription>
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
            <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/30 p-3">
              <div className="flex items-center gap-1.5">
                <Label className="text-sm">Palavra que identifica este banner</Label>
                <HelpHint
                  size={13}
                  title="Palavra que identifica o banner"
                  summary="Escolha como o sistema vai saber que o lead veio deste banner"
                  details={
                    "Escolha ou digite uma palavra (ex.: Daniel, Posto Shell). Ela entra no link e na frase do WhatsApp.\n\n" +
                    "Trocar a palavra e baixar de novo gera outro material — o parceiro continua o mesmo (o código na URL não muda)."
                  }
                  example="Daniel → igreen.cloud/r/.../365524?k=Daniel"
                />
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Troque a palavra e baixe de novo para criar vários banners
                diferentes. Todos vão atribuir o lead ao mesmo parceiro.
              </p>
              {keywordOptions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {keywordOptions.map((kw) => (
                    <Button
                      key={kw}
                      type="button"
                      size="sm"
                      variant={selectedKeyword === kw ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => {
                        setSelectedKeyword(kw);
                        if (useCustomPhrase) {
                          setCustomPhrase(buildDefaultQrPhrase(kw));
                        }
                      }}
                    >
                      {kw}
                    </Button>
                  ))}
                </div>
              )}
              <div className="flex gap-1.5">
                <Input
                  value={newKeywordDraft}
                  onChange={(e) => setNewKeywordDraft(e.target.value)}
                  placeholder="Outra palavra / frase só neste banner"
                  className="h-8 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyNewKeywordDraft();
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0"
                  onClick={applyNewKeywordDraft}
                  disabled={!newKeywordDraft.trim()}
                >
                  Usar
                </Button>
              </div>
              {selectedKeyword && !keywordOptions.includes(selectedKeyword) && (
                <p className="text-[11px] text-primary">
                  Usando agora: <strong>{selectedKeyword}</strong>
                </p>
              )}

              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer mt-1">
                <input
                  type="checkbox"
                  checked={useCustomPhrase}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setUseCustomPhrase(on);
                    if (on && !customPhrase.trim()) {
                      setCustomPhrase(
                        buildDefaultQrPhrase(activeKeyword).replace(
                          /\s*#R\d+\s*$/i,
                          "",
                        ),
                      );
                    }
                  }}
                  className="h-3.5 w-3.5 rounded border-input"
                />
                <span className="flex items-center gap-1">
                  Trocar a frase só para este banner
                  <HelpHint
                    size={12}
                    title="Onde editar a frase"
                    summary="Duas formas: mudar para sempre (sem reimprimir) ou só neste download"
                    details={
                      "• Para sempre (sem reimprimir): feche este modal → Editar parceiro → \"Frase que abre no WhatsApp\" → Salvar. Banners já impressos passam a usar a frase nova.\n\n" +
                      "• Só neste download: marque esta opção, escreva a frase e baixe de novo (a frase vai junto no link).\n\n" +
                      "Trocar o WhatsApp conectado não apaga o QR — o próximo scan usa o número novo."
                    }
                    example='Editar parceiro Daniel → Frase que abre no WhatsApp → "Vim pelo Daniel, quero economizar na luz"'
                  />
                </span>
              </label>
              {useCustomPhrase && (
                <div className="space-y-1">
                  <Textarea
                    value={customPhrase}
                    onChange={(e) => setCustomPhrase(e.target.value)}
                    rows={3}
                    maxLength={QR_PHRASE_MAX + 20}
                    placeholder="Frase que o cliente verá ao abrir o WhatsApp"
                    className="text-xs resize-none"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    A palavra-chave entra na frase automaticamente se faltar.
                    Limite ~{QR_PHRASE_MAX} caracteres (o marcador do parceiro
                    é acrescentado sozinho).
                  </p>
                </div>
              )}
            </div>

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
              <p className="text-[10px]">
                Dica: escolha outra palavra-chave acima e baixe de novo — cada
                arquivo fica com frase diferente; o parceiro continua o mesmo.
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
          <Button
            variant="outline"
            onClick={handleDownload}
            disabled={savingKw}
            className="gap-2"
          >
            <Download className="h-4 w-4" /> Baixar PNG
          </Button>
          <Button
            onClick={handleDownloadPDF}
            className="gap-2"
            variant="outline"
            disabled={savingKw}
          >
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
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {isShort ? "Link curto para compartilhar" : "Link direto para WhatsApp"}
        <HelpHint
          size={12}
          title="Link e WhatsApp"
          summary="O telefone não fica gravado no link"
          details={
            "Este link abre o WhatsApp do consultor que estiver conectado agora.\n\n" +
            "Se trocar o número no sistema, o mesmo link/QR continua funcionando — você não perde o material impresso.\n\n" +
            "Para mudar a frase sem reimprimir: edite o parceiro → Frase QR Code."
          }
        />
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
