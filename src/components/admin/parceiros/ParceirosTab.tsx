import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PartnerDashboard } from "./PartnerDashboard";
import { PartnerForm } from "./PartnerForm";
import { PartnerQrCode } from "./PartnerQrCode";
import {
  ConsultantBannerDownloadModal,
  type BannerSpot,
} from "./ConsultantBannerDownloadModal";
import { BannersHub } from "./BannersHub";
import { ManualReviewQueueCard } from "./ManualReviewQueueCard";
import {
  ConsultantMissingEssentialsModal,
  missingBannerEssentials,
} from "./ConsultantMissingEssentialsModal";
import {
  useReferralPartners,
  type ReferralPartner,
} from "./hooks/useReferralPartners";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { resolveConsultantWaPhoneForUi } from "@/lib/consultantWaPhone";

interface ParceirosTabProps {
  consultantId: string;
  consultantPhone: string;
  consultantName?: string;
  /** Nome público (preferido nas iniciais do banner vivo). */
  consultantDisplayName?: string;
  consultantIgreenId?: string;
  license?: string | null;
  /** Canal principal — prioriza chip vivo (settings) quando aplicável. */
  isWhapi?: boolean;
  /** Atualiza o form do Admin depois de salvar WhatsApp/ID no modal. */
  onEssentialsSaved?: (next: { phone?: string; igreen_id?: string }) => void;
}

type BannerDownloadOpts = {
  mode: "root" | "spot";
  spotId?: string;
};

