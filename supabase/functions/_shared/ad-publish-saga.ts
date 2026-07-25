/**
 * Saga da publicação humana de campanha.
 *
 * Contrato: reservar a intenção ANTES de tocar na Meta, registrar cada estágio,
 * e encerrar com sucesso ou com `requires_reconciliation`. Assim um timeout na
 * UI seguido de novo clique não publica uma segunda campanha real gastando
 * dinheiro, e uma falha depois da criação nunca deixa campanha órfã silenciosa.
 *
 * A decisão de idempotência mora no banco (`claim_ad_publish_saga`); aqui ficam
 * o cliente tipado e as partes puras (derivação da chave e classificação da
 * resposta), que são testáveis sem banco.
 */

import { canonicalHash } from "./canonical-json.ts";

/** Estágios na ordem real da publicação. */
export type AdPublishStage =
  | "claimed"
  | "campaign_created"
  | "adset_created"
  | "ads_created"
  | "persisted"
  | "activated"
  | "completed";

export type ClaimOutcome =
  /** Primeira vez: siga em frente e publique. */
  | "claimed"
  /** Tentativa anterior morreu ANTES de criar na Meta: pode repetir. */
  | "reclaimed"
  /** Já concluída: devolva o resultado original, sem republicar. */
  | "already_completed"
  /** Outra execução está publicando agora. */
  | "in_flight"
  /** Existe objeto na Meta sem par no portal: exige revisão humana. */
  | "requires_reconciliation"
  | "owner_mismatch"
  | "payload_mismatch"
  | "invalid_request_id"
  | "invalid_consultant"
  | "unknown";

export interface ClaimResult {
  outcome: ClaimOutcome;
  sagaId?: string;
  stage?: string;
  attempts?: number;
  lockedUntil?: string;
  fbCampaignId?: string;
  result?: Record<string, unknown>;
}

