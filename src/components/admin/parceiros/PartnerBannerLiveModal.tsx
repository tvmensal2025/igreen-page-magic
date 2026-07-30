import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Download, Loader2, Pencil, QrCode } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useFlyerPreviewSize } from "@/components/admin/flyerPreviewSize";
import {
  clampFooterBand,
  previewFooterFontSize,
} from "@/components/admin/flyerFooter";
import { buildPartnerPublicShortLink } from "@/lib/partnerShortLink";
import {
  buildDefaultQrPhrase,
  QR_PHRASE_MAX,
} from "./qrPhrase";
import type { PartnerBannerSpot } from "./PartnerBannersPanel";
import type { ReferralPartner } from "./hooks/useReferralPartners";

type PreviewFormat = "a4" | "banner";

/**
 * Preview = clone visual do PartnerQrCode (download oficial).
 * Mesmas artes, canvas, QR %, rodapé e estrutura HTML.
 */
const PREVIEW: Record<
  PreviewFormat,
  {
    label: string;
    bg: string;
    canvasW: number;
    canvasH: number;
    qrX: number;
    qrY: number;
    qrSize: number;
    footerY: number;
    footerH: number;
  }
> = {
  a4: {
    label: "Folha A4",
    bg: "/images/banner-a4.jpg",
    canvasW: 1240,
    canvasH: 1754,
    qrX: 25,
    qrY: 91,
    qrSize: 16,
    footerY: 99,
    footerH: 2.6,
  },
  banner: {
    label: "Banner 504×904mm",
    bg: "/images/banner-504x904.jpg",
    canvasW: 1008,
    canvasH: 1808,
    qrX: 15,
    qrY: 89,
    qrSize: 23,
    footerY: 100,
    footerH: 3,
  },
};

const QR_QUIET_PX = 2;
const QR_BORDER_PX = 1;
const PREVIEW_W = 320;
const PREVIEW_MAX_H = 440;

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

interface Props {
  open: boolean;
  onClose: () => void;
  partner: ReferralPartner;
  spot: PartnerBannerSpot | null;
  license?: string | null;
  consultantIgreenId?: string;
  consultantName?: string;
  consultantPhone?: string;
  onSaved: () => void;
  onDownloadQr: (currentPhrase: string) => void;
}

