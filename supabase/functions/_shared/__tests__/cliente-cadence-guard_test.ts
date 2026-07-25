import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  clienteCadenceBlockReason,
  isClienteProibidoCadenciaABC,
} from "../cliente-cadence-guard.ts";

Deno.test("lead WhatsApp puro: permitido A/B/C", () => {
  assertEquals(
    isClienteProibidoCadenciaABC({
      customer_origin: "whatsapp_lead",
      status: "pending",
      pos_venda_stage: null,
    }),
    false,
  );
});

Deno.test("carteira igreen_sync: proibido", () => {
  assertEquals(
    isClienteProibidoCadenciaABC({
      customer_origin: "igreen_sync",
      status: "contato_incompleto",
      pos_venda_stage: "espera",
    }),
    true,
  );
  assertEquals(
    clienteCadenceBlockReason({ customer_origin: "igreen_sync" }),
    "cliente_carteira",
  );
});

Deno.test("status registered_igreen: proibido", () => {
  assertEquals(
    isClienteProibidoCadenciaABC({
      customer_origin: "whatsapp_lead",
      status: "registered_igreen",
    }),
    true,
  );
});

Deno.test("pos_venda_stage setado: proibido", () => {
  assertEquals(
    isClienteProibidoCadenciaABC({
      customer_origin: "whatsapp_lead",
      status: "pending",
      pos_venda_stage: "d30",
    }),
    true,
  );
});

Deno.test("andamento ativo: proibido", () => {
  assertEquals(
    isClienteProibidoCadenciaABC({
      customer_origin: "whatsapp_lead",
      status: "pending",
      andamento_igreen: "Ativo",
    }),
    true,
  );
});

Deno.test("retentativa (recadastro sem pos_venda): permitido de novo", () => {
  assertEquals(
    isClienteProibidoCadenciaABC({
      customer_origin: "whatsapp_lead",
      status: "pending",
      pos_venda_stage: null,
      pos_venda_recadastro_at: "2026-07-25T12:00:00Z",
    }),
    false,
  );
});

Deno.test("is_converted: proibido", () => {
  assertEquals(
    isClienteProibidoCadenciaABC({
      customer_origin: "whatsapp_lead",
      is_converted: true,
    }),
    true,
  );
});
