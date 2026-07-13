/**
 * Testes unitários do parser / normalização de rodizio_assign_lead
 * (lógica pura espelhada de supabase/functions/_shared/rodizio-assign.ts).
 */
import { describe, expect, it } from "vitest";

/** Cópia local tipada do parser (Vitest Node não importa Deno URL). */
function parseRodizioAssignRows(rows: unknown): {
  outcome: string | null;
  partnerId: string | null;
  position: number | null;
  poolId: string | null;
} {
  const pick = Array.isArray(rows) ? rows[0] : rows;
  if (!pick || typeof pick !== "object") {
    return { outcome: null, partnerId: null, position: null, poolId: null };
  }
  const row = pick as Record<string, unknown>;
  const outcome = typeof row.outcome === "string" ? row.outcome.trim() : null;
  const partnerRaw = row.partner_id;
  const partnerId =
    typeof partnerRaw === "string" && partnerRaw.trim().length > 0
      ? partnerRaw.trim()
      : null;
  const position =
    typeof row.position === "number" && Number.isFinite(row.position)
      ? row.position
      : null;
  const poolRaw = row.pool_id;
  const poolId =
    typeof poolRaw === "string" && poolRaw.trim().length > 0
      ? poolRaw.trim()
      : null;
  return { outcome, partnerId, position, poolId };
}

function normalizeOutcome(
  raw: string | null,
): "assigned" | "already_assigned" | "pool_empty" | "customer_missing" | "rpc_error" {
  switch (raw) {
    case "assigned":
    case "already_assigned":
    case "pool_empty":
    case "customer_missing":
      return raw;
    default:
      return "rpc_error";
  }
}

describe("parseRodizioAssignRows", () => {
  it("lê assigned em array (formato PostgREST)", () => {
    const parsed = parseRodizioAssignRows([
      {
        outcome: "assigned",
        partner_id: "p1",
        position: 0,
        pool_id: "pool1",
      },
    ]);
    expect(parsed).toEqual({
      outcome: "assigned",
      partnerId: "p1",
      position: 0,
      poolId: "pool1",
    });
    expect(normalizeOutcome(parsed.outcome)).toBe("assigned");
  });

  it("lê already_assigned sem consumir turno", () => {
    const parsed = parseRodizioAssignRows({
      outcome: "already_assigned",
      partner_id: "p2",
      position: null,
      pool_id: null,
    });
    expect(normalizeOutcome(parsed.outcome)).toBe("already_assigned");
    expect(parsed.partnerId).toBe("p2");
  });

  it("pool_empty / customer_missing / lixo → outcomes corretos", () => {
    expect(normalizeOutcome(parseRodizioAssignRows([{ outcome: "pool_empty" }]).outcome)).toBe(
      "pool_empty",
    );
    expect(
      normalizeOutcome(parseRodizioAssignRows([{ outcome: "customer_missing" }]).outcome),
    ).toBe("customer_missing");
    expect(normalizeOutcome(parseRodizioAssignRows(null).outcome)).toBe("rpc_error");
    expect(normalizeOutcome(parseRodizioAssignRows([{ outcome: "???" }]).outcome)).toBe(
      "rpc_error",
    );
  });

  it("partner_id vazio vira null", () => {
    const parsed = parseRodizioAssignRows([{ outcome: "assigned", partner_id: "  " }]);
    expect(parsed.partnerId).toBeNull();
  });
});
