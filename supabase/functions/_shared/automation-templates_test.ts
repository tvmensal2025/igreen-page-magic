/**
 * Regressão: fallback personalizado NÃO pode contaminar o próximo lead via cache.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyTemplateVars,
  loadAutomationTemplate,
} from "./automation-templates.ts";

Deno.test("applyTemplateVars — substitui {{nome}} por lead", () => {
  assertEquals(
    applyTemplateVars("Oi {{nome}}, aqui", { nome: "Marcos" }),
    "Oi Marcos, aqui",
  );
  assertEquals(
    applyTemplateVars("Oi {{nome}}, aqui", { nome: "João" }),
    "Oi João, aqui",
  );
});

Deno.test("loadAutomationTemplate — fallback personalizado não vaza no 2º lead", async () => {
  // Simula DB com duplicata global: maybeSingle falharia; nossa query usa limit(1)
  // e aqui forçamos "sem template" pra exercitar o caminho do fallback+cache.
  const calls: string[] = [];
  const supabase = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        is() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        async maybeSingle() {
          return { data: null, error: { message: " mag" } };
        },
      };
    },
  };

  const t1 = await loadAutomationTemplate(
    supabase,
    "bot_followup_sumiu",
    "Oi João, AQUI_NAO_DEVE_VAZAR",
    { nome: "João" },
    "consult-1",
  );
  calls.push(t1);

  const t2 = await loadAutomationTemplate(
    supabase,
    "bot_followup_sumiu",
    "Oi {{nome}}, certo",
    { nome: "Marcos" },
    "consult-1",
  );
  calls.push(t2);

  assertEquals(calls[0].includes("João"), true);
  // Crítico: 2º lead NÃO herda "Oi João" do fallback cacheado
  assertEquals(calls[1].includes("João"), false);
  assertEquals(calls[1], "Oi Marcos, certo");
});
