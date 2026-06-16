import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Pencil, Trash2, QrCode } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { ReferralPartner } from "./hooks/useReferralPartners";

interface PartnerListProps {
  partners: ReferralPartner[];
  onEdit: (partner: ReferralPartner) => void;
  onDelete: (id: string) => void;
  onQrCode: (partner: ReferralPartner) => void;
  isLoading: boolean;
}

export function PartnerList({
  partners,
  onEdit,
  onDelete,
  onQrCode,
  isLoading,
}: PartnerListProps) {
  const confirm = useConfirm();
  const handleDeleteClick = async (partner: ReferralPartner) => {
    const ok = await confirm({
      title: "Excluir parceiro?",
      description: `O parceiro "${partner.nome}" será removido e deixará de receber atribuição de novos leads. Esta ação não pode ser desfeita pela interface.`,
      confirmText: "Excluir",
      cancelText: "Cancelar",
      tone: "danger",
    });
    if (ok) onDelete(partner.id);
  };
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (partners.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>Nenhum parceiro cadastrado.</p>
        <p className="text-sm mt-1">
          Clique em &quot;Novo Parceiro&quot; para começar.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nome</TableHead>
          <TableHead>Keywords</TableHead>
          <TableHead>CLI</TableHead>
          <TableHead>Criado em</TableHead>
          <TableHead className="text-right">Ações</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {partners.map((partner) => (
          <TableRow key={partner.id}>
            <TableCell className="font-medium">{partner.nome}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {(partner.keywords || []).map((kw) => (
                  <Badge key={kw} variant="secondary" className="text-xs">
                    {kw}
                  </Badge>
                ))}
              </div>
            </TableCell>
            <TableCell className="font-mono text-sm">{partner.cli}</TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {new Date(partner.created_at).toLocaleDateString("pt-BR")}
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onQrCode(partner)}
                  title="QR Code"
                >
                  <QrCode className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onEdit(partner)}
                  title="Editar"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDeleteClick(partner)}
                  title="Excluir"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
