import { useState } from "react";
import { PartnerDashboard } from "./PartnerDashboard";
import { PartnerForm } from "./PartnerForm";
import { PartnerQrCode } from "./PartnerQrCode";
import {
  useReferralPartners,
  type ReferralPartner,
} from "./hooks/useReferralPartners";
import { useToast } from "@/hooks/use-toast";
import { HardResetPhoneCard } from "@/components/admin/HardResetPhoneCard";

interface ParceirosTabProps {
  consultantPhone: string;
  consultantName?: string;
  consultantIgreenId?: string;
}

export function ParceirosTab({
  consultantPhone,
  consultantName = "",
  consultantIgreenId = "",
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
    cli: string;
    keywords: string[];
    qr_phrase: string | null;
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
      <HardResetPhoneCard className="mb-4" />
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
        />
      )}
    </>
  );
}
