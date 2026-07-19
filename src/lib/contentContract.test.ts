import { describe, expect, it } from "vitest";
import {
  parseContractButtons,
  validateContractButtons,
  WHAPI_MAX_BUTTONS,
} from "./contentContract";

describe("contentContract (frontend)", () => {
  it("aceita até 3 botões válidos", () => {
    expect(
      validateContractButtons([
        { id: "a", title: "Até R$300" },
        { id: "b", title: "R$300 a R$700" },
        { id: "c", title: "Acima de R$700" },
      ]).ok,
    ).toBe(true);
  });

  it("rejeita mais que o limite Whapi", () => {
    const btns = Array.from({ length: WHAPI_MAX_BUTTONS + 1 }, (_, i) => ({
      id: `b${i}`,
      title: `${i}`,
    }));
    expect(validateContractButtons(btns).ok).toBe(false);
  });

  it("parseContractButtons fail-safe", () => {
    expect(parseContractButtons(null)).toBeNull();
    expect(parseContractButtons([{ id: "x", title: "Ok" }])).toEqual([
      { id: "x", title: "Ok" },
    ]);
    expect(
      parseContractButtons([{ id: "a", title: "Título absurdamente longo demais aqui" }]),
    ).toBeNull();
  });
});
