import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildSpendActivityLabel,
  parseSpendChargeResult,
} from "./ads-spend-billing.ts";

Deno.test("rótulo lista impressões, cliques e leads em português", () => {
  assertEquals(
    buildSpendActivityLabel({ impressions: 120, clicks: 3, leads: 1 }),
    "120 impr., 3 cliques, 1 lead",
  );
  assertEquals(
    buildSpendActivityLabel({ impressions: 5, clicks: 1, leads: 2 }),
    "5 impr., 1 clique, 2 leads",
  );
});

Deno.test("variação zero ou negativa não aparece no rótulo", () => {
  // Meta às vezes revisa números para baixo; "-2 cliques" não ajuda ninguém.
  assertEquals(
    buildSpendActivityLabel({ impressions: 10, clicks: -4, leads: 0 }),
    "10 impr.",
  );
  assertEquals(
    buildSpendActivityLabel({ impressions: 0, clicks: 0, leads: 0 }),
    "sem novas interações",
  );
  assertEquals(
    buildSpendActivityLabel({ impressions: -1, clicks: -1, leads: -1 }),
    "sem novas interações",
  );
});

Deno.test("cobrança confirmada é reconhecida com os valores do RPC", () => {
  const result = parseSpendChargeResult({
    charged: true,
    reason: "charged",
    delta_spend_cents: 1500,
    fee_cents: 300,
    charged_cents: 1800,
    synced_to_wallet_cents: 4500,
    balance_after_cents: 22000,
    observation_id: "obs-1",
  });
  assertEquals(result.charged, true);
  assertEquals(result.charged_cents, 1800);
  assertEquals(result.synced_to_wallet_cents, 4500);
  assertEquals(result.observation_id, "obs-1");
});

Deno.test("observação duplicada não conta como nova cobrança", () => {
  const result = parseSpendChargeResult({
    charged: false,
    reason: "duplicate_observation",
    synced_to_wallet_cents: 4500,
  });
  assertEquals(result.charged, false);
  assertEquals(result.reason, "duplicate_observation");
});

Deno.test("resposta ilegível nunca é lida como cobrança feita", () => {
  // Se assumíssemos sucesso aqui, um gasto real deixaria de ser cobrado.
  for (const raw of [null, undefined, "erro", 42]) {
    const result = parseSpendChargeResult(raw);
    assertEquals(result.charged, false);
    assertEquals(result.reason, "invalid_rpc_response");
  }
});

Deno.test("balance_after_cents ausente fica undefined, não zero", () => {
  // Zero significaria "carteira vazia" e dispararia pausa por saldo à toa.
  const result = parseSpendChargeResult({ charged: false, reason: "no_delta" });
  assertEquals(result.balance_after_cents, undefined);
});
