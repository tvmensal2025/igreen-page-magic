/**
 * Roteamento canônico Ativar / Cadastrar vs Simular (Fluxo D e M).
 *
 * Regra de ouro (nunca inverter):
 *   - SIMULAR  → conta de simulação (d_pedir_conta → d_resultado) ou valor rápido
 *   - ATIVAR   → se já tem conta/valor → documento;
 *                senão → conta de CADASTRO (d_simular_pedir_conta → documento),
 *                nunca o seletor de simulação nem a conta que reabre resultado.
 *
 * Usado por Whapi + Evolution. Não apaga passos — só escolhe o destino certo.
 */

export type ActivateStepLike = {
  id: string;
  step_key?: string | null;
  step_type?: string | null;
  is_active?: boolean | null;
  fallback?: { mode?: string; goto_step_id?: string | null; success_goto_step_id?: string | null } | null;
  transitions?: Array<{ goto_step_id?: string | null }> | null;
};

export type ActivateCustomerLike = {
  electricity_bill_value?: number | string | null;
  electricity_bill_photo_url?: string | null;
  bill_data_confirmed_at?: string | null;
  bill_ocr_raw?: unknown;
};

const ACTIVATE_RX =
  /\b(ativar(\s+o)?\s+benef[ií]cio|ativar|quero\s+me\s+cadastrar|quero\s+cadastrar|cadastrar(\s+agora)?|continuar\s+cadastro|btn_quero_cadastrar|quero_cadastrar|sim_cadastrar)\b/i;

const SIMULATE_RX =
  /\b(simular(\s+economia)?|quero\s+simular|quero_simular|simula[cç][aã]o|simular_completa|simular_rapida)\b/i;

export function stripAccentsFlow(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Lead pediu ATIVAR/cadastrar (não simular). */
export function isActivateIntent(messageText?: string | null, buttonId?: string | null): boolean {
  const blob = `${buttonId || ""} ${messageText || ""}`.trim();
  if (!blob) return false;
  if (SIMULATE_RX.test(blob) && !ACTIVATE_RX.test(blob)) return false;
  return ACTIVATE_RX.test(blob);
}

/** Lead pediu SIMULAR (não ativar). */
export function isSimulateIntent(messageText?: string | null, buttonId?: string | null): boolean {
  const blob = `${buttonId || ""} ${messageText || ""}`.trim();
  if (!blob) return false;
  if (ACTIVATE_RX.test(blob) && !SIMULATE_RX.test(blob)) return false;
  return SIMULATE_RX.test(blob);
}

/** Já tem base de conta para pular simulação e ir ao documento. */
export function hasBillReady(customer: ActivateCustomerLike | null | undefined): boolean {
  if (!customer) return false;
  if (customer.bill_data_confirmed_at) return true;
  if (customer.electricity_bill_photo_url) return true;
  const v = Number(customer.electricity_bill_value);
  return Number.isFinite(v) && v > 0;
}

function activeSteps(steps: ActivateStepLike[]): ActivateStepLike[] {
  return (steps || []).filter((s) => s && s.is_active !== false);
}

function byType(steps: ActivateStepLike[], type: string): ActivateStepLike[] {
  return activeSteps(steps).filter((s) => String(s.step_type || "") === type);
}

function nextIds(step: ActivateStepLike): string[] {
  const ids: string[] = [];
  const fb = step.fallback || {};
  if (fb.success_goto_step_id) ids.push(String(fb.success_goto_step_id));
  if (fb.goto_step_id) ids.push(String(fb.goto_step_id));
  for (const t of step.transitions || []) {
    if (t?.goto_step_id) ids.push(String(t.goto_step_id));
  }
  return ids;
}

/**
 * Conta cujo caminho leva a documento = conta de CADASTRO (não de simulação).
 *
 * Busca em largura com profundidade limitada: fluxos futuros podem ter passos
 * intermediários entre a conta e o documento (ex.: conta → confirmar OCR →
 * documento). O que aparecer PRIMEIRO no caminho decide: documento → cadastro;
 * resultado/simulação → simulação. Nada encontrado → simulação (conservador).
 */
const CADASTRO_SCAN_DEPTH = 4;

export function isCadastroContaStep(
  step: ActivateStepLike,
  allSteps: ActivateStepLike[],
): boolean {
  const key = String(step.step_key || "");
  if (key === "d_simular_pedir_conta") return true;
  if (key === "d_pedir_conta") return false;
  const byId = new Map(allSteps.map((s) => [s.id, s]));
  const seen = new Set<string>([step.id]);
  let frontier = nextIds(step);
  for (let depth = 0; depth < CADASTRO_SCAN_DEPTH && frontier.length; depth++) {
    const nextFrontier: string[] = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      const n = byId.get(id);
      if (!n || n.is_active === false) continue;
      const nt = String(n.step_type || "");
      const nk = String(n.step_key || "");
      if (nt === "capture_documento" || nk.includes("pedir_documento") || nk.includes("documento")) {
        return true;
      }
      if (nk.includes("resultado") || nk.includes("simular") || nk === "d_resultado") {
        return false;
      }
      nextFrontier.push(...nextIds(n));
    }
    frontier = nextFrontier;
  }
  return false;
}

