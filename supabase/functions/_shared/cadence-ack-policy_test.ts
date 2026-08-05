import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideAckAction } from "./cadence-ack-policy.ts";

const base = {
  deliveryStatus: "queued" as string | null,
  externalMessageId: "wamid.123" as string | null,
  acked: false,
  stale: false,
  attempts: 0,
  maxAttempts: 5,
};

Deno.test("ACK confirmado avança a escada", () => {
  assertEquals(decideAckAction({ ...base, acked: true }), "advance_acked");
});

Deno.test("recém-enviado espera o webhook", () => {
  assertEquals(decideAckAction(base), "wait");
});

Deno.test("caso real Miriam: aceito sem id não reenvia", () => {
  // 04/08: 5 cópias do COLD_1 porque delivery_status ficou "queued" e o
  // external_message_id veio null — o ACK nunca teria como casar.
  const acao = decideAckAction({
    ...base,
    externalMessageId: null,
    stale: true,
    attempts: 1,
  });
  assertEquals(acao, "advance_unverifiable");
});

Deno.test("sem id continua sem reenviar em qualquer tentativa", () => {
  for (const attempts of [0, 1, 2, 3, 4, 5]) {
    assertEquals(
      decideAckAction({ ...base, externalMessageId: null, stale: true, attempts }),
      "advance_unverifiable",
      `tentativa ${attempts} não pode reenviar sem id`,
    );
  }
});

Deno.test("id vazio ou só espaço conta como sem id", () => {
  for (const id of ["", "   ", null]) {
    assertEquals(
      decideAckAction({ ...base, externalMessageId: id, stale: true }),
      "advance_unverifiable",
    );
  }
});

Deno.test("falha declarada pelo provedor reenvia enquanto houver tentativa", () => {
  assertEquals(
    decideAckAction({ ...base, deliveryStatus: "failed", attempts: 2 }),
    "reopen",
  );
  assertEquals(
    decideAckAction({ ...base, deliveryStatus: "failed", attempts: 5 }),
    "advance_max_attempts",
  );
});

Deno.test("falha declarada sem id também reenvia (o id não é o problema)", () => {
  assertEquals(
    decideAckAction({ ...base, deliveryStatus: "failed", externalMessageId: null }),
    "reopen",
  );
});

Deno.test("com id e sem ACK depois do prazo: reenvia até o teto", () => {
  assertEquals(decideAckAction({ ...base, stale: true, attempts: 0 }), "reopen");
  assertEquals(
    decideAckAction({ ...base, stale: true, attempts: 5 }),
    "advance_max_attempts",
  );
});
