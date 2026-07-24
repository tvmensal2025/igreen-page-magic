/**
 * Unit tests — retentativa pós-reprovado (detecção de clique + patch).
 */
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPosVendaRecadastroPatch,
  isPosVendaRetentativaClick,
  PV_RETENTATIVA_BUTTON_ID,
} from "./pos-venda-retentativa.ts";

Deno.test("retentativa: só aceita clique se stage=retentativa", () => {
  assertEquals(
    isPosVendaRetentativaClick(PV_RETENTATIVA_BUTTON_ID, null, {
      pos_venda_stage: "reprovado",
    }),
    false,
  );
  assertEquals(
    isPosVendaRetentativaClick(PV_RETENTATIVA_BUTTON_ID, null, {
      pos_venda_stage: "retentativa",
    }),
    true,
  );
});

Deno.test("retentativa: aceita texto 1 e aliases", () => {
  const c = { pos_venda_stage: "retentativa" };
  assertEquals(isPosVendaRetentativaClick(null, "1", c), true);
  assertEquals(isPosVendaRetentativaClick(null, "1.", c), true);
  assertEquals(isPosVendaRetentativaClick(null, "1)", c), true);
  assertEquals(isPosVendaRetentativaClick(null, "quero tentar de novo", c), true);
  assertEquals(isPosVendaRetentativaClick(null, "oi", c), false);
});

Deno.test("retentativa: patch abre Grupo A e marca recadastro", () => {
  const patch = buildPosVendaRecadastroPatch({ name: "Maria Silva", name_source: "igreen_portal" });
  assertEquals(patch.customer_origin, "whatsapp_lead");
  assertEquals(patch.status, "pending");
  assertEquals(patch.pos_venda_stage, null);
  assertEquals(patch.flow_variant, "A");
  assertEquals(patch.conversation_step, null);
  assertEquals(patch.bot_paused, false);
  assertEquals(patch.electricity_bill_value, null);
  assertExists(patch.pos_venda_recadastro_at);
  assertEquals(patch.name_source, "igreen_portal");
});
