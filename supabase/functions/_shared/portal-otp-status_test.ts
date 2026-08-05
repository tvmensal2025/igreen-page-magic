// Testes-guardião do incidente 2026-08-04 (OTP duplicado / reenvio a cliente já concluído).
//
// Cada caso abaixo é ancorado em dado REAL de produção coletado na auditoria:
//   - `used` + contrato `completed`  → 8 clientes (4 deles sem validated_at no nosso banco)
//   - `to-validate` + contrato `completed` → JOSE LUIZ DE MELO, idcliente 1698948,
//     depois do reenvio indevido do watchdog às 01:50 de 2026-08-05.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyPortalOtpStatus,
  isLocalPortalConcluded,
  isPortalContractDone,
  shouldGenerateOtp,
} from "./portal-otp-status.ts";

Deno.test("classifyPortalOtpStatus: valores reais do portal", () => {
  assertEquals(classifyPortalOtpStatus("used"), "validated");
  assertEquals(classifyPortalOtpStatus("to-validate"), "pending");
  // documentados
  assertEquals(classifyPortalOtpStatus("completed"), "validated");
  assertEquals(classifyPortalOtpStatus("pending"), "pending");
  assertEquals(classifyPortalOtpStatus("expired"), "open");
  assertEquals(classifyPortalOtpStatus("failure"), "open");
});

Deno.test("classifyPortalOtpStatus: tolera caixa, espaço e vazio", () => {
  assertEquals(classifyPortalOtpStatus(" USED "), "validated");
  assertEquals(classifyPortalOtpStatus("To-Validate"), "pending");
  assertEquals(classifyPortalOtpStatus(""), "open");
  assertEquals(classifyPortalOtpStatus(null), "open");
  assertEquals(classifyPortalOtpStatus(undefined), "open");
});

Deno.test("isPortalContractDone", () => {
  assertEquals(isPortalContractDone("completed"), true);
  assertEquals(isPortalContractDone("signed"), true);
  assertEquals(isPortalContractDone("pending"), false);
  assertEquals(isPortalContractDone(null), false);
});

Deno.test("isLocalPortalConcluded: estados nossos de concluído", () => {
  assertEquals(isLocalPortalConcluded("contract_completed"), true);
  assertEquals(isLocalPortalConcluded("otp_validated"), true);
  assertEquals(isLocalPortalConcluded("already_registered"), true);
  assertEquals(isLocalPortalConcluded("otp_sent"), false);
  assertEquals(isLocalPortalConcluded(null), false);
});

Deno.test("shouldGenerateOtp: NÃO gera para quem já usou o código (8 clientes reais)", () => {
  const r = shouldGenerateOtp({ portalOtpStatus: "used", portalContractStatus: "completed" });
  assertEquals(r.allowed, false);
  assertEquals((r as { reason: string }).reason, "contract_done");
});

Deno.test("shouldGenerateOtp: caso JOSE LUIZ — contrato completed vence otp to-validate", () => {
  // Era exatamente este estado que o watchdog leu e interpretou como "precisa de código".
  const r = shouldGenerateOtp({
    portalOtpStatus: "to-validate",
    portalContractStatus: "completed",
    localPortalStatus: "contract_completed",
  });
  assertEquals(r.allowed, false);
  assertEquals((r as { reason: string }).reason, "local_concluded");
});

Deno.test("shouldGenerateOtp: NÃO gera quando há código pendente (evita invalidar o que o cliente digitou)", () => {
  const r = shouldGenerateOtp({ portalOtpStatus: "to-validate", portalContractStatus: "pending" });
  assertEquals(r.allowed, false);
  assertEquals((r as { reason: string }).reason, "otp_pending");
});

Deno.test("shouldGenerateOtp: gera quando expirou de verdade", () => {
  assertEquals(
    shouldGenerateOtp({ portalOtpStatus: "expired", portalContractStatus: "pending" }),
    { allowed: true },
  );
});

Deno.test("shouldGenerateOtp: sem informação do portal, não bloqueia (fail-open controlado)", () => {
  // Se o portal não responder, quem decide é o gate local do chamador.
  assertEquals(shouldGenerateOtp({}), { allowed: true });
});