export function PartnerBannerLiveModal({
  open,
  onClose,
  partner,
  spot,
  license = "",
  consultantIgreenId = "",
  consultantName = "",
  consultantPhone = "",
  onSaved,
  onDownloadQr,
}: Props) {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [phrase, setPhrase] = useState("");
  const [saving, setSaving] = useState(false);
  const [format, setFormat] = useState<PreviewFormat>("a4");

  const ref =
    String(consultantIgreenId || "").replace(/\D/g, "") ||
    String(license || "").trim();
  const shortCode = String(partner.short_code || "").trim();

  const liveUrl = useMemo(() => {
    if (!ref || !shortCode) return "";
    if (spot) {
      return buildPartnerPublicShortLink(ref, shortCode, {
        keyword: spot.keyword,
        spot: spot.code,
      });
    }
    return buildPartnerPublicShortLink(ref, shortCode);
  }, [ref, shortCode, spot]);

  const titleName = spot
    ? spot.keyword || spot.code
    : "Banner Geral do parceiro";

  const template = PREVIEW[format];
  const { width: previewW, height: previewH } = useFlyerPreviewSize(
    template.canvasW,
    template.canvasH,
    isMobile ? 240 : PREVIEW_W,
    isMobile ? 240 : PREVIEW_MAX_H,
  );

  // Oficial PartnerQrCode: qrSize = % da LARGURA.
  const qrCorePx = (template.qrSize / 100) * previewW;
  const qrFramePx = qrCorePx + QR_QUIET_PX * 2 + QR_BORDER_PX * 2;

  const footerLeft = consultantName
    ? `LICENCIADO: ${consultantName.toUpperCase()}${consultantIgreenId ? ` • ID ${consultantIgreenId}` : ""}`
    : "LICENCIADO: (preencha em Configurações)";
  const footerRight = consultantPhone
    ? `WHATSAPP: ${formatPhoneDisplay(consultantPhone)}`
    : "WHATSAPP: —";
  const { bandTop: footerTop, bandHeight: footerHPx } = clampFooterBand(
    previewH,
    template.footerY,
    template.footerH,
  );
  const footerFont = previewFooterFontSize(
    previewW,
    footerHPx,
    footerLeft,
    footerRight,
    "700",
  );

  useEffect(() => {
    if (!open) return;
    setFormat("a4");
    if (spot) {
      setPhrase(spot.phrase || buildDefaultQrPhrase(spot.keyword));
    } else {
      setPhrase(
        String(partner.qr_phrase || "").trim() ||
          buildDefaultQrPhrase(
            partner.keywords?.[0]?.trim() || partner.nome || "parceiro",
          ),
      );
    }
  }, [open, spot, partner.qr_phrase, partner.keywords, partner.nome]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const next = phrase.trim().slice(0, QR_PHRASE_MAX + 40) || null;
      if (spot) {
        const { error } = await supabase
          .from("referral_partner_banner_spots" as never)
          .update({
            phrase: next,
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id", spot.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("referral_partners")
          .update({ qr_phrase: next } as never)
          .eq("id", partner.id);
        if (error) throw error;
      }
      toast({
        title: "Frase salva",
        description:
          "Banners já impressos passam a abrir esta frase — sem reimprimir.",
      });
      onSaved();
    } catch (e: unknown) {
      toast({
        title: "Erro ao salvar frase",
        description: e instanceof Error ? e.message : "Tente de novo.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100%-1rem)] max-w-3xl max-h-[92dvh] overflow-y-auto p-3 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <QrCode className="h-5 w-5 text-primary" />
            Parceiro · {partner.nome}
          </DialogTitle>
          <DialogDescription>
            À esquerda: igual ao download/impressão. À direita: frase viva.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[auto_1fr] py-2 min-w-0">
          <div className="flex flex-col items-center gap-3 w-full min-w-0 max-w-full">
            <div className="flex flex-wrap gap-1.5 justify-center">
              {(Object.keys(PREVIEW) as PreviewFormat[]).map((id) => (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={format === id ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setFormat(id)}
                >
                  {PREVIEW[id].label}
                </Button>
              ))}
            </div>

            {/* Mesma estrutura do PartnerQrCode */}
            <div
              className="relative max-w-full shrink-0 overflow-hidden rounded-xl border bg-primary shadow-sm"
              style={{ width: previewW, height: previewH }}
            >
              <div
                className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                style={{ backgroundImage: `url(${template.bg})` }}
              />
              {liveUrl ? (
                <div
                  className="absolute z-[2] box-border select-none border border-neutral-900 bg-white"
                  style={{
                    left: `calc(${template.qrX}% - ${qrFramePx / 2}px)`,
                    top: `calc(${template.qrY}% - ${qrFramePx / 2}px)`,
                    width: qrFramePx,
                    height: qrFramePx,
                    padding: QR_QUIET_PX,
                    borderWidth: QR_BORDER_PX,
                  }}
                >
                  <QRCodeSVG
                    value={liveUrl}
                    size={qrCorePx}
                    level="M"
                    includeMargin={false}
                    style={{ display: "block" }}
                  />
                </div>
              ) : null}
              <div
                className="absolute left-0 right-0 z-[2] flex items-center justify-between overflow-hidden whitespace-nowrap bg-primary/95 px-2 py-0 leading-none select-none"
                style={{
                  top: footerTop,
                  height: footerHPx,
                  minHeight: footerHPx,
                  maxHeight: footerHPx,
                  fontSize: footerFont,
                  color: "#fff200",
                  fontWeight: 700,
                }}
              >
                <span>{footerLeft}</span>
                <span className="shrink-0 pl-1">{footerRight}</span>
              </div>
            </div>

            <p className="text-center text-[11px] font-medium text-foreground">
              {titleName}
            </p>
            <p className="max-w-[320px] break-all text-center font-mono text-[10px] text-muted-foreground">
              {liveUrl || "Sem link ainda — confira o código do parceiro."}
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="space-y-1.5 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
              <p>
                <strong>Link no papel:</strong> fixo (não mude depois de
                imprimir).
              </p>
              <p>
                <strong>Frase do WhatsApp:</strong> você muda abaixo a qualquer
                momento — panfleto já impresso atualiza sozinho.
              </p>
            </div>

            <div className="flex-1 space-y-2">
              <Label className="flex items-center gap-1.5 text-sm">
                <Pencil className="h-3.5 w-3.5" />
                Frase que abre no WhatsApp
              </Label>
              <Textarea
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                rows={5}
                className="resize-none text-sm"
                maxLength={QR_PHRASE_MAX + 40}
                placeholder="Ex.: Vim pelo Daniel, quero economizar na conta de luz"
              />
              <p className="text-[11px] text-muted-foreground">
                Salvar atualiza banners já impressos deste parceiro
                {spot ? ` / local “${spot.keyword}”` : ""}.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:gap-2">
          <Button
            type="button"
            variant="outline"
            className="w-full gap-1.5 sm:w-auto"
            disabled={!liveUrl}
            onClick={() => {
              onDownloadQr(phrase);
              onClose();
            }}
          >
            <Download className="h-4 w-4" />
            Baixar / imprimir
          </Button>
          <Button
            type="button"
            className="w-full gap-1.5 sm:w-auto"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Pencil className="h-4 w-4" />
            )}
            Salvar frase
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
