import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderTemplate } from "./conversational-templates.ts";
import { buildGrupoAOpenAttendanceText } from "../protocol.ts";

const A1_TPL = `*iGreen | Conta de Luz Mais Barata 🌱*

Olá! Aqui é {{o_a_consultor}} *{{representante}}* da *iGreen*.

Seu atendimento foi iniciado com sucesso e eu vou acompanhar você durante todo o processo.

📋 *Protocolo:* {{protocolo}}

Para agilizar seu atendimento, por favor, informe seu *primeiro nome*.`;

Deno.test("renderTemplate: A1 marca + protocolo + nome", () => {
  const out = renderTemplate(A1_TPL, {
    representante: "Rafael Ferreira Dias",
    protocolo: "IGR-RFD-3555",
    consultor_gender: "consultor",
  });
  assertStringIncludes(out, "*iGreen | Conta de Luz Mais Barata 🌱*");
  assertStringIncludes(out, "Olá! Aqui é o *Rafael Ferreira Dias* da *iGreen*.");
  assertStringIncludes(out, "📋 *Protocolo:* IGR-RFD-3555");
  assertStringIncludes(out, "Para agilizar seu atendimento");
  assertEquals(out.includes("{{protocolo}}"), false);
});

Deno.test("renderTemplate: sem protocolo remove só a linha do protocolo", () => {
  const out = renderTemplate(A1_TPL, {
    representante: "Rafael Ferreira Dias",
    protocolo: "",
    consultor_gender: "consultor",
  });
  assertEquals(out.includes("📋"), false);
  assertStringIncludes(out, "Rafael Ferreira Dias");
  assertStringIncludes(out, "primeiro nome");
});

Deno.test("buildGrupoAOpenAttendanceText", () => {
  const full = buildGrupoAOpenAttendanceText({
    consultantName: "Rafael Ferreira Dias",
    protocol: "IGR-RFD-0001",
    gender: "consultor",
  });
  assertStringIncludes(full, "*iGreen | Conta de Luz Mais Barata 🌱*");
  assertStringIncludes(full, "Aqui é o *Rafael Ferreira Dias* da *iGreen*.");
  assertStringIncludes(full, "📋 *Protocolo:* IGR-RFD-0001");
  assertStringIncludes(full, "informe seu *primeiro nome*");
});

Deno.test("buildGrupoAOpenAttendanceText — consultora", () => {
  const full = buildGrupoAOpenAttendanceText({
    consultantName: "Ana Silva",
    protocol: "IGR-ANA-0001",
    gender: "consultora",
  });
  assertStringIncludes(full, "Aqui é a *Ana Silva* da *iGreen*.");
});

Deno.test("buildGrupoAOpenAttendanceText — sem nome nunca fala consultora/Gestor", () => {
  const full = buildGrupoAOpenAttendanceText({
    consultantName: "",
    protocol: "IGR-XXX-0001",
    gender: "consultora",
  });
  assertStringIncludes(full, "Aqui é o atendimento da *iGreen*.");
  assertEquals(/consultora/i.test(full), false);
  assertEquals(/gestor/i.test(full), false);
});

Deno.test("renderTemplate A1 — nunca vaza possessivo/papel como nome (regressão Igor)", () => {
  for (const bad of ["sua consultora", "seu consultor", "consultora", "consultor", "Gestor"]) {
    const out = renderTemplate(A1_TPL, {
      representante: bad,
      protocolo: "IGR-TST-1",
      consultor_gender: "consultora",
    });
    assertEquals(/consultora|consultor|gestor/i.test(out), false, `vaza "${bad}": ${out}`);
    assertStringIncludes(out, "atendimento");
  }
});

Deno.test("renderTemplate A1 — nome humano Rafael permanece", () => {
  const out = renderTemplate(A1_TPL, {
    representante: "Rafael",
    protocolo: "IGR-RAF-1",
    consultor_gender: "consultor",
  });
  assertStringIncludes(out, "Aqui é o *Rafael* da *iGreen*.");
  assertEquals(/consultora/i.test(out), false);
});
