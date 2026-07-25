// Tests for the idempotency wiring inside `_shared/evolution-api.ts`
// (Task 8 of `whatsapp-flow-reliability-fix`).
//
// We mock both the `fetch` global (so the test never hits the network)
// and the Supabase client (so we observe how `acquireOutboundSlot` is
// invoked). The fake supabase mirrors the in-memory model from
// `idempotency_test.ts` — same INSERT-on-conflict semantics, same shape.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import fc from "https://esm.sh/fast-check@3.23.2";

import { createEvolutionSender } from "./evolution-api.ts";
import { computeIdempotencyKey } from "./idempotency.ts";
import { _clearWhatsAppChatIdMemoryCacheForTests } from "./resolve-whatsapp-chat-id.ts";

// ─── Fake supabase ────────────────────────────────────────────────────────

interface OutboundRow {
  idempotency_key: string;
  customer_id: string;
  consultant_id: string;
  payload_hash: string;
  result_status: string | null;
  evolution_message_id: string | null;
}

function makeFakeSupabase() {
  const rows = new Map<string, OutboundRow>();
  // Simulates ON CONFLICT DO NOTHING under serializable inserts: the very
  // first caller wins, every other concurrent caller receives [].
  function tryInsert(
    row: Omit<OutboundRow, "result_status" | "evolution_message_id">,
  ) {
    if (rows.has(row.idempotency_key)) return [];
    rows.set(row.idempotency_key, {
      ...row,
      result_status: null,
      evolution_message_id: null,
    });
    return [{
      result_status: null,
      evolution_message_id: null,
    }];
  }

  const client = {
    from(_table: string) {
      return {
        upsert(
          row: Omit<OutboundRow, "result_status" | "evolution_message_id">,
          _opts: { onConflict: string; ignoreDuplicates: boolean },
        ) {
          return {
            select(_cols: string) {
              return Promise.resolve({ data: tryInsert(row), error: null });
            },
          };
        },
        select(_cols: string) {
          return {
            eq(_col: string, val: string) {
              return {
                maybeSingle() {
                  return Promise.resolve({
                    data: rows.get(val) ?? null,
                    error: null,
                  });
                },
              };
            },
          };
        },
        update(patch: Partial<OutboundRow>) {
          return {
            eq(_col: string, val: string) {
              const existing = rows.get(val);
              if (existing) rows.set(val, { ...existing, ...patch });
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };

  return { client: client as any, rows };
}

// ─── Fake fetch ──────────────────────────────────────────────────────────

interface FetchInvocation {
  url: string;
  init?: RequestInit;
}

const okResponse = () =>
  new Response(JSON.stringify({ key: { id: "evo-1" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

/** Evolution check de número (resolveDestination) — resposta válida. */
function evolutionNumbersOk(phoneHint = "5511999999999") {
  return new Response(
    JSON.stringify([
      { exists: true, jid: `${phoneHint}@s.whatsapp.net`, number: phoneHint },
    ]),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function installFetchSpy(handler: (call: FetchInvocation) => Response) {
  const calls: FetchInvocation[] = [];
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).fetch = (url: any, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    // Resolve de destino (BR 9º dígito) — obrigatório antes do sendText.
    if (String(url).includes("/chat/whatsappNumbers/")) {
      return Promise.resolve(evolutionNumbersOk());
    }
    try {
      return Promise.resolve(handler(call));
    } catch (e) {
      return Promise.reject(e);
    }
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
// ─── Unit tests ──────────────────────────────────────────────────────────

Deno.test("sendText short-circuits second call with same idempotencyKey", async () => {
  _clearWhatsAppChatIdMemoryCacheForTests();
  const fake = makeFakeSupabase();
  const sendCalls: FetchInvocation[] = [];
  // Only count Evolution send endpoints — the helper may issue a PATCH
  // to whatsapp_instances on connection-closed (not exercised here).
  const spy = installFetchSpy((call) => {
    if (call.url.includes("/message/sendText/")) sendCalls.push(call);
    return okResponse();
  });

  try {
    const sender = createEvolutionSender(
      "http://evo.test",
      "key-x",
      "inst-1",
    );
    const idem = {
      idempotencyKey: "k-stable",
      customerId: "c-1",
      consultantId: "k-1",
      payloadHash: "p-1",
      supabase: fake.client,
    };
    const jid = "5511999887766@s.whatsapp.net";
    const r1 = await sender.sendText(jid, "oii", idem);
    const r2 = await sender.sendText(jid, "oii", idem);

    assertEquals(r1, true);
    assertEquals(r2, true);
    assertEquals(sendCalls.length, 1);
    assertEquals(fake.rows.size, 1);
  } finally {
    spy.restore();
  }
});

Deno.test("sendText without idempotencyKey behaves identically to legacy", async () => {
  _clearWhatsAppChatIdMemoryCacheForTests();
  const sendCalls: FetchInvocation[] = [];
  // First fetch fails with 500; second succeeds. Backoff path exercised.
  let nth = 0;
  const spy = installFetchSpy((call) => {
    if (call.url.includes("/message/sendText/")) {
      sendCalls.push(call);
      nth += 1;
      if (nth === 1) return new Response("temporary", { status: 503 });
    }
    return okResponse();
  });

  try {
    const sender = createEvolutionSender(
      "http://evo.test",
      "key-x",
      "inst-1",
    );
    const r = await sender.sendText("5511999887766@s.whatsapp.net", "oii");
    assertEquals(r, true);
    // Retry happened — at least 2 invocations.
    assertEquals(sendCalls.length >= 2, true);
  } finally {
    spy.restore();
  }
});

Deno.test("sendText replays prior failed result without re-sending", async () => {
  _clearWhatsAppChatIdMemoryCacheForTests();
  const fake = makeFakeSupabase();
  // Pre-seed with a prior failed outcome.
  fake.rows.set("k-prev-fail", {
    idempotency_key: "k-prev-fail",
    customer_id: "c-1",
    consultant_id: "k-1",
    payload_hash: "p-1",
    result_status: "failed",
    evolution_message_id: null,
  });

  const sendCalls: FetchInvocation[] = [];
  const spy = installFetchSpy((call) => {
    if (call.url.includes("/message/sendText/")) sendCalls.push(call);
    return okResponse();
  });

  try {
    const sender = createEvolutionSender(
      "http://evo.test",
      "key-x",
      "inst-1",
    );
    const r = await sender.sendText("5511999887766@s.whatsapp.net", "oii", {
      idempotencyKey: "k-prev-fail",
      customerId: "c-1",
      consultantId: "k-1",
      payloadHash: "p-1",
      supabase: fake.client,
    });
    // Prior outcome was "failed" → replay returns false; no new fetch.
    assertEquals(r, false);
    assertEquals(sendCalls.length, 0);
  } finally {
    spy.restore();
  }
});

Deno.test("sendText replays prior 'sent' result without re-sending", async () => {
  _clearWhatsAppChatIdMemoryCacheForTests();
  const fake = makeFakeSupabase();
  fake.rows.set("k-prev-ok", {
    idempotency_key: "k-prev-ok",
    customer_id: "c-1",
    consultant_id: "k-1",
    payload_hash: "p-1",
    result_status: "sent",
    evolution_message_id: "evo-old",
  });

  const sendCalls: FetchInvocation[] = [];
  const spy = installFetchSpy((call) => {
    if (call.url.includes("/message/sendText/")) sendCalls.push(call);
    return okResponse();
  });

  try {
    const sender = createEvolutionSender(
      "http://evo.test",
      "key-x",
      "inst-1",
    );
    const r = await sender.sendText("5511999887766@s.whatsapp.net", "oii", {
      idempotencyKey: "k-prev-ok",
      customerId: "c-1",
      consultantId: "k-1",
      payloadHash: "p-1",
      supabase: fake.client,
    });
    assertEquals(r, true);
    assertEquals(sendCalls.length, 0);
  } finally {
    spy.restore();
  }
});

Deno.test("sendText with idempotency missing supabase still sends (fail-open)", async () => {
  _clearWhatsAppChatIdMemoryCacheForTests();
  const sendCalls: FetchInvocation[] = [];
  const spy = installFetchSpy((call) => {
    if (call.url.includes("/message/sendText/")) sendCalls.push(call);
    return okResponse();
  });

  try {
    const sender = createEvolutionSender(
      "http://evo.test",
      "key-x",
      "inst-1",
    );
    const r1 = await sender.sendText("5511999887766@s.whatsapp.net", "oii", {
      idempotencyKey: "k1",
      customerId: "c-1",
      consultantId: "k-1",
      payloadHash: "p-1",
      // supabase omitted → idempotency disabled
    });
    const r2 = await sender.sendText("5511999887766@s.whatsapp.net", "oii", {
      idempotencyKey: "k1",
      customerId: "c-1",
      consultantId: "k-1",
      payloadHash: "p-1",
    });
    assertEquals(r1, true);
    assertEquals(r2, true);
    // No idempotency layer → both calls hit fetch.
    assertEquals(sendCalls.length, 2);
  } finally {
    spy.restore();
  }
});

// ─── Property-based test ─────────────────────────────────────────────────

/**
 * **Validates: Requirements 2.7** — N concurrent sendText calls with the
 * same idempotency key issue exactly one Evolution HTTP request.
 *
 * Models the postgres `INSERT ... ON CONFLICT DO NOTHING RETURNING` as a
 * Map probe inside the fake supabase: the very first arrival inserts and
 * receives a non-empty array; every other arrival sees the row and gets
 * an empty array. Even with `Promise.all`, the JS event loop serializes
 * these writes so the property holds.
 */
Deno.test("PBT: N concurrent sendText calls with same key → one fetch", async () => {
  _clearWhatsAppChatIdMemoryCacheForTests();
  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 32 }),
      fc.integer({ min: 2, max: 8 }),
      async (key, n) => {
        _clearWhatsAppChatIdMemoryCacheForTests();
        const fake = makeFakeSupabase();
        const sendCalls: FetchInvocation[] = [];
        const spy = installFetchSpy((call) => {
          if (call.url.includes("/message/sendText/")) sendCalls.push(call);
          return okResponse();
        });

        try {
          const sender = createEvolutionSender(
            "http://evo.test",
            "key-x",
            "inst-1",
          );
          const idem = {
            idempotencyKey: key,
            customerId: "c-1",
            consultantId: "k-1",
            payloadHash: "p-1",
            supabase: fake.client,
          };
          const promises = Array.from(
            { length: n },
            () => sender.sendText("5511999887766@s.whatsapp.net", "oii", idem),
          );
          const results = await Promise.all(promises);
          // All should report success (one truly sent, the rest replayed).
          const okCount = results.filter((x) => x === true).length;
          return (
            sendCalls.length === 1 &&
            okCount === n &&
            fake.rows.size === 1
          );
        } finally {
          spy.restore();
        }
      },
    ),
    { numRuns: 30 },
  );
});

/**
 * Sanity check: with the public `computeIdempotencyKey` helper, two
 * `sendText` invocations from different turns (different bucket, content)
 * generate distinct keys and both reach Evolution.
 */
Deno.test("PBT: distinct logical turns generate distinct keys → both reach fetch", async () => {
  _clearWhatsAppChatIdMemoryCacheForTests();
  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 40 }),
      fc.string({ minLength: 1, maxLength: 40 }),
      async (textA, textB) => {
        _clearWhatsAppChatIdMemoryCacheForTests();
        if (textA === textB) return true; // not a real diff

        const fake = makeFakeSupabase();
        const sendCalls: FetchInvocation[] = [];
        const spy = installFetchSpy((call) => {
          if (call.url.includes("/message/sendText/")) sendCalls.push(call);
          return okResponse();
        });

        try {
          const sender = createEvolutionSender(
            "http://evo.test",
            "key-x",
            "inst-1",
          );
          const baseCtx = {
            customerId: "c-1",
            consultantId: "k-1",
            payloadHash: "p-1",
            supabase: fake.client,
          };
          const keyA = await computeIdempotencyKey({
            customerId: "c-1",
            step: "welcome",
            content: textA,
            minuteBucket: 1,
          });
          const keyB = await computeIdempotencyKey({
            customerId: "c-1",
            step: "welcome",
            content: textB,
            minuteBucket: 1,
          });
          await sender.sendText("5511999887766@s.whatsapp.net", textA, {
            ...baseCtx,
            idempotencyKey: keyA,
          });
          await sender.sendText("5511999887766@s.whatsapp.net", textB, {
            ...baseCtx,
            idempotencyKey: keyB,
          });
          return sendCalls.length === 2 && fake.rows.size === 2;
        } finally {
          spy.restore();
        }
      },
    ),
    { numRuns: 30 },
  );
});
