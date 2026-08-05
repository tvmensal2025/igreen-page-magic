// partner-attribution-gate.ts
// Módulo PURO (sem I/O, sem Supabase) — decide se o bloco de atribuição de
// parceiro (keyword / `#R{short_code}`) pode rodar para um lead.
//
// POR QUE ESTE MÓDULO EXISTE (regressão real — parceiro José, 2026-08-05)
// ----------------------------------------------------------------------
// Um parceiro com keyword e QR corretos recebeu o lead, o lead conversou e
// converteu — e a atribuição nunca aconteceu. Causa: os webhooks tratavam
// QUALQUER frase-âncora de Click-to-WhatsApp como "lead do Meta" e, nesse caso,
// pulavam o bloco de parceiro inteiro. A frase PADRÃO do QR do parceiro era
// "Oi! Vim pelo {keyword} e quero saber mais sobre o desconto na energia." —
// e "quero saber mais" é uma das âncoras de `matchesMetaCtwaPhrase`.
// Resultado: 100% dos leads que usavam a frase padrão do parceiro caíam no
// bloqueio. Não era race condition, era determinístico.
//
// REGRA CANÔNICA: força do sinal manda.
//   • Sinal FORTE (persistido no lead): `source_campaign_id`, `source_ad_id`,
//     `source_ctwa_clid`, `ctwa_clid` ou `lead_source` contendo "meta".
//     É prova de origem Meta → bloqueia keyword de parceiro (o rodízio é quem
//     atribui; sem pool o lead fica com o consultor dono).
//   • Sinal FRACO (só heurística de texto): a frase de abertura PARECE CTWA.
//     Não é prova de nada — o próprio QR do parceiro gera frase parecida.
//     NÃO pode bloquear uma atribuição determinística (keyword exata ou `#R`).
//
// Isto NÃO afrouxa a regra "nunca chutar parceiro": o match continua sendo
// exato por sequência de tokens (`keyword-matcher.ts`, sem fuzzy). O que muda é
// que uma heurística de texto fraca deixa de vetar uma evidência forte.
//
// Ver: `.kiro/steering/parceiros-referral.md`, `#rodizio-parceiros-campanha`.

import { matchesMetaCtwaPhrase } from "./meta-ctwa-fallback.ts";

export interface PartnerKeywordGateInput {
  sourceCampaignId?: string | null;
  sourceAdId?: string | null;
  sourceCtwaClid?: string | null;
  ctwaClid?: string | null;
  /** `customers.lead_source` cru (jsonb/string/objeto) — só inspecionamos texto. */
  leadSource?: unknown;
  messageText?: string | null;
}

export type PartnerKeywordGateReason =
  | "strong_meta_signal"
  | "allowed_weak_ctwa_phrase_only"
  | "allowed";

export interface PartnerKeywordGateResult {
  /** `true` = não rodar atribuição por keyword/`#R` neste lead. */
  blocked: boolean;
  /** Havia prova persistida de origem Meta. */
  strongMetaSignal: boolean;
  /** Só a frase parecia CTWA — antes bloqueava, hoje não. */
  weakCtwaPhraseOnly: boolean;
  reason: PartnerKeywordGateReason;
}

function hasValue(v?: string | null): boolean {
  return typeof v === "string" ? v.trim().length > 0 : v != null;
}

/**
 * Decide se a atribuição de parceiro por keyword/`#R` está liberada.
 *
 * NÃO considera rodízio: quando a campanha tem pool ativa, quem atribui é a RPC
 * `rodizio_assign_lead` e o caller já pula este bloco (`!rodizioPoolAtiva`).
 */
export function evaluatePartnerKeywordGate(
  input: PartnerKeywordGateInput,
): PartnerKeywordGateResult {
  const leadSourceText = JSON.stringify(input.leadSource ?? "").toLowerCase();

  const strongMetaSignal = hasValue(input.sourceCampaignId) ||
    hasValue(input.sourceAdId) ||
    hasValue(input.sourceCtwaClid) ||
    hasValue(input.ctwaClid) ||
    leadSourceText.includes("meta");

  if (strongMetaSignal) {
    return {
      blocked: true,
      strongMetaSignal: true,
      weakCtwaPhraseOnly: false,
      reason: "strong_meta_signal",
    };
  }

  const weakCtwaPhraseOnly = matchesMetaCtwaPhrase(input.messageText ?? "");

  return {
    blocked: false,
    strongMetaSignal: false,
    weakCtwaPhraseOnly,
    reason: weakCtwaPhraseOnly ? "allowed_weak_ctwa_phrase_only" : "allowed",
  };
}

/**
 * Escopo de busca de `referral_partners`, em ordem de prioridade.
 *
 * REGRESSÃO QUE ISSO CORRIGE: o `whapi-webhook` procurava parceiros SÓ com
 * `consultant_id = superadmin_consultant_id` (o hub Whapi). Parceiro cadastrado
 * sob o consultor real (chip compartilhado, Evolution próprio, lead cujo
 * `customers.consultant_id` não é o superadmin) nunca era encontrado no canal
 * primário — enquanto o `evolution-webhook` usava o consultor da instância.
 * O mesmo parceiro funcionava num canal e não no outro.
 *
 * Ordem: DONO do lead primeiro (evidência mais específica), superadmin depois
 * (hub compartilhado). Sem duplicatas, sem vazios. Nunca mistura outros
 * tenants — só estes dois ids entram.
 */
export function resolvePartnerScopeConsultantIds(
  leadConsultantId?: string | null,
  superAdminConsultantId?: string | null,
): string[] {
  const ids: string[] = [];
  for (const raw of [leadConsultantId, superAdminConsultantId]) {
    const id = String(raw ?? "").trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Ordena linhas de `referral_partners` pela prioridade do escopo
 * (`resolvePartnerScopeConsultantIds`): dono do lead antes do hub superadmin.
 *
 * Importa porque `matchKeyword` resolve empate pela PRIMEIRA keyword de mesmo
 * tamanho — então a ordem define quem ganha o lead num empate exato.
 * Linhas de consultores fora do escopo são descartadas (nunca cruzar tenant).
 */
export function orderPartnersByScope<T extends { consultant_id?: string | null }>(
  rows: T[] | null | undefined,
  scopeIds: string[],
): T[] {
  const idx = (row: T) => scopeIds.indexOf(String(row?.consultant_id ?? "").trim());
  return (rows ?? [])
    .filter((r) => idx(r) >= 0)
    .sort((a, b) => idx(a) - idx(b));
}

/** Primeira linha na ordem de escopo, ou `null`. */
export function pickPartnerByScope<T extends { consultant_id?: string | null }>(
  rows: T[] | null | undefined,
  scopeIds: string[],
): T | null {
  return orderPartnersByScope(rows, scopeIds)[0] ?? null;
}
