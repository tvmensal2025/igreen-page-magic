import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { saudacaoMuitoByHourBRT } from "./quiet-hours.ts";
import { applyOutboundTemplateVars } from "./outbound-template-vars.ts";

/** Monta Date cuja parede em America/Sao_Paulo cai na hora desejada (aprox.). */
function atBrtHour(hour: number): Date {
  // 2026-07-23 é BRT = UTC-3 (sem DST).
  return new Date(Date.UTC(2026, 6, 23, hour + 3, 0, 0));
}

Deno.test("saudacaoMuitoByHourBRT: dia / tarde / noite", () => {
  assertEquals(saudacaoMuitoByHourBRT(atBrtHour(9)), "Muito bom dia");
  assertEquals(saudacaoMuitoByHourBRT(atBrtHour(14)), "Muito boa tarde");
  assertEquals(saudacaoMuitoByHourBRT(atBrtHour(20)), "Muito boa noite");
  assertEquals(saudacaoMuitoByHourBRT(atBrtHour(0)), "Muito bom dia");
  assertEquals(saudacaoMuitoByHourBRT(atBrtHour(11)), "Muito bom dia");
  assertEquals(saudacaoMuitoByHourBRT(atBrtHour(12)), "Muito boa tarde");
  assertEquals(saudacaoMuitoByHourBRT(atBrtHour(17)), "Muito boa tarde");
  assertEquals(saudacaoMuitoByHourBRT(atBrtHour(18)), "Muito boa noite");
});

Deno.test("applyOutboundTemplateVars: Olá + nome + Tudo bem + saudacao", () => {
  const raw = "Olá, {{nome}} Tudo bem?\n\n{{saudacao}}\n\nSeu cadastro foi aprovado.";
  const out = applyOutboundTemplateVars(raw, {
    customerName: "Maria Silva",
    nameSource: "igreen_portal",
    phone: "5534999999999",
    now: atBrtHour(15),
  });
  assertEquals(
    out,
    "Olá, Maria Tudo bem?\n\nMuito boa tarde\n\nSeu cadastro foi aprovado.",
  );
});

Deno.test("applyOutboundTemplateVars: sem nome confiável → Olá. Tudo bem?", () => {
  const out = applyOutboundTemplateVars("Olá, {{nome}} Tudo bem?\n\n{{saudacao}}", {
    customerName: "Zap User",
    nameSource: "whatsapp_profile",
    now: atBrtHour(9),
  });
  assertEquals(out, "Olá. Tudo bem?\n\nMuito bom dia");
});
