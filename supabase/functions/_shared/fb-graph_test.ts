import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  fbCreate,
  FbGraphError,
  fbRead,
  fbWriteIdempotent,
} from "./fb-graph.ts";

function installFetchSequence(responses: Response[]) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    const response = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    return Promise.resolve(response.clone());
  }) as typeof fetch;

  return {
    calls: () => calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function transientFailure(): Response {
  return Response.json(
    { error: { message: "temporário", code: 2 } },
    { status: 500 },
  );
}

Deno.test("fbCreate não repete POST de criação em falha transitória", async () => {
  const spy = installFetchSequence([
    transientFailure(),
    Response.json({ id: "duplicado-indesejado" }),
  ]);

  try {
    await assertRejects(
      () => fbCreate("/act_1/campaigns", { body: "name=x" }),
      FbGraphError,
    );
    assertEquals(spy.calls(), 1);
  } finally {
    spy.restore();
  }
});

Deno.test("fbRead pode retentar leitura transitória", async () => {
  const spy = installFetchSequence([
    transientFailure(),
    Response.json({ data: [{ id: "ok" }] }),
  ]);

  try {
    const result = await fbRead("/act_1/campaigns", undefined, 2);
    assertEquals(result.data[0].id, "ok");
    assertEquals(spy.calls(), 2);
  } finally {
    spy.restore();
  }
});

Deno.test("fbWriteIdempotent só retenta quando o chamador declara idempotência", async () => {
  const spy = installFetchSequence([
    transientFailure(),
    Response.json({ success: true }),
  ]);

  try {
    const result = await fbWriteIdempotent(
      "/campaign_1",
      { method: "POST", body: "status=PAUSED" },
      2,
    );
    assertEquals(result.success, true);
    assertEquals(spy.calls(), 2);
  } finally {
    spy.restore();
  }
});
