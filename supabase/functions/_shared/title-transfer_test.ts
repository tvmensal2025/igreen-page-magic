import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  requiresTitleTransfer,
  resolvePortalContaTitularidade,
} from "./title-transfer.ts";

Deno.test("requiresTitleTransfer: só SP", () => {
  assertEquals(requiresTitleTransfer("SP"), true);
  assertEquals(requiresTitleTransfer("sp"), true);
  assertEquals(requiresTitleTransfer("São Paulo"), true);
  assertEquals(requiresTitleTransfer("MG"), false);
  assertEquals(requiresTitleTransfer("RJ"), false);
  assertEquals(requiresTitleTransfer(null), false);
});

Deno.test("MG: boleto único sem troca de título", () => {
  const r = resolvePortalContaTitularidade({
    address_state: "MG",
    contaunica: true,
    contaunica_answered: true,
  });
  assertEquals(r.contaUnica, true);
  assertEquals(r.transferirTitularidade, false);
});

Deno.test("SP: boleto único com troca de título", () => {
  const r = resolvePortalContaTitularidade({
    address_state: "SP",
    contaunica: true,
    contaunica_answered: true,
  });
  assertEquals(r.contaUnica, true);
  assertEquals(r.transferirTitularidade, true);
});

Deno.test("SP: boleto separado sem troca", () => {
  const r = resolvePortalContaTitularidade({
    address_state: "SP",
    contaunica: false,
    contaunica_answered: true,
  });
  assertEquals(r.contaUnica, false);
  assertEquals(r.transferirTitularidade, false);
});

Deno.test("MG: mesmo com titularidade marcada no banco, força false", () => {
  const r = resolvePortalContaTitularidade({
    address_state: "MG",
    contaunica: true,
    contaunica_answered: true,
    transferir_titularidade: true,
    transferir_titularidade_answered: true,
  });
  assertEquals(r.contaUnica, true);
  assertEquals(r.transferirTitularidade, false);
});
