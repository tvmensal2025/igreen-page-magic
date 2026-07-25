import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canProceedWithPublish,
  claimPublishSaga,
  claimRejectionResponse,
  parseClaimResult,
  resolveClientRequestId,
  type SagaRpcClient,
} from "./ad-publish-saga.ts";

const CONSULTANT = "11111111-1111-1111-1111-111111111111";
const PAYLOAD = { name: "MG Uberlândia", daily_budget_cents: 1000 };

function fakeClient(
  response: { data: unknown; error: { message: string } | null },
): SagaRpcClient & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    rpc: (name, args) => {
      calls.push({ name, ...args });
      return Promise.resolve(response);
    },
  };
}

Deno.test("duplo clique com o mesmo payload gera a MESMA chave", async () => {
  const first = await resolveClientRequestId(
    CONSULTANT,
    undefined,
    PAYLOAD,
    "2026-07-24",
  );
  const second = await resolveClientRequestId(CONSULTANT, undefined, {
    daily_budget_cents: 1000,
    name: "MG Uberlândia",
  }, "2026-07-24");
  assertEquals(first, second, "ordem das chaves não pode mudar a identidade");
});

Deno.test("mesma configuração em outro dia PODE ser publicada de novo", async () => {
  // Chave eterna condenaria o consultor a nunca republicar a mesma campanha:
  // a segunda tentativa receberia de volta o campaign_id da antiga.
  const hoje = await resolveClientRequestId(
    CONSULTANT,
    undefined,
    PAYLOAD,
    "2026-07-24",
  );
  const outroDia = await resolveClientRequestId(
    CONSULTANT,
    undefined,
    PAYLOAD,
    "2026-08-24",
  );
  assertNotEquals(hoje, outroDia);
});

Deno.test("payload diferente gera chave diferente", async () => {
  const a = await resolveClientRequestId(
    CONSULTANT,
    undefined,
    PAYLOAD,
    "2026-07-24",
  );
  const b = await resolveClientRequestId(CONSULTANT, undefined, {
    ...PAYLOAD,
    daily_budget_cents: 2000,
  }, "2026-07-24");
  assertNotEquals(a, b);
});

Deno.test("consultores diferentes não colidem com payload idêntico", async () => {
  const a = await resolveClientRequestId(
    CONSULTANT,
    undefined,
    PAYLOAD,
    "2026-07-24",
  );
  const b = await resolveClientRequestId(
    "22222222-2222-2222-2222-222222222222",
    undefined,
    PAYLOAD,
    "2026-07-24",
  );
  assertNotEquals(a, b);
});

Deno.test("chave do cliente é respeitada; valor suspeito é descartado", async () => {
  assertEquals(
    await resolveClientRequestId(CONSULTANT, "publish-abc-123", PAYLOAD),
    "publish-abc-123",
  );
  // Curta demais: provavelmente não é chave de idempotência real.
  const derived = await resolveClientRequestId(CONSULTANT, "x", PAYLOAD);
  assertEquals(derived.startsWith("auto:"), true);
});

Deno.test("só claimed/reclaimed liberam chamada à Meta", () => {
  assertEquals(canProceedWithPublish("claimed"), true);
  assertEquals(canProceedWithPublish("reclaimed"), true);
  for (
    const outcome of [
      "already_completed",
      "in_flight",
      "requires_reconciliation",
      "owner_mismatch",
      "payload_mismatch",
      "unknown",
    ] as const
  ) {
    assertEquals(canProceedWithPublish(outcome), false, outcome);
  }
});

Deno.test("replay devolve o resultado original com 200, sem republicar", () => {
  const rejection = claimRejectionResponse({
    outcome: "already_completed",
    sagaId: "saga-1",
    result: { ok: true, campaign_id: "123" },
  });
  assertEquals(rejection.status, 200);
  assertEquals(rejection.body.campaign_id, "123");
  assertEquals(rejection.body.idempotent_replay, true);
});

Deno.test("publicação em andamento responde 409, não cria segunda campanha", () => {
  const rejection = claimRejectionResponse({
    outcome: "in_flight",
    sagaId: "saga-1",
    lockedUntil: "2026-07-24T12:00:00Z",
  });
  assertEquals(rejection.status, 409);
  assertEquals(rejection.body.code, "PUBLISH_IN_FLIGHT");
});

Deno.test("saga órfã pede conferência humana e expõe o id da Meta", () => {
  const rejection = claimRejectionResponse({
    outcome: "requires_reconciliation",
    sagaId: "saga-1",
    fbCampaignId: "120200",
    stage: "campaign_created",
  });
  assertEquals(rejection.status, 409);
  assertEquals(rejection.body.code, "PUBLISH_REQUIRES_RECONCILIATION");
  assertEquals(rejection.body.fb_campaign_id, "120200");
});

Deno.test("erro de RPC no claim NÃO libera publicação (fail-closed)", async () => {
  const client = fakeClient({ data: null, error: { message: "boom" } });
  const claim = await claimPublishSaga(client, {
    clientRequestId: "publish-abc-123",
    consultantId: CONSULTANT,
  });
  assertEquals(claim.outcome, "unknown");
  assertEquals(canProceedWithPublish(claim.outcome), false);
});

Deno.test("claim repassa a chave e o consultor para o RPC", async () => {
  const client = fakeClient({
    data: { outcome: "claimed", saga_id: "saga-9", stage: "claimed" },
    error: null,
  });
  const claim = await claimPublishSaga(client, {
    clientRequestId: "publish-abc-123",
    consultantId: CONSULTANT,
    requestHash: "hash-1",
  });
  assertEquals(claim.outcome, "claimed");
  assertEquals(claim.sagaId, "saga-9");
  assertEquals(client.calls[0].name, "claim_ad_publish_saga");
  assertEquals(client.calls[0]._client_request_id, "publish-abc-123");
  assertEquals(client.calls[0]._consultant_id, CONSULTANT);
});

Deno.test("resposta desconhecida do RPC vira outcome unknown", () => {
  assertEquals(parseClaimResult(null).outcome, "unknown");
  assertEquals(parseClaimResult({ outcome: 42 }).outcome, "unknown");
});
