/**
 * Helper PURO de montagem da pool de rodízio (Tarefa 5.2 do spec
 * `rodizio-leads-anuncio`).
 *
 * A regra de NEGÓCIO de "criar ou não a pool" e o FORMATO dos payloads de
 * `rodizio_pools` e `rodizio_pool_members` ficam isolados aqui, fora do
 * `Deno.serve` da edge function. Assim a lógica pode ser testada sob Vitest
 * (Node) sem precisar mockar a Meta, a carteira, o token, etc. — o `index.ts`
 * apenas consome este helper e faz os `insert` no Supabase.
 *
 * Regras (ver design.md → "Edge function facebook-create-campaign" e Req 6):
 * - Só cria a pool quando o toggle de rodízio veio ligado (`rodizio_enabled`)
 *   E há pelo menos 1 participante (destino exclusivo = 1; rodízio circular = 2+).
 * - A pool é ligada ao `campaign_id` da campanha recém-criada e ao
 *   `consultant_id` do dono (o consultor logado).
 * - Os membros entram na ORDEM recebida: `position` 0..n e `lead_count` 0.
 */

/** Subconjunto do corpo da requisição que interessa ao rodízio. */
export interface RodizioInput {
  rodizio_enabled?: boolean;
  rodizio_partner_ids?: string[];
}

/** Payload de insert em `rodizio_pools`. */
export interface RodizioPoolInsert {
  campaign_id: string;
  consultant_id: string;
  label: string;
  is_enabled: boolean;
  is_active: boolean;
}

/** Payload de insert em `rodizio_pool_members`. */
export interface RodizioPoolMemberInsert {
  pool_id: string;
  partner_id: string;
  position: number;
  lead_count: number;
}

/** Plano de criação da pool: o insert da pool + um construtor dos membros. */
export interface RodizioPoolPlan {
  pool: RodizioPoolInsert;
  /**
   * Monta os membros na ordem recebida a partir do id da pool recém-criada
   * (o `pool.id` só existe após o insert da pool no banco).
   */
  buildMembers: (poolId: string) => RodizioPoolMemberInsert[];
}

/**
 * Normaliza a lista de ids de participantes do corpo da requisição,
 * garantindo um array (mesmo quando o campo vem ausente ou inválido),
 * sem duplicatas e preservando a ordem.
 */
export function normalizeRodizioPartnerIds(input: RodizioInput): string[] {
  const raw = Array.isArray(input.rodizio_partner_ids) ? input.rodizio_partner_ids : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of raw) {
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Mantém só os ids permitidos (ex.: ativos + do dono), na ordem original.
 */
export function filterRodizioPartnerIds(
  orderedIds: string[],
  allowed: Set<string>,
): string[] {
  return orderedIds.filter((id) => allowed.has(id));
}

/**
 * Decide se a pool de rodízio deve ser criada para esta campanha.
 * Verdadeiro quando o toggle está ligado E há >= 1 participante
 * (1 = destino exclusivo com métricas; 2+ = rodízio circular).
 */
export function shouldCreateRodizioPool(input: RodizioInput): boolean {
  return !!input.rodizio_enabled && normalizeRodizioPartnerIds(input).length >= 1;
}

/**
 * Monta os membros da pool na ordem recebida: `position` 0..n, `lead_count` 0.
 */
export function buildRodizioPoolMembers(
  poolId: string,
  partnerIds: string[],
): RodizioPoolMemberInsert[] {
  return partnerIds.map((partnerId, index) => ({
    pool_id: poolId,
    partner_id: partnerId,
    position: index,
    lead_count: 0,
  }));
}

/**
 * Monta o plano de criação da pool de rodízio a partir do corpo da requisição,
 * do id da campanha recém-criada, do dono e do rótulo.
 *
 * Retorna `null` quando o rodízio está desligado ou não há participantes
 * suficientes — nesse caso o chamador NÃO cria pool nenhuma (comportamento de
 * destino único, exatamente como antes — Requisito 6.3).
 */
export function buildRodizioPoolPlan(args: {
  input: RodizioInput;
  campaignId: string;
  consultantId: string;
  label: string;
}): RodizioPoolPlan | null {
  const { input, campaignId, consultantId, label } = args;
  if (!shouldCreateRodizioPool(input)) {
    return null;
  }
  const partnerIds = normalizeRodizioPartnerIds(input);
  return {
    pool: {
      campaign_id: campaignId,
      consultant_id: consultantId,
      label,
      is_enabled: true,
      // A configuração existe, mas só fica operacional após a campanha ativa.
      is_active: false,
    },
    buildMembers: (poolId: string) => buildRodizioPoolMembers(poolId, partnerIds),
  };
}
