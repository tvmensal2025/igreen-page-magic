import { describe, expect, it } from "vitest";
import { scoreIntent, type BoletoLike } from "../intent";

const mk = (o: Partial<BoletoLike>): BoletoLike => ({
  status: null,
  vencimento: null,
  pagamento: null,
  dias_atraso: null,
  ...o,
});

describe("scoreIntent", () => {
  it("perdido quando atraso > 60 dias", () => {
    expect(scoreIntent(mk({ dias_atraso: 90 }), [])).toBe("perdido");
  });

  it("alta quando os 2 últimos foram pagos em dia e boleto atual não venceu", () => {
    const hist = [
      mk({ vencimento: "2026-05-10", pagamento: "2026-05-09" }),
      mk({ vencimento: "2026-04-10", pagamento: "2026-04-10" }),
    ];
    expect(scoreIntent(mk({ vencimento: "2026-06-10", dias_atraso: 0 }), hist)).toBe("alta");
  });

  it("media quando média de atraso entre 1 e 10 dias", () => {
    const hist = [
      mk({ vencimento: "2026-05-10", pagamento: "2026-05-14" }),
      mk({ vencimento: "2026-04-10", pagamento: "2026-04-16" }),
    ];
    expect(scoreIntent(mk({ dias_atraso: 5 }), hist)).toBe("media");
  });

  it("baixa quando sem histórico e atraso pequeno", () => {
    expect(scoreIntent(mk({ dias_atraso: 40 }), [])).toBe("baixa");
  });
});
