import type { PosVendaStage } from "@/lib/posVenda/format";
import { clampToPosVendaSendWindow, isPosVendaSendWindow } from "@/lib/posVendaSendWindow";

/** Espelha PROGRESSION em pos-venda-auto-progress/index.ts */
export const POS_VENDA_DAY_MILESTONES = [
  { days: 30, stage: "d30" as const, stageKey: "pv_d30", label: "30 dias" },
  { days: 60, stage: "d60" as const, stageKey: "pv_d60", label: "60 dias" },
  { days: 90, stage: "d90" as const, stageKey: "pv_d90", label: "90 dias" },
  { days: 120, stage: "d120" as const, stageKey: "pv_d120", label: "120 dias" },
  { days: 150, stage: "d150" as const, stageKey: "pv_d150", label: "150 dias" },
  { days: 180, stage: "d180" as const, stageKey: "pv_d180", label: "180 dias" },
  { days: 210, stage: "d210" as const, stageKey: "pv_d210", label: "210 dias" },
] as const;

export const PV_STAGE_KEY_LABELS: Record<string, string> = {
  pv_espera: "Aguardando classificação",
  pv_aprovado: "Aprovado",
  pv_reprovado: "Reprovado",
  pv_retentativa: "Retentativa",
  pv_d30: "30 dias",
  pv_d60: "60 dias",
  pv_d90: "90 dias",
  pv_d120: "120 dias",
  pv_d150: "150 dias",
  pv_d180: "180 dias",
  pv_d210: "210 dias",
};

const APPROVED_TRACK = new Set<string>([
  "aprovado", "d30", "d60", "d90", "d120", "d150", "d180", "d210",
]);

const STAGE_ORDER = ["aprovado", "d30", "d60", "d90", "d120", "d150", "d180", "d210"] as const;

function stageIndex(stage: string): number {
  return STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PosVendaCustomerRow {
  id: string;
  name: string | null;
  phone_whatsapp: string | null;
  pos_venda_stage: string | null;
  pos_venda_approved_at: string | null;
  pos_venda_rejected_at?: string | null;
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
 * Datas derivadas apenas de pos_venda_approved_at + marcos 30/60/90/120/150/180/210.
 * Reprovado/devolutiva/retentativa ficam mudos e não entram na agenda.
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

    if (stage === "reprovado" || stage === "retentativa") {
      continue;
    }

    if (!APPROVED_TRACK.has(stage) || !c.pos_venda_approved_at) continue;

    const approvedMs = new Date(c.pos_venda_approved_at).getTime();
    if (!Number.isFinite(approvedMs)) continue;

    const currentIdx = stageIndex(stage);
    const inWindow = isPosVendaSendWindow(now);

    // Só agenda o marco atual (se ainda não enviado) + futuros.
    // Marcos anteriores a um backfill por data iGreen ficam de fora do hub.
    // Fora da janela seg–sáb 08–20 → clamp para o próximo slot (agendamento).
    if (stage === "aprovado" && !sent.has("pv_aprovado")) {
      const at = clampToPosVendaSendWindow(new Date(approvedMs), now);
      out.push({
        id: `${c.id}-pv_aprovado`,
        customerId: c.id,
        customerName: name,
        phone,
        stageKey: "pv_aprovado",
        stageLabel: "Aprovado",
        scheduledAt: at,
        isOverdue: at.getTime() <= nowMs && inWindow,
        messagePreview: defaultPreviews.aprovado?.slice(0, 120) ?? null,
        kind: "pos_venda_auto",
      });
    } else if (currentIdx > 0 && !sent.has(`pv_${stage}`)) {
      // Já está em d30+ e o envio do bucket atual ainda não saiu.
      const milestone = POS_VENDA_DAY_MILESTONES.find((m) => m.stage === stage);
      if (milestone) {
        const raw = new Date(approvedMs + milestone.days * MS_PER_DAY);
        const at = clampToPosVendaSendWindow(raw, now);
        out.push({
          id: `${c.id}-${milestone.stageKey}`,
          customerId: c.id,
          customerName: name,
          phone,
          stageKey: milestone.stageKey,
          stageLabel: milestone.label,
          scheduledAt: at,
          isOverdue: at.getTime() <= nowMs && inWindow,
          messagePreview: defaultPreviews[milestone.stage]?.slice(0, 120) ?? null,
          kind: "pos_venda_auto",
        });
      }
    }

    for (const m of POS_VENDA_DAY_MILESTONES) {
      if (sent.has(m.stageKey)) continue;
      const mIdx = stageIndex(m.stage);
      // Só futuros em relação ao estágio atual (não reabre d30 se já está em d150).
      if (mIdx <= currentIdx) continue;
      const raw = new Date(approvedMs + m.days * MS_PER_DAY);
      const at = clampToPosVendaSendWindow(raw, now);
      out.push({
        id: `${c.id}-${m.stageKey}`,
        customerId: c.id,
        customerName: name,
        phone,
        stageKey: m.stageKey,
        stageLabel: m.label,
        scheduledAt: at,
        isOverdue: at.getTime() <= nowMs && inWindow,
        messagePreview: defaultPreviews[m.stage]?.slice(0, 120) ?? null,
        kind: "pos_venda_auto",
      });
    }
  }

  return out.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}
