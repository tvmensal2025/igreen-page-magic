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

  it("nunca vaza slug/login no WhatsApp (silviaclaudiaalmeida)", () => {
    expect(resolvePublicConsultantLabel("silviaclaudiaalmeida", null)).toBe("seu consultor");
    expect(resolvePublicConsultantLabel("silviaclaudiaalmeida", "")).toBe("seu consultor");
    expect(resolvePublicConsultantLabel("silviaclaudiaalmeida", "silviaclaudiaalmeida")).toBe(
      "seu consultor",
    );
    expect(resolvePublicConsultantLabel("tvmensal12", null)).toBe("seu consultor");
    expect(resolvePublicConsultantLabel("elizavip4545", null)).toBe("seu consultor");
    expect(firstNameFromPublicConsultant("silviaclaudiaalmeida", null)).toBe("");
  });

  it("slug + display humano → display", () => {
    expect(resolvePublicConsultantLabel("silviaclaudiaalmeida", "Silvia Claudia")).toBe(
      "Silvia Claudia",
    );
  });
});
