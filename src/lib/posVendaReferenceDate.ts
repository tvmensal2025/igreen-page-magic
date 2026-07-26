/**
 * Data de referência da esteira pós-venda (cadastro/ativo/validado iGreen).
 * Espelha `resolve_pos_venda_reference_at` + `compute_pos_venda_stage` no banco.
 */
import type { PosVendaStage } from "@/lib/posVenda/format";
import { POS_VENDA_DAY_MILESTONES } from "@/lib/posVendaSchedule";

export type PosVendaDateSignals = {
  data_cadastro_igreen?: string | null;
  data_ativo_igreen?: string | null;
  data_validado_igreen?: string | null;
  data_cadastro?: string | null;
  data_ativo?: string | null;
  data_validado?: string | null;
  portal_submitted_at?: string | null;
};

const MS_DAY = 24 * 60 * 60 * 1000;

function todayBRT(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Parse ISO yyyy-mm-dd ou BR dd/mm/yyyy → Date UTC midnight. */
export function parseIgreenDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    y = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]);
  } else {
    const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    if (!br) return null;
    d = Number(br[1]); m = Number(br[2]); y = Number(br[3]);
  }
  if (!y || !m || !d || m > 12 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function pushIfPast(out: Date[], raw: string | null | undefined, today: Date) {
  const dt = parseIgreenDate(raw);
  if (!dt) return;
  if (dt.getTime() > today.getTime()) return;
  out.push(dt);
}

/**
 * Preferência: ativo → validado → cadastro (cols date, depois texto).
 * Ativo marca quando virou cliente — cadastro recente não pode zerar a esteira.
 * Fallback portal_submitted_at. Sem data → null (UI; RPC usa now()).
 */
export function resolvePosVendaReferenceDate(
  c: PosVendaDateSignals,
  now: Date = new Date(),
): Date | null {
  const today = todayBRT(now);
  const candidates: Date[] = [];
  pushIfPast(candidates, c.data_ativo_igreen, today);
  pushIfPast(candidates, c.data_validado_igreen, today);
  pushIfPast(candidates, c.data_cadastro_igreen, today);
  pushIfPast(candidates, c.data_ativo, today);
  pushIfPast(candidates, c.data_validado, today);
  pushIfPast(candidates, c.data_cadastro, today);
  if (candidates.length) return candidates[0];

  if (c.portal_submitted_at) {
    const p = new Date(c.portal_submitted_at);
    if (Number.isFinite(p.getTime())) {
      const pDay = new Date(Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate()));
      if (pDay.getTime() <= today.getTime()) return p;
    }
  }
  return null;
}

export function suggestPosVendaStageFromDate(
  ref: Date | null,
  now: Date = new Date(),
): PosVendaStage {
  if (!ref) return "aprovado";
  const days = Math.floor((now.getTime() - ref.getTime()) / MS_DAY);
  for (let i = POS_VENDA_DAY_MILESTONES.length - 1; i >= 0; i--) {
    if (days >= POS_VENDA_DAY_MILESTONES[i].days) {
      return POS_VENDA_DAY_MILESTONES[i].stage;
    }
  }
  return "aprovado";
}

export function formatPosVendaDateBR(ref: Date | null): string | null {
  if (!ref) return null;
  const y = ref.getUTCFullYear();
  const m = String(ref.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ref.getUTCDate()).padStart(2, "0");
  return `${d}/${m}/${y}`;
}

export function labelForSuggestedStage(stage: PosVendaStage): string {
  if (stage === "aprovado") return "Recém aprovado";
  const m = POS_VENDA_DAY_MILESTONES.find((x) => x.stage === stage);
  return m ? m.label : stage;
}

/** Origem amigável da data usada no card de validação. */
export function describePosVendaDateSource(c: PosVendaDateSignals): string {
  const today = todayBRT();
  const past = (raw?: string | null) => {
    const d = parseIgreenDate(raw);
    return !!(d && d.getTime() <= today.getTime());
  };
  if (past(c.data_ativo_igreen) || past(c.data_ativo)) return "ativo iGreen";
  if (past(c.data_validado_igreen) || past(c.data_validado)) return "validado iGreen";
  if (past(c.data_cadastro_igreen) || past(c.data_cadastro)) return "cadastro iGreen";
  if (c.portal_submitted_at) return "envio ao portal";
  return "hoje";
}
