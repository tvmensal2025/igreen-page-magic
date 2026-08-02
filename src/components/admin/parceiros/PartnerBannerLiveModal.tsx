import { useEffect, useMemo, useState } from "react";
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
import { FlyerStaticPreview } from "@/components/admin/FlyerStaticPreview";
import {
  FLYER_TEMPLATES,
  type FlyerFormatId,
} from "@/components/admin/flyerTemplates";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { buildPartnerPublicShortLink } from "@/lib/partnerShortLink";
import { buildDefaultQrPhrase, QR_PHRASE_MAX } from "./qrPhrase";
import type { PartnerBannerSpot } from "./PartnerBannersPanel";
import type { ReferralPartner } from "./hooks/useReferralPartners";

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
  const [phrase, setPhrase] = useState("");
  const [saving, setSaving] = useState(false);
  const [format, setFormat] = useState<FlyerFormatId>("a4");

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
      const next = phrase.trim().slice(0, QR_PHRASE_MAX) || null;
      if (spot) {
        const { data, error } = await supabase
          .from("referral_partner_banner_spots" as never)
          .update({
            phrase: next,
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id", spot.id)
          .select("phrase")
          .maybeSingle();
        if (error) throw error;
        const savedPhrase = (data as { phrase?: string | null } | null)?.phrase ?? null;
        if (!data || savedPhrase !== next) throw new Error("A frase do banner não foi confirmada pelo banco.");
      } else {
        const { data, error } = await supabase
          .from("referral_partners")
          .update({ qr_phrase: next } as never)
          .eq("id", partner.id)
          .select("qr_phrase")
          .maybeSingle();
        if (error) throw error;
        if (!data || data.qr_phrase !== next) throw new Error("A frase do parceiro não foi confirmada pelo banco.");
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
              {(Object.keys(FLYER_TEMPLATES) as FlyerFormatId[]).map((id) => (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={format === id ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setFormat(id)}
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
            />

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

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="gap-1.5"
            disabled={!liveUrl}
            onClick={() => onDownloadQr(phrase)}
          >
            <Download className="h-4 w-4" />
            Baixar QR (editor)
          </Button>
          <Button
            type="button"
            className="gap-1.5"
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
