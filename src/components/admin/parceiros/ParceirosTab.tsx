import { useState } from "react";
import { PartnerDashboard } from "./PartnerDashboard";
import { PartnerForm } from "./PartnerForm";
import { PartnerQrCode } from "./PartnerQrCode";
import {
  useReferralPartners,
  type ReferralPartner,
} from "./hooks/useReferralPartners";
import { useToast } from "@/hooks/use-toast";

interface ParceirosTabProps {
  consultantPhone: string;
  consultantName?: string;
  consultantIgreenId?: string;
  /** Licença do consultor — usada para montar o link curto do redirect. */
  license?: string | null;
}

export function ParceirosTab({
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
  const { partners, create, update, remove, isLoading } = useReferralPartners();
  const { toast } = useToast();

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
          onSuccess: () =>
            toast({ title: "Parceiro atualizado com sucesso!" }),
          onError: () =>
            toast({
              title: "Erro ao atualizar parceiro",
              variant: "destructive",
            }),
        },
      );
    } else {
      create.mutate(data, {
        onSuccess: () => toast({ title: "Parceiro criado com sucesso!" }),
        onError: () =>
          toast({
            title: "Erro ao criar parceiro",
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

  return (
    <>
      <PartnerDashboard
        partners={partners}
        isLoading={isLoading}
        onNew={() => setFormOpen(true)}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onQrCode={setQrPartner}
      />

      <PartnerForm
        open={formOpen}
        partner={editingPartner}
        onClose={handleCloseForm}
        onSave={handleSave}
        onDelete={handleDelete}
      />

      {qrPartner && (
        <PartnerQrCode
          open={!!qrPartner}
          onClose={() => setQrPartner(null)}
          partnerName={qrPartner.nome}
          keyword={qrPartner.keywords?.[0] || ""}
          consultantPhone={consultantPhone}
          consultantName={consultantName}
          consultantIgreenId={consultantIgreenId}
          qrPhrase={qrPartner.qr_phrase}
          license={license}
          shortCode={qrPartner.short_code}
        />
      )}
    </>
  );
}
