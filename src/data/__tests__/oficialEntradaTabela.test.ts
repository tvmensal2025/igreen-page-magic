import { describe, it, expect } from "vitest";
import {
  OFICIAL_ENTRADA_ALTO,
  OFICIAL_ENTRADA_MEDIO,
  buildOfficialEntradaSeedRows,
} from "../oficialEntradaTabela";

describe("oficialEntradaTabela Jul/2026", () => {
  it("lista as distribuidoras da arte (alto + médio)", () => {
    const altoLabels = OFICIAL_ENTRADA_ALTO.map((d) => d.label);
    expect(altoLabels).toContain("Cemig");
    expect(altoLabels).toContain("Copel");
    expect(altoLabels).toContain("CPFL");
    expect(altoLabels).toContain("Coelba");
    expect(altoLabels).toContain("Energisa Minas Rio");

    const medioLabels = OFICIAL_ENTRADA_MEDIO.map((d) => d.label);
    expect(medioLabels).toContain("Elektro");
    expect(medioLabels).toContain("Celesc");
    expect(medioLabels).toContain("RGE");
  });

  it("seed gera faixas 4/20/40/50/60 no alto e teto 40 no médio", () => {
    const rows = buildOfficialEntradaSeedRows();
    const cemig = rows.filter((r) => r.distribuidora === "CEMIG-D");
    expect(cemig.map((r) => r.entradaTotalPct)).toEqual([4, 20, 40, 50, 60]);

    const elektro = rows.filter((r) => r.distribuidora === "ELEKTRO");
    expect(elektro.map((r) => r.entradaTotalPct)).toEqual([4, 20, 40]);
  });
});
