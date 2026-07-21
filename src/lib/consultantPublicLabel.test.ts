import { describe, expect, it } from "vitest";
import {
  firstNameFromPublicConsultant,
  resolvePublicConsultantLabel,
} from "./consultantPublicLabel";

describe("resolvePublicConsultantLabel", () => {
  it("ignora display de outra pessoa (Abel no Rafael)", () => {
    expect(resolvePublicConsultantLabel("Rafael Ferreira", "Abel Olympio")).toBe("Rafael Ferreira");
  });

  it("aceita apelido curto do mesmo dono", () => {
    expect(resolvePublicConsultantLabel("Rafael Ferreira Dias", "Rafael Ferreira")).toBe(
      "Rafael Ferreira",
    );
  });

  it("prenome seguro", () => {
    expect(firstNameFromPublicConsultant("Rafael Ferreira", "Abel Olympio")).toBe("Rafael");
    expect(firstNameFromPublicConsultant("rafael123", "Rafael Ferreira")).toBe("Rafael");
  });
});
