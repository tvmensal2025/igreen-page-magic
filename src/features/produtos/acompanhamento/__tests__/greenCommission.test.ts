// =============================================================================
// Acompanhamento — Testes do motor de comissão Green
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  baseRecurringPercent,
  isReducedRecurring,
  careerBonusPercent,
  countDirectByDistribuidora,
  resolveEntradaTier,
  computeGreenGains,
  estimateBillValue,
  isDirectCustomer,
  graduacaoRank,
  resolveGraduacao,
  DEFAULT_TARIFA_KWH,
  type EntradaRule,
  type GreenCustomerInput,
  type GreenSettings,
} from "../greenCommission";

function testSettings(over: Partial<GreenSettings> = {}): GreenSettings {
  return {
    graduacao: "licenciado",
    countMode: "somado",
    cadastroIgreenIds: [],
    consultantName: null,
    myIgreenId: null,
    ...over,
  };
}

function rule(over: Partial<EntradaRule> = {}): EntradaRule {
  return {
    distribuidora: "CEMIG",
    minPessoas: 10,
    entradaTotalPct: 20,
    pctImediato: 10,
    pctDiferido: 10,
    diasDiferido: 90,
    ...over,
  };
}

function cust(over: Partial<GreenCustomerInput> = {}): GreenCustomerInput {
  return {
    id: Math.random().toString(36).slice(2),
    isDirect: true,
    distribuidora: "CEMIG",
    uf: "MG",
    faturaValor: 1000,
    validatedAt: "2026-06-10T12:00:00.000Z",
    ...over,
  };
}

describe("baseRecurringPercent / isReducedRecurring", () => {
  it("CP padrão = 4%, CI padrão = 1%", () => {
    expect(baseRecurringPercent(true, "MG", "CEMIG")).toBe(4);
    expect(baseRecurringPercent(false, "MG", "CEMIG")).toBe(1);
  });

  it("exceções ES(EDP), RS(CEEE), SE(Energisa): CP 2% / CI 0,5%", () => {
    expect(isReducedRecurring("SP", "EDP São Paulo")).toBe(false); // SP não é exceção
    expect(isReducedRecurring("ES", "EDP ES")).toBe(true);
    expect(baseRecurringPercent(true, "ES", "EDP ES")).toBe(2);
    expect(baseRecurringPercent(false, "ES", "EDP ES")).toBe(0.5);
    expect(baseRecurringPercent(true, "RS", "CEEE Equatorial")).toBe(2);
    expect(baseRecurringPercent(false, "SE", "Energisa Sergipe")).toBe(0.5);
  });
});

describe("careerBonusPercent", () => {
  it("mapeia graduação para bônus (tolerante a acento/caixa)", () => {
    expect(careerBonusPercent("licenciado")).toBe(0);
    expect(careerBonusPercent("Gestor")).toBe(0.5);
    expect(careerBonusPercent("EXECUTIVO")).toBe(0.8);
    expect(careerBonusPercent("acionista")).toBe(1.8);
    expect(careerBonusPercent("S-Expansão")).toBe(0.2);
    expect(careerBonusPercent("senior")).toBe(0.2);
    expect(careerBonusPercent("desconhecido")).toBe(0);
  });
});

describe("resolveGraduacao", () => {
  it("escolhe a graduação mais alta entre fontes", () => {
    expect(resolveGraduacao("licenciado", "Gestor")).toBe("gestor");
    expect(resolveGraduacao("senior", "gestor", "licenciado")).toBe("gestor");
    expect(resolveGraduacao("s-expansao", "licenciado")).toBe("senior");
    expect(resolveGraduacao(null, undefined, "executivo")).toBe("executivo");
  });

  it("graduacaoRank ordena a escada", () => {
    expect(graduacaoRank("licenciado")).toBeLessThan(graduacaoRank("gestor"));
    expect(graduacaoRank("Gestor")).toBe(graduacaoRank("gestor"));
  });
});

describe("estimateBillValue", () => {
  it("prefere electricity_bill_value quando informado", () => {
    expect(estimateBillValue(350.5, 400, 10)).toBe(350.5);
  });

  it("estima consumo × tarifa com desconto", () => {
    const v = estimateBillValue(null, 300, 15, DEFAULT_TARIFA_KWH);
    expect(v).toBeCloseTo(300 * 0.95 * 0.85, 2);
  });

  it("retorna 0 sem fatura e sem consumo", () => {
    expect(estimateBillValue(null, null, null)).toBe(0);
  });
});

describe("isDirectCustomer", () => {
  const settings = {
    myIgreenId: "122160",
    cadastroIgreenIds: ["124170"],
    consultantName: "Rafael Ferreira",
  };

  it("CP por registered_by_igreen_id = meu ID", () => {
    expect(isDirectCustomer("122160", "Nilma", settings)).toBe(true);
  });

  it("CP por ID extra em cadastroIgreenIds", () => {
    expect(isDirectCustomer("124170", "Nilma", settings)).toBe(true);
  });

  it("CP por fallback nome do cadastrador", () => {
    expect(isDirectCustomer("999999", "Rafael Ferreira", settings)).toBe(true);
  });

  it("CI quando ID e nome não batem", () => {
    expect(isDirectCustomer("999999", "Nilma Silva", settings)).toBe(false);
  });
});