export function ParceirosTab({
  consultantId,
  consultantPhone,
  consultantName = "",
  consultantDisplayName = "",
  consultantIgreenId = "",
  license = "",
  isWhapi = false,
  onEssentialsSaved,
}: ParceirosTabProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState<ReferralPartner | null>(
    null,
  );
  const [qrPartner, setQrPartner] = useState<ReferralPartner | null>(null);
  const [qrPartnerCtx, setQrPartnerCtx] = useState<{
    keyword?: string;
    spotCode?: string;
    phrase?: string | null;
  } | null>(null);
  const [view, setView] = useState<"rede" | "banners">("rede");
  const [bannerOpen, setBannerOpen] = useState(false);
  const [bannerDownloadOpts, setBannerDownloadOpts] =
    useState<BannerDownloadOpts>({ mode: "root" });
  const [bannerSpots, setBannerSpots] = useState<BannerSpot[]>([]);
  const [bannerDefaultPhrase, setBannerDefaultPhrase] = useState<string | null>(
    null,
  );
  const [liveWaPhone, setLiveWaPhone] = useState(consultantPhone);
  const [localIgreenId, setLocalIgreenId] = useState(consultantIgreenId);
  const [essentialsOpen, setEssentialsOpen] = useState(false);
  const [pendingBannerAfterSave, setPendingBannerAfterSave] =
    useState<BannerDownloadOpts | null>(null);
  const { partners, create, update, remove, isLoading } = useReferralPartners();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [focusPartnerId, setFocusPartnerId] = useState<string | null>(null);

  const effectivePhone = liveWaPhone || consultantPhone;
  const effectiveIgreen = localIgreenId || consultantIgreenId;
  const essentialsMissing = missingBannerEssentials({
    phone: effectivePhone,
    igreenId: effectiveIgreen,
  });

  useEffect(() => {
    setLocalIgreenId(consultantIgreenId);
  }, [consultantIgreenId]);

  useEffect(() => {
    if (consultantPhone) setLiveWaPhone(consultantPhone);
  }, [consultantPhone]);

  // Abre sozinho na aba Parceiros se ainda faltar WhatsApp ou ID.
  useEffect(() => {
    if (essentialsMissing.length > 0) setEssentialsOpen(true);
    else setEssentialsOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chave estável dos faltantes
  }, [essentialsMissing.join("|")]);

  const refreshPartners = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["referral-partners"] });
  }, [queryClient]);

  const loadConsultantBannerData = useCallback(async () => {
    if (!consultantId) return;
    const [{ data: cons }, { data: spots }, waPhone] = await Promise.all([
      supabase
        .from("consultants")
        .select("banner_keywords, banner_default_phrase, phone, igreen_id")
        .eq("id", consultantId)
        .maybeSingle(),
      supabase
        .from("consultant_banner_spots")
        .select("id, code, keyword, phrase, is_active")
        .eq("consultant_id", consultantId)
        .order("created_at", { ascending: true }),
      resolveConsultantWaPhoneForUi(supabase, consultantId, {
        isWhapi,
        fallbackPhone: consultantPhone,
      }),
    ]);
    setBannerDefaultPhrase(
      String(
        (cons as { banner_default_phrase?: string | null } | null)
          ?.banner_default_phrase || "",
      ).trim() || null,
    );
    setBannerSpots((spots as BannerSpot[] | null) || []);
    setLiveWaPhone(waPhone);
  }, [consultantId, consultantPhone, isWhapi]);

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
        onSuccess: (created) => {
          toast({ title: "Parceiro criado com sucesso!" });
          handleCloseForm();
          if (created?.id) setFocusPartnerId(String(created.id));
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

  const openPartnerQr = (
    partner: ReferralPartner,
    ctx?: { keyword?: string; spotCode?: string; phrase?: string | null },
  ) => {
    setQrPartner(partner);
    setQrPartnerCtx(ctx ?? null);
  };

  const closePartnerQr = () => {
    setQrPartner(null);
    setQrPartnerCtx(null);
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

  const openBannerDownload = (opts: BannerDownloadOpts) => {
    if (essentialsMissing.length > 0) {
      setPendingBannerAfterSave(opts);
      setEssentialsOpen(true);
      return;
    }
    setBannerDownloadOpts(opts);
    void loadConsultantBannerData();
    setBannerOpen(true);
  };

  const handleEssentialsSaved = (next: {
    phone?: string;
    igreen_id?: string;
  }) => {
    if (next.phone) setLiveWaPhone(next.phone);
    if (next.igreen_id) setLocalIgreenId(next.igreen_id);
    onEssentialsSaved?.(next);
    setEssentialsOpen(false);
    void loadConsultantBannerData();
    if (pendingBannerAfterSave) {
      const opts = pendingBannerAfterSave;
      setPendingBannerAfterSave(null);
      setBannerDownloadOpts(opts);
      setBannerOpen(true);
    }
  };

  const essentialsModal = (
    <ConsultantMissingEssentialsModal
      open={essentialsOpen && essentialsMissing.length > 0}
      consultantId={consultantId}
      missing={essentialsMissing}
      initialPhone={effectivePhone}
      initialIgreenId={effectiveIgreen}
      blocking
      onSaved={handleEssentialsSaved}
    />
  );

  if (view === "banners") {
    return (
      <>
        <BannersHub
          consultantId={consultantId}
          consultantName={consultantName}
          consultantDisplayName={consultantDisplayName}
          consultantIgreenId={effectiveIgreen}
          consultantPhone={effectivePhone}
          license={license}
          defaultPhrase={bannerDefaultPhrase}
          spots={bannerSpots}
          partners={partners}
          onSpotsChanged={() => {
            void loadConsultantBannerData();
          }}
          onPartnersChanged={refreshPartners}
          onBack={() => setView("rede")}
          onOpenDownload={openBannerDownload}
          onOpenPartnerQr={openPartnerQr}
        />

        <ConsultantBannerDownloadModal
          open={bannerOpen}
          onClose={() => setBannerOpen(false)}
          consultantId={consultantId}
          consultantName={consultantName}
          consultantDisplayName={consultantDisplayName}
          consultantIgreenId={effectiveIgreen}
          consultantPhone={effectivePhone}
          defaultPhrase={bannerDefaultPhrase}
          spots={bannerSpots}
          initialMode={bannerDownloadOpts.mode}
          initialSpotId={bannerDownloadOpts.spotId}
          onSpotsChanged={() => {
            void loadConsultantBannerData();
          }}
        />

        <PartnerQrCode
          open={!!qrPartner}
          onClose={closePartnerQr}
          partnerName={qrPartner?.nome ?? ""}
          keyword={
            qrPartnerCtx?.keyword ||
            qrPartner?.keywords?.[0]?.trim() ||
            qrPartner?.nome ||
            ""
          }
          keywords={qrPartner?.keywords ?? []}
          consultantPhone={effectivePhone}
          consultantName={consultantName}
          consultantIgreenId={effectiveIgreen}
          qrPhrase={qrPartnerCtx?.phrase ?? qrPartner?.qr_phrase}
          license={license}
          shortCode={qrPartner?.short_code}
          spotCode={qrPartnerCtx?.spotCode}
          onSaveKeyword={handleSavePartnerKeyword}
        />

        {essentialsModal}
      </>
    );
  }

  return (
    <>
      <ManualReviewQueueCard consultantId={consultantId} />

      <PartnerDashboard
        partners={partners}
        isLoading={isLoading}
        consultantId={consultantId}
        license={license}
        consultantIgreenId={effectiveIgreen}
        consultantName={consultantName}
        consultantPhone={effectivePhone}
        onNew={() => {
          setEditingPartner(null);
          setFormOpen(true);
        }}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onQrCode={(p, ctx) => openPartnerQr(p, ctx)}
        onPartnersChanged={refreshPartners}
        focusPartnerId={focusPartnerId}
        onDownloadBanner={() => {
          if (essentialsMissing.length > 0) {
            setEssentialsOpen(true);
            return;
          }
          void loadConsultantBannerData();
          setView("banners");
        }}
      />

      <PartnerForm
        open={formOpen}
        partner={editingPartner}
        onClose={handleCloseForm}
        onSave={handleSave}
        onDelete={handleDelete}
      />

      <PartnerQrCode
        open={!!qrPartner}
        onClose={closePartnerQr}
        partnerName={qrPartner?.nome ?? ""}
        keyword={
          qrPartnerCtx?.keyword ||
          qrPartner?.keywords?.[0]?.trim() ||
          qrPartner?.nome ||
          ""
        }
        keywords={qrPartner?.keywords ?? []}
        consultantPhone={effectivePhone}
        consultantName={consultantName}
        consultantIgreenId={effectiveIgreen}
        qrPhrase={qrPartnerCtx?.phrase ?? qrPartner?.qr_phrase}
        license={license}
        shortCode={qrPartner?.short_code}
        spotCode={qrPartnerCtx?.spotCode}
        onSaveKeyword={handleSavePartnerKeyword}
      />

      {essentialsModal}
    </>
  );
}
