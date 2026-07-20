import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderTemplate } from "./conversational-templates.ts";
import { buildGrupoAOpenAttendanceText } from "../protocol.ts";

const A1_TPL = `*iGreen | Conta de Luz Mais Barata 🌱*

Olá! Aqui é *{{representante}}*, *Gestor* da *iGreen*.

Seu atendimento foi iniciado com sucesso e eu vou acompanhar você durante todo o processo.

📋 *Protocolo:* {{protocolo}}

Para agilizar seu atendimento, por favor, informe seu *primeiro nome*.`;

Deno.test("renderTemplate: A1 marca + protocolo + nome", () => {
  const out = renderTemplate(A1_TPL, {
    representante: "Rafael Ferreira Dias",
    protocolo: "IGR-RFD-3555",
  });
  assertStringIncludes(out, "*iGreen | Conta de Luz Mais Barata 🌱*");
  assertStringIncludes(out, "Olá! Aqui é *Rafael Ferreira Dias*, *Gestor* da *iGreen*.");
  assertStringIncludes(out, "📋 *Protocolo:* IGR-RFD-3555");
  assertStringIncludes(out, "Para agilizar seu atendimento");
  assertEquals(out.includes("{{protocolo}}"), false);
});

Deno.test("renderTemplate: sem protocolo remove só a linha do protocolo", () => {
  const out = renderTemplate(A1_TPL, {
    representante: "Rafael Ferreira Dias",
    protocolo: "",
  });
  assertEquals(out.includes("📋"), false);
  assertStringIncludes(out, "Rafael Ferreira Dias");
  assertStringIncludes(out, "primeiro nome");
});

Deno.test("buildGrupoAOpenAttendanceText", () => {
  const full = buildGrupoAOpenAttendanceText({
    consultantName: "Rafael Ferreira Dias",
    protocol: "IGR-RFD-0001",
  });
  assertStringIncludes(full, "*iGreen | Conta de Luz Mais Barata 🌱*");
  assertStringIncludes(full, "📋 *Protocolo:* IGR-RFD-0001");
  assertStringIncludes(full, "informe seu *primeiro nome*");
});
