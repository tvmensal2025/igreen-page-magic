import type { PosVendaStage } from "@/lib/posVenda/format";

/** Espelha PROGRESSION em pos-venda-auto-progress/index.ts */
export const POS_VENDA_DAY_MILESTONES = [
  { days: 30, stage: "d30" as const, stageKey: "pv_d30", label: "30 dias" },
  { days: 60, stage: "d60" as const, stageKey: "pv_d60", label: "60 dias" },
  { days: 90, stage: "d90" as const, stageKey: "pv_d90", label: "90 dias" },
  { days: 120, stage: "d120" as const, stageKey: "pv_d120", label: "120 dias" },
] as const;

export const PV_STAGE_KEY_LABELS: Record<string, string> = {
  pv_espera: "Aguardando classificação",
  pv_aprovado: "Aprovado",
  pv_reprovado: "Reprovado",
  pv_d30: "30 dias",
  pv_d60: "60 dias",
  pv_d90: "90 dias",
  pv_d120: "120 dias",
};

const APPROVED_TRACK = new Set<string>(["aprovado", "d30", "d60", "d90", "d120"]);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PosVendaCustomerRow {
  id: string;
  name: string | null;
  phone_whatsapp: string | null;
  pos_venda_stage: string | null;
  pos_venda_approved_at: string | null;
}

export interface UpcomingPosVendaItem {
  id: string;
  customerId: string;
  customerName: string;
  phone: string;
  stageKey: string;
  stageLabel: string;
  scheduledAt: Date;
  isOverdue: boolean;
  messagePreview: string | null;
  kind: "pos_venda_auto";
}

export function labelForStageKey(stageKey: string): string {
  return PV_STAGE_KEY_LABELS[stageKey] || stageKey.replace(/^pv_/, "");
}

/** Monta mapa customer_id → stage_keys já enviados (customer_auto_message_log). */
export function groupSentStageKeys(
  rows: Array<{ customer_id: string; stage_key: string }>,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!map.has(r.customer_id)) map.set(r.customer_id, new Set());
    map.get(r.customer_id)!.add(r.stage_key);
  }
  return map;
}

/**
 * Calcula próximos envios automáticos do pós-venda (não vão para scheduled_messages).
 * Datas derivadas de pos_venda_approved_at + marcos 30/60/90/120.
 */
export function buildUpcomingPosVendaMessages(
  customers: PosVendaCustomerRow[],
  sentByCustomer: Map<string, Set<string>>,
  defaultPreviews: Partial<Record<PosVendaStage, string>> = {},
  now: Date = new Date(),
): UpcomingPosVendaItem[] {
  const out: UpcomingPosVendaItem[] = [];
  const nowMs = now.getTime();

  for (const c of customers) {
    const stage = c.pos_venda_stage;
    if (!stage || stage === "espera") continue;

    const sent = sentByCustomer.get(c.id) ?? new Set<string>();
    const phone = c.phone_whatsapp || "";
    const name = (c.name || "").trim() || "Sem nome";

    if (stage === "reprovado") {
      if (!sent.has("pv_reprovado")) {
        out.push({
          id: `${c.id}-pv_reprovado`,
          customerId: c.id,
          customerName: name,
          phone,
          stageKey: "pv_reprovado",
          stageLabel: "Reprovado",
          scheduledAt: now,
          isOverdue: true,
          messagePreview: defaultPreviews.reprovado?.slice(0, 120) ?? null,
          kind: "pos_venda_auto",
        });
      }
      continue;
    }

    if (!APPROVED_TRACK.has(stage) || !c.pos_venda_approved_at) continue;

    const approvedMs = new Date(c.pos_venda_approved_at).getTime();
    if (!Number.isFinite(approvedMs)) continue;

    if (!sent.has("pv_aprovado")) {
      const at = new Date(approvedMs);
      out.push({
        id: `${c.id}-pv_aprovado`,
        customerId: c.id,
        customerName: name,
        phone,
        stageKey: "pv_aprovado",
        stageLabel: "Aprovado",
        scheduledAt: at,
        isOverdue: nowMs >= approvedMs,
        messagePreview: defaultPreviews.aprovado?.slice(0, 120) ?? null,
        kind: "pos_venda_auto",
      });
    }

    for (const m of POS_VENDA_DAY_MILESTONES) {
      if (sent.has(m.stageKey)) continue;
      const atMs = approvedMs + m.days * MS_PER_DAY;
      const at = new Date(atMs);
      out.push({
        id: `${c.id}-${m.stageKey}`,
        customerId: c.id,
        customerName: name,
        phone,
        stageKey: m.stageKey,
        stageLabel: m.label,
        scheduledAt: at,
        isOverdue: nowMs >= atMs,
        messagePreview: defaultPreviews[m.stage]?.slice(0, 120) ?? null,
        kind: "pos_venda_auto",
      });
    }
  }

  return out.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}
