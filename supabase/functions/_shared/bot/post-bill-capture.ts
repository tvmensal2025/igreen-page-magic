/**
 * Escolhe QUAL capture_conta usar no pós-OCR (após ✅ SIM).
 *
 * Bug real (Jefferson 11971254913, Fluxo M, 2026-07-13):
 *   Ativar → passo_mqzoj1uf (conta cadastro → documento)
 *   mas o pós-OCR pegava o 1º capture_conta por position (d_pedir_conta → resultado).
 *
 * Preferência:
 *   1) preferredStepId (UUID salvo ao entrar em aguardando_conta)
 *   2) intenção recente ATIVAR → conta de CADASTRO (próximo = documento)
 *   3) intenção recente SIMULAR → conta de SIMULAÇÃO (próximo ≠ documento)
 *   4) primeira da lista (legado)
 */

import {
  isActivateIntent,
  isCadastroContaStep,
  isSimulateIntent,
  type ActivateStepLike,
} from "./flow-activate-routing.ts";

export type CaptureContaLike = ActivateStepLike & {
  position?: number | null;
  fallback?: { mode?: string; goto_step_id?: string | null; success_goto_step_id?: string | null } | null;
};

export function normalizeFlowStepRef(raw: string | null | undefined): string {
  let s = String(raw || "").trim();
  if (!s) return "";
  if (s.startsWith("flow:")) s = s.slice(5).trim();
  return s;
}

export function pickCaptureContaForPostBill(
  steps: CaptureContaLike[],
  opts: {
    preferredStepId?: string | null;
    recentInbound?: string | null;
  } = {},
): CaptureContaLike | null {
  // `steps` pode ser só contas OU o grafo inteiro — o classificador precisa
  // enxergar o destino (documento/resultado) para saber se é cadastro.
  const all = (steps || []).filter((c) => c && c.is_active !== false);
  const list = all.filter((c) => String(c.step_type || "") === "capture_conta");
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];

  const preferred = normalizeFlowStepRef(opts.preferredStepId);
  if (preferred) {
    const hit = list.find((c) => c.id === preferred || c.step_key === preferred);
    if (hit) return hit;
  }

  const cadastro = list.filter((c) => isCadastroContaStep(c, all));
  const sim = list.filter((c) => !isCadastroContaStep(c, all));

  const inbound = opts.recentInbound || "";
  if (isActivateIntent(inbound, null) && cadastro[0]) return cadastro[0];
  if (isSimulateIntent(inbound, null) && sim[0]) return sim[0];

  // Sem sinal claro: primeira por position (comportamento legado).
  const ordered = [...list].sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  return ordered[0] || null;
}
