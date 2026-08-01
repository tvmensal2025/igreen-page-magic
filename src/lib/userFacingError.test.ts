import { describe, expect, it } from "vitest";
import {
  isAlreadyExistsError,
  looksLikePortuguese,
  toUserFacingError,
} from "./userFacingError";

describe("toUserFacingError", () => {
  it("traduz senha fraca do Auth Supabase", () => {
    expect(
      toUserFacingError(
        "Password is known to be weak and easy to guess, please choose a different one.",
      ),
    ).toMatch(/senha é muito fraca/i);
  });

  it("traduz duplicate key consultants_pkey", () => {
    expect(
      toUserFacingError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "consultants_pkey"',
      }),
    ).toMatch(/já está cadastrada/i);
  });

  it("traduz login inválido", () => {
    expect(toUserFacingError("Invalid login credentials")).toMatch(/incorretos/i);
  });

  it("traduz Failed to fetch", () => {
    expect(toUserFacingError(new TypeError("Failed to fetch"))).toMatch(/conexão/i);
  });

  it("mantém mensagem já em português", () => {
    expect(toUserFacingError("As senhas não coincidem.")).toBe("As senhas não coincidem.");
  });

  it("não vaza SQL genérico", () => {
    expect(
      toUserFacingError("null value in column \"phone\" violates not-null constraint"),
    ).toMatch(/Não foi possível|campo obrigatório|já existe/i);
  });

  it("User already registered", () => {
    expect(toUserFacingError("User already registered")).toMatch(/já tem conta/i);
  });
});

describe("isAlreadyExistsError", () => {
  it("detecta 23505 e consultants_pkey", () => {
    expect(
      isAlreadyExistsError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "consultants_pkey"',
      }),
    ).toBe(true);
  });
});

describe("looksLikePortuguese", () => {
  it("reconhece acentos e palavras PT", () => {
    expect(looksLikePortuguese("Não foi possível enviar")).toBe(true);
    expect(looksLikePortuguese("Password is known to be weak")).toBe(false);
  });
});
