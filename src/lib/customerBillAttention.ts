/** Sinais de que o lead enviou ou está no fluxo de fatura — destaque para o consultor. */

export type BillAttention = {
  active: boolean;
  label: string;
  detail?: string;
  priority: "high" | "medium";
};

type CustomerBillFields = {
  electricity_bill_photo_url?: string | null;
  electricity_bill_value?: number | null;
  bill_data_confirmed_at?: string | null;
  last_inbound_media_kind?: string | null;
  last_inbound_media_at?: string | null;
  conversation_step?: string | null;
};

const BILL_STEP_RE = /bill|fatura|conta|a6_ask|energia/i;

function isRecent(iso: string | null | undefined, days = 14): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < days * 86_400_000;
}

export function billAttentionFromCustomer(c: CustomerBillFields | null | undefined): BillAttention {
  if (!c) return { active: false, label: "", priority: "medium" };

  if (c.electricity_bill_photo_url) {
    return {
      active: true,
      label: "Fatura recebida",
      detail: "Cliente enviou foto/PDF da conta de luz — priorize no chat",
      priority: "high",
    };
  }

  if (c.bill_data_confirmed_at) {
    return {
      active: true,
      label: "Conta confirmada",
      detail: "Dados da fatura já validados no sistema",
      priority: "high",
    };
  }

  const step = String(c.conversation_step || "");
  if (step && BILL_STEP_RE.test(step)) {
    return {
      active: true,
      label: "Fluxo da fatura",
      detail: `Etapa atual: ${step.replace(/_/g, " ")}`,
      priority: "medium",
    };
  }

  if (
    isRecent(c.last_inbound_media_at) &&
    (c.last_inbound_media_kind === "image" || c.last_inbound_media_kind === "document")
  ) {
    return {
      active: true,
      label: "Possível fatura no WhatsApp",
      detail: "Recebeu imagem ou documento recentemente — confira no chat",
      priority: "medium",
    };
  }

  if (c.electricity_bill_value != null && Number(c.electricity_bill_value) > 0) {
    const v = Number(c.electricity_bill_value);
    return {
      active: true,
      label: "Valor da conta informado",
      detail: `Média ~R$ ${v.toLocaleString("pt-BR")}`,
      priority: "medium",
    };
  }

  return { active: false, label: "", priority: "medium" };
}

export function billAttentionFromInboundMessages(
  messages: { message_direction: string; message_type: string | null }[],
): BillAttention {
  const recentInboundMedia = [...messages]
    .reverse()
    .slice(0, 12)
    .find(
      (m) =>
        m.message_direction === "inbound" &&
        (m.message_type === "image" || m.message_type === "document"),
    );
  if (!recentInboundMedia) return { active: false, label: "", priority: "medium" };
  return {
    active: true,
    label: "Mídia recebida (pode ser fatura)",
    detail: "Há foto ou PDF do cliente na conversa — abra o chat para conferir",
    priority: "medium",
  };
}

export function mergeBillAttention(a: BillAttention, b: BillAttention): BillAttention {
  if (!a.active) return b;
  if (!b.active) return a;
  if (a.priority === "high") return a;
  if (b.priority === "high") return b;
  return a;
}