describe("countDirectByDistribuidora", () => {
  it("conta apenas diretos, agrupando por distribuidora normalizada", () => {
    const counts = countDirectByDistribuidora([
      cust({ distribuidora: "CEMIG" }),
      cust({ distribuidora: "cemig" }), // mesma, normalizada
      cust({ distribuidora: "CPFL PAULISTA" }),
      cust({ isDirect: false, distribuidora: "CEMIG" }), // CI não conta
    ]);
    expect(counts.get("CEMIG")).toBe(2);
    expect(counts.get("CPFL PAULISTA")).toBe(1);
  });
});

describe("resolveEntradaTier — modo somado vs individual", () => {
  const rules = [
    rule({ distribuidora: "CEMIG", minPessoas: 10, pctImediato: 10, pctDiferido: 10 }),
    rule({ distribuidora: "CEMIG", minPessoas: 40, entradaTotalPct: 40, pctImediato: 20, pctDiferido: 20 }),
    rule({ distribuidora: "CPFL PAULISTA", minPessoas: 10, pctImediato: 10, pctDiferido: 10 }),
  ];

  it("somado: 5 CEMIG + 5 CPFL = 10 → destrava faixa de 10 para CEMIG", () => {
    const counts = new Map([["CEMIG", 5], ["CPFL PAULISTA", 5]]);
    const tier = resolveEntradaTier(rules, "CEMIG", counts, "somado");
    expect(tier?.minPessoas).toBe(10);
  });

  it("individual: 5 CEMIG isolado não atinge faixa de 10", () => {
    const counts = new Map([["CEMIG", 5], ["CPFL PAULISTA", 5]]);
    const tier = resolveEntradaTier(rules, "CEMIG", counts, "individual");
    expect(tier).toBeNull();
  });

  it("escolhe a MAIOR faixa atingida", () => {
    const counts = new Map([["CEMIG", 45]]);
    const tier = resolveEntradaTier(rules, "CEMIG", counts, "individual");
    expect(tier?.minPessoas).toBe(40);
  });

  it("distribuidora sem regra retorna null", () => {
    const counts = new Map([["ENEL RJ", 50]]);
    expect(resolveEntradaTier(rules, "ENEL RJ", counts, "somado")).toBeNull();
  });
});

describe("computeGreenGains", () => {
  const rules = [
    rule({ distribuidora: "CEMIG", minPessoas: 10, entradaTotalPct: 20, pctImediato: 10, pctDiferido: 10 }),
  ];

  it("CP: aplica recorrente 4% + entrada imediata/diferida quando faixa atingida", () => {
    const customers = Array.from({ length: 10 }, (_, i) =>
      cust({ id: `c${i}`, faturaValor: 1000, distribuidora: "CEMIG", uf: "MG" }),
    );
    const res = computeGreenGains(customers, rules, testSettings());
    // 10 clientes × 1000 × 4% = 400 recorrente
    expect(res.recorrenteMensal).toBeCloseTo(400, 5);
    // entrada 10% imediata + 10% diferida × 10 clientes × 1000
    expect(res.entradaImediata).toBeCloseTo(1000, 5);
    expect(res.entradaDiferida).toBeCloseTo(1000, 5);
    expect(res.porCliente[0].entradaDiferidaEm).toBe("2026-09-08T12:00:00.000Z");
  });

  it("carreira Gestor (+0,5%) soma ao recorrente", () => {
    const res = computeGreenGains([cust({ faturaValor: 1000 })], rules, testSettings({
      graduacao: "gestor",
      countMode: "individual",
    }));
    // 4% + 0,5% = 4,5% de 1000 = 45 (1 cliente, faixa não atingida → sem entrada)
    expect(res.recorrenteMensal).toBeCloseTo(45, 5);
    expect(res.entradaImediata).toBe(0);
  });

  it("CI: só recorrente 1%, nunca entrada", () => {
    const customers = Array.from({ length: 10 }, (_, i) =>
      cust({ id: `ci${i}`, isDirect: false, faturaValor: 1000, distribuidora: "CEMIG" }),
    );
    const res = computeGreenGains(customers, rules, testSettings());
    expect(res.recorrenteMensal).toBeCloseTo(100, 5); // 10 × 1000 × 1%
    expect(res.entradaImediata).toBe(0);
    expect(res.entradaDiferida).toBe(0);
  });

  it("fatura ausente/zerada não gera ganho", () => {
    const res = computeGreenGains([cust({ faturaValor: null })], rules, testSettings());
    expect(res.recorrenteMensal).toBe(0);
  });
});
