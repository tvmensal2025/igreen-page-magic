import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeDocumentType,
  requiresRgNumber,
  requiresVerso,
  isRgNovo,
  portalSelectLabel,
} from "./document-type.ts";

Deno.test("rg_novo / CIN não exige número de RG", () => {
  assertEquals(normalizeDocumentType("CIN"), "rg_novo");
  assertEquals(normalizeDocumentType("RG (Novo)"), "rg_novo");
  assertEquals(normalizeDocumentType("rg_novo"), "rg_novo");
  assertEquals(requiresRgNumber("rg_novo"), false);
  assertEquals(requiresRgNumber("CIN"), false);
  assertEquals(requiresRgNumber("RG (Novo)"), false);
  assertEquals(isRgNovo("carteira de identidade nacional"), true);
  assertEquals(requiresVerso("rg_novo"), true);
  assertEquals(portalSelectLabel("cin"), "RG (Novo)");
});

Deno.test("rg_antigo exige RG e verso", () => {
  assertEquals(normalizeDocumentType("RG (Antigo)"), "rg_antigo");
  assertEquals(requiresRgNumber("rg_antigo"), true);
  assertEquals(requiresVerso("RG"), true);
});

Deno.test("CNH sem verso", () => {
  assertEquals(normalizeDocumentType("CNH"), "cnh");
  assertEquals(requiresVerso("CNH"), false);
  assertEquals(requiresRgNumber("cnh"), true);
});