/** Cliente mínimo — só o que a saga usa. Facilita teste com fake. */
export interface SagaRpcClient {
  // `PromiseLike` (não `Promise`) porque o builder do supabase-js é apenas
  // thenable — usar Promise aqui rejeitaria o client real na checagem de tipos.
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

/**
 * Chave de idempotência da publicação.
 *
 * Se o cliente manda `client_request_id`, respeitamos (ele sabe o que é um
 * retry). Sem isso, derivamos do conteúdo: duplo clique manda exatamente o
 * mesmo payload e cai na mesma chave. O `consultant_id` entra no hash para que
 * dois consultores com payload idêntico não colidam.
 */
export async function resolveClientRequestId(
  consultantId: string,
  provided: unknown,
  payload: unknown,
  /** Dia BRT usado no escopo da chave derivada. Injetável para teste. */
  dayBrt?: string,
): Promise<string> {
  if (typeof provided === "string") {
    const trimmed = provided.trim();
    // Limite defensivo: a coluna é text, mas chave gigante é sinal de abuso.
    if (trimmed.length >= 8 && trimmed.length <= 200) return trimmed;
  }
  // O escopo é o DIA: protege do duplo clique (mesma intenção, mesmo dia) sem
  // condenar o consultor a nunca mais publicar a mesma configuração. Sem isso a
  // chave seria eterna e uma campanha idêntica no mês seguinte receberia de
  // volta o `campaign_id` da antiga, como se já tivesse sido publicada.
  const day = dayBrt ??
    new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const hash = await canonicalHash({ consultantId, day, payload });
  return `auto:${consultantId}:${day}:${hash}`;
}

/** Hash canônico do payload — detecta reuso da chave com conteúdo diferente. */
export function requestHash(payload: unknown): Promise<string> {
  return canonicalHash(payload);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

export function parseClaimResult(raw: unknown): ClaimResult {
  const row = asRecord(raw);
  const outcome = typeof row.outcome === "string" ? row.outcome : "unknown";
  return {
    outcome: outcome as ClaimOutcome,
    sagaId: typeof row.saga_id === "string" ? row.saga_id : undefined,
    stage: typeof row.stage === "string" ? row.stage : undefined,
    attempts: row.attempts === undefined ? undefined : Number(row.attempts),
    lockedUntil: typeof row.locked_until === "string"
      ? row.locked_until
      : undefined,
    fbCampaignId: typeof row.fb_campaign_id === "string"
      ? row.fb_campaign_id
      : undefined,
    result: row.result === undefined ? undefined : asRecord(row.result),
  };
}

/** Pode seguir e chamar a Meta? Só nos dois casos de posse confirmada. */
export function canProceedWithPublish(outcome: ClaimOutcome): boolean {
  return outcome === "claimed" || outcome === "reclaimed";
}

/** Resposta HTTP adequada quando a publicação NÃO deve prosseguir. */
export function claimRejectionResponse(
  claim: ClaimResult,
): { status: number; body: Record<string, unknown> } {
  switch (claim.outcome) {
    case "already_completed":
      // Replay do mesmo pedido: devolve o resultado original, 200.
      return {
        status: 200,
        body: {
          ...(claim.result ?? {}),
          idempotent_replay: true,
          saga_id: claim.sagaId,
        },
      };
    case "in_flight":
      return {
        status: 409,
        body: {
          error:
            "Esta campanha já está sendo publicada. Aguarde a conclusão antes de tentar de novo.",
          code: "PUBLISH_IN_FLIGHT",
          saga_id: claim.sagaId,
          locked_until: claim.lockedUntil,
        },
      };
    case "requires_reconciliation":
      return {
        status: 409,
        body: {
          error:
            "Uma tentativa anterior criou objetos na Meta e precisa de conferência manual antes de publicar de novo.",
          code: "PUBLISH_REQUIRES_RECONCILIATION",
          saga_id: claim.sagaId,
          fb_campaign_id: claim.fbCampaignId,
          stage: claim.stage,
        },
      };
    case "payload_mismatch":
      return {
        status: 409,
        body: {
          error:
            "A mesma chave de publicação foi reutilizada com dados diferentes.",
          code: "PUBLISH_PAYLOAD_MISMATCH",
          saga_id: claim.sagaId,
        },
      };
    case "owner_mismatch":
      return {
        status: 403,
        body: { error: "forbidden", code: "PUBLISH_OWNER_MISMATCH" },
      };
    default:
      return {
        status: 500,
        body: {
          error: "Não foi possível reservar a publicação.",
          code: "PUBLISH_CLAIM_FAILED",
          outcome: claim.outcome,
        },
      };
  }
}

/** Reserva a intenção. Fail-closed: erro de RPC não libera publicação. */
export async function claimPublishSaga(
  client: SagaRpcClient,
  input: {
    clientRequestId: string;
    consultantId: string;
    requestHash?: string;
    leaseSeconds?: number;
  },
): Promise<ClaimResult> {
  const { data, error } = await client.rpc("claim_ad_publish_saga", {
    _client_request_id: input.clientRequestId,
    _consultant_id: input.consultantId,
    _request_hash: input.requestHash ?? null,
    _lease_seconds: input.leaseSeconds ?? 300,
  });
  if (error) {
    console.error("[ad-publish-saga] claim falhou", error.message);
    return { outcome: "unknown" };
  }
  return parseClaimResult(data);
}

/** Marca avanço e renova o lease. Nunca derruba a publicação em andamento. */
export async function recordPublishStage(
  client: SagaRpcClient,
  sagaId: string | undefined,
  stage: AdPublishStage,
  refs: {
    fbCampaignId?: string | null;
    fbAdsetIds?: string[] | null;
    fbAdIds?: string[] | null;
    campaignRowId?: string | null;
  } = {},
): Promise<void> {
  if (!sagaId) return;
  const { error } = await client.rpc("record_ad_publish_stage", {
    _saga_id: sagaId,
    _stage: stage,
    _fb_campaign_id: refs.fbCampaignId ?? null,
    _fb_adset_ids: refs.fbAdsetIds ?? null,
    _fb_ad_ids: refs.fbAdIds ?? null,
    _campaign_row_id: refs.campaignRowId ?? null,
    _lease_seconds: 300,
  });
  if (error) console.warn("[ad-publish-saga] stage", stage, error.message);
}

export async function completePublishSaga(
  client: SagaRpcClient,
  sagaId: string | undefined,
  result: Record<string, unknown>,
): Promise<void> {
  if (!sagaId) return;
  const { error } = await client.rpc("complete_ad_publish_saga", {
    _saga_id: sagaId,
    _result: result,
  });
  if (error) console.error("[ad-publish-saga] complete", error.message);
}

export async function failPublishSaga(
  client: SagaRpcClient,
  sagaId: string | undefined,
  message: string,
  requiresReconciliation?: boolean,
): Promise<void> {
  if (!sagaId) return;
  const { error } = await client.rpc("fail_ad_publish_saga", {
    _saga_id: sagaId,
    _error: message,
    _requires_reconciliation: requiresReconciliation ?? null,
  });
  if (error) console.error("[ad-publish-saga] fail", error.message);
}
