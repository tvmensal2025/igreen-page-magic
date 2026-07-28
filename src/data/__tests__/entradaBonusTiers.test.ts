import { describe, it, expect } from "vitest";
import {
  ENTRADA_BONUS_TETO,
  resolveEntradaFaixa,
} from "../entradaBonusTiers";

describe("entradaBonusTiers", () => {
  it("tetos oficiais", () => {
    expect(ENTRADA_BONUS_TETO.alto).toBe(60);
    expect(ENTRADA_BONUS_TETO.medio).toBe(40);
    expect(ENTRADA_BONUS_TETO.sem_bonus).toBe(0);
  });

  it("tier alto sobe até 60% em 200 pessoas", () => {
    expect(resolveEntradaFaixa("alto", 5).totalPct).toBe(4);
    expect(resolveEntradaFaixa("alto", 10).totalPct).toBe(20);
    expect(resolveEntradaFaixa("alto", 40).imediatoPct).toBe(20);
    expect(resolveEntradaFaixa("alto", 100).totalPct).toBe(50);
    expect(resolveEntradaFaixa("alto", 200).totalPct).toBe(60);
    expect(resolveEntradaFaixa("alto", 200).imediatoPct).toBe(40);
    expect(resolveEntradaFaixa("alto", 200).injecaoPct).toBe(20);
  });

  it("tier médio trava em 40% a partir de 40 pessoas", () => {
    expect(resolveEntradaFaixa("medio", 10).totalPct).toBe(20);
    expect(resolveEntradaFaixa("medio", 40).totalPct).toBe(40);
    expect(resolveEntradaFaixa("medio", 200).totalPct).toBe(40);
  });
});
