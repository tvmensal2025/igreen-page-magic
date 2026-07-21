/**
 * Helper PURO da decisão do ramo de atribuição por rodízio (round-robin) do
 * `evolution-webhook` — spec `rodizio-leads-anuncio`.
 *
 * Por que existe: o ramo de atribuição roda dentro do `Deno.serve` do
 * `index.ts`, difícil de testar sob Vitest (Node). Toda a DECISÃO (sem efeitos
 * colaterais: sem rede, sem Supabase) foi isolada aqui, para que o `index.ts`
 * só faça os efeitos (chamar `rodizio_next`, dar `update` em `customers` e
 * `notifyPartnerNewLead`) a partir do que esta função decide.
 *
 * Cobre os três comportamentos do ramo, reusados pelos testes de propriedade:
 *  - Property 4 (Tarefa 6.4): atribuição reflete o participante da vez —
 *    `referral_partner_id` = `partner_id` retornado; `consultant_id` intacto.
 *  - Property 5 (Tarefa 6.5): prioridade do rodízio sobre keyword —
 *    quando aplicado, `skipKeywordMatch` é verdadeiro (ignora keyword).
 *  - Property 6 (Tarefa 6.6): fallback seguro — pool vazia/inativa/inexistente
 *    ou retorno inválido => não seta `referral_partner_id`; lead segue ao dono
 *    (consultor com ID na plataforma), `source_campaign_id` preservado.
 *    Webhooks NÃO devem mandar esses casos para fila de revisão manual.
 *
 * NÃO duplica a regra de `idconsultor`/`indcli` (Requisito 12.4): isso é
 * resolvido pelo pipeline existente (`buildPortal2Payload`) a partir do
 * `referral_partner_id` setado aqui.
 */

/**
 * Estado mínimo do customer que o ramo de rodízio consulta. Mantém apenas os
 * campos relevantes para a decisão (os demais campos do customer são ignorados
 * e preservados pelo chamador).
 */
export interface RodizioCustomerState {
  /** Participante já atribuído (por outro caminho). Quando preenchido, o
   *  rodízio NÃO roda — respeita a atribuição existente. */
  referral_partner_id?: string | null;
  /** Campanha de origem do lead (CTWA). Sem ela, não há pool a consultar. */
  source_campaign_id?: string | null;
}

/**
 * Decisão pura do ramo de atribuição por rodízio. O `index.ts` traduz isto em
 * efeitos: `update` em customers (quando há `customerPatch`), `notify` ao
 * participante (quando há `notifyPartnerId`) e pular o match por keyword
 * (quando `skipKeywordMatch`).
 */
export interface RodizioAssignmentDecision {
  /** Houve atribuição por rodízio (participante da vez válido). */
  applied: boolean;
  /** Participante da vez atribuído, ou null no fallback. */
  referralPartnerId: string | null;
  /** Patch a aplicar em `customers`. Contém SOMENTE `referral_partner_id`
   *  (o `consultant_id` é deliberadamente preservado — Requisito 7.4).
   *  É null no fallback (não mexe no customer). */
  customerPatch: { referral_partner_id: string } | null;
  /** Quando o rodízio é aplicado, o match por keyword é ignorado para este
   *  lead (prioridade do rodízio — Requisito 8). */
  skipKeywordMatch: boolean;
  /** Participante a avisar via `notifyPartnerNewLead`, ou null. */
  notifyPartnerId: string | null;
}

/**
 * Decide se devemos sequer chamar `rodizio_next` para este lead. Só roda quando
 * o lead veio de um anúncio (`source_campaign_id` resolvido) e ainda não tem
 * `referral_partner_id` (não sobrescreve atribuição existente).
 */
export function isRodizioEligible(
  customer: RodizioCustomerState | null | undefined,
): boolean {
  if (!customer) return false;
  if (customer.referral_partner_id) return false;
  return Boolean(customer.source_campaign_id);
}

/**
 * Extrai o `partner_id` válido do retorno de `rodizio_next`, que é uma TABLE
 * `(partner_id, position, pool_id)`. O cliente Supabase pode devolver um array
 * de linhas (0 linhas = fallback) ou um objeto único. Retorna o `partner_id`
 * apenas quando for uma string não-vazia; caso contrário, null (sinal de
 * fallback — pool vazia/inativa/inexistente ou retorno inválido).
 */
export function extractRodizioPartnerId(rodizioRows: unknown): string | null {
  const pick = Array.isArray(rodizioRows) ? rodizioRows[0] : rodizioRows;
  if (!pick || typeof pick !== "object") return null;
  const partnerId = (pick as { partner_id?: unknown }).partner_id;
  if (typeof partnerId !== "string") return null;
  const trimmed = partnerId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Decisão pura do ramo de atribuição por rodízio.
 *
 * Recebe o estado atual do customer e o retorno cru de `rodizio_next`, e diz o
 * que o chamador deve fazer. Não tem efeitos colaterais.
 *
 * - Inelegível (sem campanha / já com participante) => fallback (não aplica).
 * - Participante válido => atribui: patch com `referral_partner_id` (sem mexer
 *   no `consultant_id`), pula keyword e avisa o participante.
 * - Retorno vazio/inválido => fallback seguro: não mexe no customer.
 */
export function decideRodizioAssignment(params: {
  customer: RodizioCustomerState | null | undefined;
  rodizioRows: unknown;
}): RodizioAssignmentDecision {
  const { customer, rodizioRows } = params;

  if (!isRodizioEligible(customer)) {
    return fallbackDecision();
  }

  const partnerId = extractRodizioPartnerId(rodizioRows);
  if (!partnerId) {
    // Fallback seguro: pool vazia/inativa/inexistente ou retorno inválido.
    return fallbackDecision();
  }

  // Participante da vez. O patch contém SOMENTE referral_partner_id — o
  // consultant_id permanece o da instância central (Requisito 7.4).
  return {
    applied: true,
    referralPartnerId: partnerId,
    customerPatch: { referral_partner_id: partnerId },
    skipKeywordMatch: true,
    notifyPartnerId: partnerId,
  };
}

/** Decisão de fallback: o lead segue para o consultor dono, sem alteração. */
function fallbackDecision(): RodizioAssignmentDecision {
  return {
    applied: false,
    referralPartnerId: null,
    customerPatch: null,
    skipKeywordMatch: false,
    notifyPartnerId: null,
  };
}

/**
 * Aplica a decisão ao estado do customer e devolve o NOVO estado, sem mutar o
 * original. Útil para o chamador (e para os testes) verificarem o resultado:
 * o `referral_partner_id` passa a ser o participante da vez quando aplicado, e
 * TODOS os demais campos (em especial `consultant_id` e `source_campaign_id`)
 * são preservados intactos.
 */
export function applyRodizioDecisionToCustomer<
  T extends Record<string, unknown>,
>(customer: T, decision: RodizioAssignmentDecision): T {
  if (!decision.customerPatch) return { ...customer };
  return { ...customer, ...decision.customerPatch };
}
