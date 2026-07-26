import { describe, it, expect } from "vitest";
import {
  parseIgreenDate,
  resolvePosVendaReferenceDate,
  suggestPosVendaStageFromDate,
  formatPosVendaDateBR,
} from "./posVendaReferenceDate";

describe("posVendaReferenceDate", () => {
  const now = new Date("2026-07-26T15:00:00.000Z");

  it("parseia ISO e BR", () => {
    expect(formatPosVendaDateBR(parseIgreenDate("2026-02-18"))).toBe("18/02/2026");
    expect(formatPosVendaDateBR(parseIgreenDate("18/02/2026"))).toBe("18/02/2026");
  });

  it("prioriza data_ativo sobre cadastro mais recente", () => {
    const ref = resolvePosVendaReferenceDate({
      data_ativo_igreen: "2026-02-18",
      data_cadastro_igreen: "2026-07-04",
    }, now);
    expect(formatPosVendaDateBR(ref)).toBe("18/02/2026");
    expect(suggestPosVendaStageFromDate(ref, now)).toBe("d150");
  });

  it("ignora data futura", () => {
    const ref = resolvePosVendaReferenceDate({
      data_cadastro_igreen: "2026-12-06",
      data_ativo_igreen: "2026-05-01",
    }, now);
    expect(formatPosVendaDateBR(ref)).toBe("01/05/2026");
  });

  it("sugere aprovado quando recente", () => {
    const ref = resolvePosVendaReferenceDate({ data_ativo_igreen: "2026-07-20" }, now);
    expect(suggestPosVendaStageFromDate(ref, now)).toBe("aprovado");
  });
});
