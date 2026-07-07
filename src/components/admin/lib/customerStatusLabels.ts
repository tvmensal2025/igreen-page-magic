// Rótulos + cores unificados para status de cliente iGreen.
// Mantido em um único lugar para evitar drift entre DashboardTab e TopConsumersCard.

export const customerStatusLabels: Record<string, string> = {
  approved: "Aprovado",
  active: "Ativo",
  pending: "Pendente",
  rejected: "Reprovado",
  lead: "Interessado",
  devolutiva: "Devolutiva",
  awaiting_signature: "Falta assinar",
  data_complete: "Dados completos",
  registered_igreen: "Cadastrado iGreen",
  contract_sent: "Contrato enviado",
  contato_incompleto: "Rede indireta",
};

export const customerStatusBadge: Record<string, string> = {
  approved: "bg-primary/15 text-primary",
  active: "bg-primary/15 text-primary",
  pending: "bg-warning/15 text-warning",
  rejected: "bg-destructive/15 text-destructive",
  devolutiva: "bg-warning/15 text-warning",
  awaiting_signature: "bg-warning/15 text-warning",
  data_complete: "bg-primary/10 text-primary",
  registered_igreen: "bg-primary/10 text-primary",
  contract_sent: "bg-primary/10 text-primary",
  contato_incompleto: "bg-muted text-muted-foreground",
  lead: "bg-muted text-muted-foreground",
};

export function getStatusPresentation(status?: string | null) {
  const key = status || "pending";
  return {
    label: customerStatusLabels[key] ?? key,
    cls: customerStatusBadge[key] ?? "bg-muted text-muted-foreground",
  };
}