/**
 * Destino canônico para ATIVAR:
 * 1) documento se já tem conta
 * 2) conta de cadastro (→ documento), nunca conta de simulação
 * 3) documento como último recurso (portal ainda pedirá conta se faltar)
 */
export function pickActivateDestination(
  steps: ActivateStepLike[],
  customer: ActivateCustomerLike | null | undefined,
): ActivateStepLike | null {
  const list = activeSteps(steps);
  const docs = byType(list, "capture_documento");
  const contas = byType(list, "capture_conta");

  if (hasBillReady(customer) && docs[0]) return docs[0];

  const contaCadastro =
    contas.find((s) => String(s.step_key || "") === "d_simular_pedir_conta") ||
    contas.find((s) => isCadastroContaStep(s, list));

  if (contaCadastro) return contaCadastro;
  if (docs[0]) return docs[0];
  if (contas[0]) return contas[0];
  return null;
}

/**
 * Se o destino configurado for a conta de SIMULAÇÃO e a intenção for ATIVAR,
 * devolve o destino canônico. Caso contrário null (mantém o configurado).
 */
export function rewriteActivateAwayFromSimPath(
  intended: ActivateStepLike | null | undefined,
  steps: ActivateStepLike[],
  customer: ActivateCustomerLike | null | undefined,
  opts: { messageText?: string | null; buttonId?: string | null },
): ActivateStepLike | null {
  if (!intended) return null;
  if (!isActivateIntent(opts.messageText, opts.buttonId)) return null;
  if (isSimulateIntent(opts.messageText, opts.buttonId)) return null;

  const type = String(intended.step_type || "");
  const key = String(intended.step_key || "");

  // Documento sem conta pronta → conta de CADASTRO (não pular foto da conta)
  if (type === "capture_documento" || type === "capture_doc") {
    if (!hasBillReady(customer)) return pickActivateDestination(steps, customer);
    return null;
  }

  // Seletor de simulação / valor rápido — NUNCA para ativar
  if (
    key === "d_escolher_simulacao" ||
    key === "d_simular_valor" ||
    key === "d_simular_resultado" ||
    /escolher_simulacao|simular_valor/.test(key)
  ) {
    return pickActivateDestination(steps, customer);
  }

  // Conta de simulação (→ resultado)
  if (type === "capture_conta" && !isCadastroContaStep(intended, steps)) {
    return pickActivateDestination(steps, customer);
  }

  // Conta de CADASTRO mas lead JÁ tem conta → pula foto e vai ao documento
  if (type === "capture_conta" && isCadastroContaStep(intended, steps) && hasBillReady(customer)) {
    return pickActivateDestination(steps, customer);
  }

  return null;
}

/** CTA textual alinhado à regra (quando o passo não tem botões). */
export const ACTIVATE_CTA_NUDGE =
  "Posso te ajudar com:\n1) Simular economia\n2) Como funciona\n3) Ativar o benefício\n\nÉ só responder com o *número* 🙂";

/**
 * Resolve número 1/2/3 do nudge canônico quando o passo NÃO tem botões.
 * 1=simular, 2=como, 3=ativar — NÃO humano.
 */
export function resolveCanonicalNudgeChoice(
  messageText: string | null | undefined,
): "simular" | "como" | "ativar" | null {
  const t = stripAccentsFlow(String(messageText || "").trim());
  if (!t) return null;
  if (/^(1|1\.|1\)|simular|quero simular|simular economia)\b/.test(t) || t === "1") return "simular";
  if (/^(2|2\.|2\)|como|como funciona)\b/.test(t) || t === "2") return "como";
  if (
    /^(3|3\.|3\)|ativar|ativar o beneficio|ativar beneficio|cadastrar|quero cadastrar|quero me cadastrar)\b/.test(t) ||
    t === "3"
  ) {
    return "ativar";
  }
  if (isActivateIntent(t, null)) return "ativar";
  if (isSimulateIntent(t, null)) return "simular";
  if (/\bcomo funciona\b/.test(t)) return "como";
  return null;
}
