import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isCrmCadastroEmAnalise } from "../crm-vs-lead-analysis.ts";

Deno.test("lead sem portal: não é CRM em análise", () => {
  assertEquals(
    isCrmCadastroEmAnalise({
      conversation_step: "AI_QUALIFYING",
      portal_submitted_at: null,
      status: "pending",
    }),
    false,
  );
});

Deno.test("portal_submitted_at: bloqueia A/B/C", () => {
  assertEquals(
    isCrmCadastroEmAnalise({
      conversation_step: null,
      portal_submitted_at: "2026-07-25T12:00:00Z",
    }),
    true,
  );
});

Deno.test("steps pós-portal: bloqueiam", () => {
  for (const step of [
    "portal_submitting",
    "aguardando_otp",
    "validando_otp",
    "aguardando_facial",
    "aguardando_assinatura",
    "cadastro_em_analise",
    "complete",
  ]) {
    assertEquals(
      isCrmCadastroEmAnalise({ conversation_step: step }),
      true,
      step,
    );
  }
});
