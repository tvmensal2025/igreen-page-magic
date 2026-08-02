import { useMemo, useRef, useState } from "react";
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
import { FlyerStaticPreview } from "@/components/admin/FlyerStaticPreview";
import {
  drawImageCover,
  drawQrWithThinFrame,
  loadFlyerImage,
} from "@/components/admin/flyerCanvasDraw";
import { drawFlyerFooter } from "@/components/admin/flyerFooter";
import { formatFlyerPhoneDisplay } from "@/components/admin/flyerPhoneDisplay";
import {
  FLYER_TEMPLATES,
  flyerFooterLeft,
  flyerFooterRight,
  type FlyerFormatId,
} from "@/components/admin/flyerTemplates";
import { buildPartnerPublicShortLink } from "@/lib/partnerShortLink";
import { useToast } from "@/hooks/use-toast";

export type PortalDownloadTarget = {
  kind: "geral" | "local";
  name: string;
  code?: string;
  keyword?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  partnerName: string;
  shortCode: string;
  refLabel: string;
  consultantName: string;
  consultantIgreenId: string;
  consultantPhone: string;
  target: PortalDownloadTarget | null;
};

/**
 * Modal só-download no portal público do parceiro.
 * Calibração 1:1 via FLYER_TEMPLATES + FlyerStaticPreview.
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
  const [format, setFormat] = useState<FlyerFormatId>("a4");
  const [busy, setBusy] = useState<"png" | "pdf" | "both" | null>(null);
  const qrSvgRef = useRef<HTMLDivElement>(null);

  const template = FLYER_TEMPLATES[format];

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

  const footerLeft = flyerFooterLeft(consultantName, consultantIgreenId);
  const footerRight = flyerFooterRight(
    formatFlyerPhoneDisplay(consultantPhone),
  );

  const fileSlug = (formatId: FlyerFormatId = format) => {
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
    return `${formatId}-${partner || "parceiro"}-${spot}`;
  };

  const renderFormatToCanvas = async (
    formatId: FlyerFormatId,
  ): Promise<HTMLCanvasElement | null> => {
    const svgEl = qrSvgRef.current?.querySelector("svg");
    if (!svgEl || !liveUrl) return null;
    const t = FLYER_TEMPLATES[formatId];
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
      const bg = await loadFlyerImage(t.bg);
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

  const downloadPngOf = async (formatId: FlyerFormatId) => {
    const canvas = await renderFormatToCanvas(formatId);
    if (!canvas) return false;
    const a = document.createElement("a");
    a.download = `${fileSlug(formatId)}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
    return true;
  };

  const handleDownloadPng = async () => {
    setBusy("png");
    try {
      const ok = await downloadPngOf(format);
      if (ok) toast({ title: "PNG baixado!" });
      else
        toast({
          title: "Não foi possível gerar o PNG",
          variant: "destructive",
        });
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadPdf = async () => {
    setBusy("pdf");
    try {
      const canvas = await renderFormatToCanvas(format);
      if (!canvas) {
        toast({
          title: "Não foi possível gerar o PDF",
          variant: "destructive",
        });
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

  const handleDownloadQrOnly = async () => {
    setBusy("qr");
    try {
      const svgEl = qrSvgRef.current?.querySelector("svg");
      const ok = await downloadQrOnlyPng(svgEl, fileSlug());
      toast(
        ok
          ? { title: "QR Code baixado!" }
          : {
              title: "Não foi possível gerar o QR Code",
              variant: "destructive",
            },
      );
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
            {(Object.keys(FLYER_TEMPLATES) as FlyerFormatId[]).map((id) => (
              <Button
                key={id}
                type="button"
                size="sm"
                variant={format === id ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setFormat(id)}
                disabled={!!busy}
              >
                {FLYER_TEMPLATES[id].label}
              </Button>
            ))}
          </div>

          <FlyerStaticPreview
            format={format}
            liveUrl={liveUrl}
            consultantName={consultantName}
            consultantIgreenId={consultantIgreenId}
            consultantPhone={consultantPhone}
            qrSvgRef={qrSvgRef}
          />

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
