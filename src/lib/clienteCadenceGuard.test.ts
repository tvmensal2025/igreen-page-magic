import { describe, expect, it } from "vitest";
import {
  clienteCadenceBlockReason,
  isClienteProibidoCadenciaABC,
} from "./clienteCadenceGuard";

describe("isClienteProibidoCadenciaABC", () => {
  it("permite lead WhatsApp puro", () => {
    expect(
      isClienteProibidoCadenciaABC({
        customer_origin: "whatsapp_lead",
        status: "pending",
      }),
    ).toBe(false);
  });

  it("bloqueia carteira e pos_venda", () => {
    expect(
      isClienteProibidoCadenciaABC({
        customer_origin: "igreen_sync",
        pos_venda_stage: "espera",
      }),
    ).toBe(true);
    expect(clienteCadenceBlockReason({ customer_origin: "igreen_sync" })).toBe(
      "cliente_carteira",
    );
  });

  it("permite retentativa reaberta", () => {
    expect(
      isClienteProibidoCadenciaABC({
        customer_origin: "whatsapp_lead",
        status: "pending",
        pos_venda_stage: null,
        pos_venda_recadastro_at: "2026-07-25T12:00:00Z",
      }),
    ).toBe(false);
  });
});
