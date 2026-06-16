// =============================================================================
// Validação de captura por família (Requisito 7.2) — testes unitários
// =============================================================================
// Cobre o helper `validateCaptureForFamily`, usado como guarda leve no ponto de
// entrada de venda manual (RegistrarVendaDialog). Foca no comportamento de
// borda: família sem schema, captura vazia, dados válidos e dados inválidos.
// =============================================================================

import { describe, it, expect } from "vitest";
import { validateCaptureForFamily } from "../schemas";

describe("validateCaptureForFamily", () => {
  // ─── Famílias sem schema próprio passam direto ──────────────────────────
  it("aceita família sem schema (energia) sem validar", () => {
    const result = validateCaptureForFamily("energia", { qualquer: "coisa" });
    expect(result.ok).toBe(true);
  });

  it("aceita família sem schema (club)", () => {
    expect(validateCaptureForFamily("club", {}).ok).toBe(true);
  });

  it("aceita família sem schema (expansao)", () => {
    expect(validateCaptureForFamily("expansao", null).ok).toBe(true);
  });

  // ─── Captura vazia/ausente passa direto (não bloqueia o fluxo manual) ───
  it("aceita captura vazia para família com schema (telecom)", () => {
    expect(validateCaptureForFamily("telecom", {}).ok).toBe(true);
  });

  it("aceita captura nula para família com schema (telecom)", () => {
    expect(validateCaptureForFamily("telecom", null).ok).toBe(true);
  });

  it("aceita captura undefined para família com schema (seguros)", () => {
    expect(validateCaptureForFamily("seguros", undefined).ok).toBe(true);
  });

  // ─── Telecom: dados válidos ─────────────────────────────────────────────
  it("aceita telecom válido sem portabilidade", () => {
    const result = validateCaptureForFamily("telecom", {
      plano: "Mega",
      portabilidade: false,
      tipo_chip: "esim",
    });
    expect(result.ok).toBe(true);
  });

  it("aceita telecom válido com portabilidade e número", () => {
    const result = validateCaptureForFamily("telecom", {
      plano: "Giga",
      portabilidade: true,
      numero: "11999998888",
      tipo_chip: "fisico",
    });
    expect(result.ok).toBe(true);
  });

  // ─── Telecom: dados inválidos → mensagem amigável em pt-BR ──────────────
  it("rejeita telecom com portabilidade sem número e devolve mensagem pt-BR", () => {
    const result = validateCaptureForFamily("telecom", {
      plano: "Giga",
      portabilidade: true,
      tipo_chip: "fisico",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Informe o número para portabilidade");
    }
  });

  it("rejeita telecom sem plano", () => {
    const result = validateCaptureForFamily("telecom", {
      plano: "",
      portabilidade: false,
      tipo_chip: "fisico",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Selecione um plano");
    }
  });

  // ─── Seguros: válido e inválido ─────────────────────────────────────────
  it("aceita seguros válido", () => {
    const result = validateCaptureForFamily("seguros", {
      placa: "ABC1D23",
      modelo: "Honda Civic",
      ano: 2020,
      plano: "premium",
    });
    expect(result.ok).toBe(true);
  });

  it("rejeita seguros com placa curta", () => {
    const result = validateCaptureForFamily("seguros", {
      placa: "AB1",
      modelo: "Honda Civic",
      ano: 2020,
      plano: "premium",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Placa inválida");
    }
  });

  // ─── Placas: válido e inválido ──────────────────────────────────────────
  it("aceita placas válido", () => {
    const result = validateCaptureForFamily("placas", {
      consumo_kwh: 500,
      tipo_imovel: "residencial",
      financiamento: false,
    });
    expect(result.ok).toBe(true);
  });

  it("rejeita placas com consumo não positivo", () => {
    const result = validateCaptureForFamily("placas", {
      consumo_kwh: 0,
      tipo_imovel: "comercial",
      financiamento: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Consumo deve ser maior que zero");
    }
  });
});
