import { describe, expect, it } from "vitest";
import {
  firstNameFromPublicConsultant,
  oAConsultor,
  resolveConsultantPresentationLabel,
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

describe("o/a consultor — apresentação", () => {
  it("artigo o/a pelo gender", () => {
    expect(oAConsultor("consultor")).toBe("o");
    expect(oAConsultor("consultora")).toBe("a");
    expect(oAConsultor(null)).toBe("o");
  });

  it("fallback sem nome → consultor/consultora (artigo no template)", () => {
    expect(resolveConsultantPresentationLabel("silviaclaudiaalmeida", null, "consultor")).toBe(
      "consultor",
    );
    expect(resolveConsultantPresentationLabel("", "", "consultora")).toBe("consultora");
  });

  it("com nome humano → nome (artigo o/a no template)", () => {
    expect(resolveConsultantPresentationLabel("Rafael Ferreira", null, "consultor")).toBe(
      "Rafael Ferreira",
    );
    expect(resolveConsultantPresentationLabel("Ana Silva", null, "consultora")).toBe("Ana Silva");
  });
});

describe("resolveConsultantRoleGender / assistente", () => {
  it("Sirlene sem gender → consultora (da, não do)", async () => {
    const {
      resolveConsultantRoleGender,
      resolveAssistantDisplayName,
      doDaConsultor,
    } = await import("./consultantPublicLabel");
    expect(resolveConsultantRoleGender(null, "Sirlene Correa")).toBe("consultora");
    expect(doDaConsultor(resolveConsultantRoleGender(null, "Sirlene"))).toBe("da");
    expect(resolveAssistantDisplayName(null)).toBe("Assistente");
    expect(resolveAssistantDisplayName("Yasmin")).toBe("Yasmin");
    expect(resolveAssistantDisplayName("Sofia")).toBe("Sofia");
  });
});
