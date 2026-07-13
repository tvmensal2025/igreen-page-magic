import { describe, expect, it } from "vitest";

function applyTemplateVars(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    const re = new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "gi");
    out = out.replace(re, v ?? "");
  }
  out = out.replace(/\{\{\s*\w+\s*\}\}/g, "").replace(/  +/g, " ").trim();
  return out;
}

describe("applyTemplateVars", () => {
  it("substitui placeholders", () => {
    expect(applyTemplateVars("Oi {{nome}}!", { nome: "Ana" })).toBe("Oi Ana!");
  });

  it("remove placeholders sem valor", () => {
    expect(applyTemplateVars("Oi {{nome}}!", {})).toBe("Oi !");
  });
});
