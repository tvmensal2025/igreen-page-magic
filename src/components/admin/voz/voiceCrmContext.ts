/**
 * Contexto de CRM/fechamento para a aba Ligação.
 * Quase todos os destinos já estão no funil — a discagem é follow-up, não lista fria.
 */
import { customerStatusLabels } from "@/components/admin/lib/customerStatusLabels";
import { stepLabel } from "@/components/admin/conversao/stepLabels";
import type { VozCustomer } from "./VozContactPickerDialog";
import { resolveCustomerByPhone } from "./voiceContactResolve";

const POS_VENDA_LABEL: Record<string, string> = {
  espera: "Pós-venda · aguardando",
  aprovado: "Pós-venda · aprovado",
  reprovado: "Pós-venda · reprovado",
  d30: "Pós-venda · 30 dias",
  d60: "Pós-venda · 60 dias",
  d90: "Pós-venda · 90 dias",
  d120: "Pós-venda · 120 dias",
};

export function statusCrmLabel(status: string | null | undefined): string {
  if (!status) return "Sem status";
  return customerStatusLabels[status] ?? status;
}

export function etapaBotLabel(step: string | null | undefined): string {
  return stepLabel(step);
}

export function posVendaLabel(stage: string | null | undefined): string | null {
  if (!stage) return null;
  return POS_VENDA_LABEL[stage] ?? `Pós-venda · ${stage}`;
}

export function formatContaValue(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(Number(value)) || Number(value) <= 0) return null;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

/**
 * Deep-link legado (ex.: Conversão). Preferir `onOpenChat` do Admin quando
 * já estamos dentro de `/admin` — o Admin só lê `?phone=` no mount inicial.
 */
export function chatUrlForPhone(phone: string | null | undefined): string {
  const d = String(phone || "").replace(/\D/g, "");
  return `/admin?tab=whatsapp&phone=${d}`;
}

/** Linha curta: status · etapa · conta · devolutiva */
export function crmClosingSummary(c: VozCustomer | null | undefined): string {
  if (!c) return "Fora do CRM / sem vínculo";
  const parts: string[] = [statusCrmLabel(c.status)];
  if (c.conversation_step) parts.push(etapaBotLabel(c.conversation_step));
  const conta = formatContaValue(c.electricity_bill_value);
  if (conta) parts.push(`Conta ${conta}`);
  const pv = posVendaLabel(c.pos_venda_stage);
  if (pv) parts.push(pv);
  if (c.devolutiva?.trim()) parts.push(`Devolutiva: ${c.devolutiva.trim().slice(0, 40)}`);
  else if (c.andamento_igreen?.trim()) {
    parts.push(c.andamento_igreen.trim().slice(0, 40));
  }
  return parts.join(" · ");
}

export function resolveCrmByPhoneOrId(
  phone: string | null | undefined,
  customerId: string | null | undefined,
  customers: VozCustomer[],
): VozCustomer | null {
  if (customerId) {
    const byId = customers.find((c) => c.id === customerId);
    if (byId) return byId;
  }
  if (phone) return resolveCustomerByPhone(phone, customers);
  return null;
}
