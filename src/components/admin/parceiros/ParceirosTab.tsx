import { useCallback, useEffect, useState } from "react";
import { PartnerDashboard } from "./PartnerDashboard";
import { PartnerForm } from "./PartnerForm";
import { PartnerQrCode } from "./PartnerQrCode";
import {
  ConsultantBannerDownloadModal,
  type BannerSpot,
} from "./ConsultantBannerDownloadModal";
import { ManualReviewQueueCard } from "./ManualReviewQueueCard";
import {
  useReferralPartners,
  type ReferralPartner,
} from "./hooks/useReferralPartners";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface ParceirosTabProps {
  consultantId: string;
  consultantPhone: string;
  consultantName?: string;
  consultantIgreenId?: string;
  license?: string | null;
}

export function ParceirosTab({
  consultantId,
  consultantPhone,
  consultantName = "",
  consultantIgreenId = "",
  license = "",
}: ParceirosTabProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState<ReferralPartner | null>(
    null,
  );
  const [qrPartner, setQrPartner] = useState<ReferralPartner | null>(null);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [bannerSpots, setBannerSpots] = useState<BannerSpot[]>([]);
  const [bannerDefaultPhrase, setBannerDefaultPhrase] = useState<string | null>(
    null,
  );
  const [whapiPhone, setWhapiPhone] = useState(consultantPhone);
  const { partners, create, update, remove, isLoading } = useReferralPartners();
  const { toast } = useToast();

  const loadConsultantBannerData = useCallback(async () => {
    if (!consultantId) return;
    const [{ data: cons }, { data: inst }, { data: spots }] = await Promise.all([
      supabase
        .from("consultants")
        .select("banner_keywords, banner_default_phrase, phone, igreen_id")
        .eq("id", consultantId)
        .maybeSingle(),
      supabase
        .from("whatsapp_instances")
        .select("connected_phone, updated_at")
        .eq("consultant_id", consultantId)
        .not("connected_phone", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("consultant_banner_spots")
        .select("id, code, keyword, phrase, is_active")
        .eq("consultant_id", consultantId)
        .eq("is_active", true)
        .order("created_at", { ascending: true }),
    ]);
    setBannerDefaultPhrase(
      String(
        (cons as { banner_default_phrase?: string | null } | null)
          ?.banner_default_phrase || "",
      ).trim() || null,
    );
    setBannerSpots((spots as BannerSpot[] | null) || []);
    const connected = String(inst?.connected_phone || "").replace(/\D/g, "");
    const fallback = String(
      consultantPhone || (cons as { phone?: string } | null)?.phone || "",
    ).replace(/\D/g, "");
    setWhapiPhone(connected || fallback);
  }, [consultantId, consultantPhone]);

  useEffect(() => {
    void loadConsultantBannerData();
  }, [loadConsultantBannerData]);

  const handleSave = (data: {
    nome: string;
    cli: string | null;
    keywords: string[];
    qr_phrase: string | null;
    partner_igreen_id: string | null;
    notification_phone: string | null;
  }) => {
    if (editingPartner) {
      update.mutate(
        { id: editingPartner.id, ...data },
        {
          onSuccess: () => {
            toast({ title: "Parceiro atualizado com sucesso!" });
            handleCloseForm();
          },
          onError: (err: any) =>
            toast({
              title: "Erro ao atualizar parceiro",
              description: err?.message || "Tente novamente.",
              variant: "destructive",
            }),
        },
      );
    } else {
      create.mutate(data, {
        onSuccess: () => {
          toast({ title: "Parceiro criado com sucesso!" });
          handleCloseForm();
        },
        onError: (err: any) =>
          toast({
            title: "Erro ao criar parceiro",
            description: err?.message || "Tente novamente.",
            variant: "destructive",
          }),
      });
    }
  };

  const handleDelete = (id: string) => {
    remove.mutate(id, {
      onSuccess: () => toast({ title: "Parceiro removido." }),
      onError: () =>
        toast({ title: "Erro ao remover parceiro", variant: "destructive" }),
    });
  };

  const handleEdit = (partner: ReferralPartner) => {
    setEditingPartner(partner);
    setFormOpen(true);
  };

  const handleCloseForm = () => {
    setFormOpen(false);
    setEditingPartner(null);
  };

  const handleSavePartnerKeyword = async (keyword: string) => {
    if (!qrPartner) return;
    const next = Array.from(
      new Set(
        [...(qrPartner.keywords ?? []), keyword.trim()].filter(Boolean),
      ),
    );
    await update.mutateAsync({ id: qrPartner.id, keywords: next });
    setQrPartner({ ...qrPartner, keywords: next });
  };

  return (
    <>
      <ManualReviewQueueCard consultantId={consultantId} />

      <PartnerDashboard
        partners={partners}
        isLoading={isLoading}
        onNew={() => setFormOpen(true)}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onQrCode={setQrPartner}
        onDownloadBanner={() => {
          void loadConsultantBannerData();
          setBannerOpen(true);
        }}
      />

      <PartnerForm
        open={formOpen}
        partner={editingPartner}
        onClose={handleCloseForm}
        onSave={handleSave}
        onDelete={handleDelete}
      />

      <ConsultantBannerDownloadModal
        open={bannerOpen}
        onClose={() => setBannerOpen(false)}
        consultantId={consultantId}
        consultantName={consultantName}
        consultantIgreenId={consultantIgreenId}
        consultantPhone={whapiPhone || consultantPhone}
        defaultPhrase={bannerDefaultPhrase}
        spots={bannerSpots}
        onSpotsChanged={() => {
          void loadConsultantBannerData();
        }}
      />

      <PartnerQrCode
        open={!!qrPartner}
        onClose={() => setQrPartner(null)}
        partnerName={qrPartner?.nome ?? ""}
        keyword={qrPartner?.keywords?.[0]?.trim() || qrPartner?.nome || ""}
        keywords={qrPartner?.keywords ?? []}
        consultantPhone={whapiPhone || consultantPhone}
        consultantName={consultantName}
        consultantIgreenId={consultantIgreenId}
        qrPhrase={qrPartner?.qr_phrase}
        license={license}
        shortCode={qrPartner?.short_code}
        onSaveKeyword={handleSavePartnerKeyword}
      />
    </>
  );
}
