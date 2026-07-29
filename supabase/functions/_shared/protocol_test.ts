import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildWelcomeHeaderProtocol,
  scrubLegacyWelcomeRoleLeak,
  stripConsultantRoleSuffix,
} from "./protocol.ts";

Deno.test("stripConsultantRoleSuffix — remove Gestor grudado", () => {
  assertEquals(stripConsultantRoleSuffix("Rafael Ferreira, Gestor"), "Rafael Ferreira");
  assertEquals(stripConsultantRoleSuffix("Ana Silva — Gestora"), "Ana Silva");
  assertEquals(stripConsultantRoleSuffix("Rafael Ferreira"), "Rafael Ferreira");
});

Deno.test("scrubLegacyWelcomeRoleLeak — remove , *Gestor* (bug Leandro)", () => {
  const raw =
    "Olá! Aqui é *Rafael Ferreira*, *Gestor* da *iGreen*.\n\n📋 *Protocolo:* IGR-IGR-4900";
  const out = scrubLegacyWelcomeRoleLeak(raw);
  assertStringIncludes(out, "Rafael Ferreira");
  assertEquals(/gestor/i.test(out), false);
  assertEquals(/,\s+\*?da/i.test(out), false);
});

Deno.test("scrubLegacyWelcomeRoleLeak — nunca deixa *consultora* no lugar do nome", () => {
  const out = scrubLegacyWelcomeRoleLeak("Olá! Aqui é a *consultora* da *iGreen*.");
  assertStringIncludes(out, "Aqui é o atendimento da *iGreen*.");
  assertEquals(/consultora/i.test(out), false);
});

Deno.test("scrubLegacyWelcomeRoleLeak — lacuna Igor: sua *consultora* (possessivo fora do bold)", () => {
  const leaks = [
    "Olá! Aqui é a sua *consultora* da *iGreen*.",
    "Olá! Aqui é a *sua consultora* da *iGreen*.",
    "Olá! Aqui é a sua consultora da *iGreen*.",
    "Oi! Olá! Aqui é a sua *consultora* da iGreen.",
  ];
  for (const raw of leaks) {
    const out = scrubLegacyWelcomeRoleLeak(raw);
    assertEquals(/consultora/i.test(out), false, `ainda vaza em: ${raw} → ${out}`);
    assertStringIncludes(out, "atendimento");
  }
});

Deno.test("buildWelcomeHeaderProtocol — com nome humano", () => {
  const out = buildWelcomeHeaderProtocol("IGR-RFD-0001", "Rafael Ferreira", {
    gender: "consultor",
  });
  assertStringIncludes(out, "Aqui é o *Rafael Ferreira* da *iGreen*.");
  assertEquals(/gestor/i.test(out), false);
  assertEquals(/consultora/i.test(out), false);
});

Deno.test("buildWelcomeHeaderProtocol — sem nome não fala consultora", () => {
  const out = buildWelcomeHeaderProtocol("IGR-XXX-1", "", { gender: "consultora" });
  assertStringIncludes(out, "Aqui é o atendimento da *iGreen*.");
  assertEquals(/consultora/i.test(out), false);
  assertEquals(/gestor/i.test(out), false);
});
