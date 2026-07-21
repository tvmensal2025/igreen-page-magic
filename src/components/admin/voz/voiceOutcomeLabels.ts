/**
 * Labels PT-BR dos status Velip (espelha `_shared/voice-dialer/velip.ts`).
 * Usado no histórico, painel e DNC para não exibir só código cru (OK/NA/EK…).
 */

export type VelipCode = "OK" | "NA" | "EK" | "CK" | "BK" | "IK";

const VELIP_LABEL: Record<string, string> = {
  OK: "Atendida",
  NA: "Não atendeu",
  EK: "Número inválido",
  CK: "Bloqueio operadora",
  BK: "Não perturbe (reprovado)",
  IK: "Número inexistente",
};

/** Falhas “reprovadas” pela operadora / lista — não são retryáveis. */
const REPROVED_CODES = new Set(["EK", "CK", "BK", "IK"]);

export function normalizeVelipCode(raw: string | null | undefined): string {
  return String(raw || "").toUpperCase().trim();
}

export function velipOutcomeLabel(raw: string | null | undefined): string {
  const code = normalizeVelipCode(raw);
  if (!code) return "";
  return VELIP_LABEL[code] || code;
}

export function isReprovedVelip(raw: string | null | undefined): boolean {
  return REPROVED_CODES.has(normalizeVelipCode(raw));
}

export function isBlockedVelip(raw: string | null | undefined): boolean {
  const code = normalizeVelipCode(raw);
  return code === "BK" || code === "CK";
}

export function formatDurationSec(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

export function dncSourceLabel(source: string | null | undefined): string {
  const s = String(source || "").toLowerCase();
  if (s === "velip_callback") return "Automático (iGreen Fone)";
  if (s === "admin_ui") return "Manual";
  return source || "Manual";
}
