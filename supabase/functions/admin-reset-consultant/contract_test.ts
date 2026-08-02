import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Contrato da função admin-reset-consultant / admin-delete-consultant.
// Testes de contrato (sem rede): garantem que os guards previstos existem no código.

const resetSrc = await Deno.readTextFile(
  new URL("./index.ts", import.meta.url),
);
const deleteSrc = await Deno.readTextFile(
  new URL("../admin-delete-consultant/index.ts", import.meta.url),
);

Deno.test("reset exige super admin", () => {
  assertEquals(resetSrc.includes("is_super_admin"), true);
  assertEquals(resetSrc.includes("só Super Admin pode resetar consultores"), true);
});

Deno.test("reset bloqueia a própria conta", () => {
  assertEquals(resetSrc.includes("consultantId === caller.id"), true);
});

Deno.test("reset usa a RPC canônica de identidade", () => {
  assertEquals(resetSrc.includes("admin_reset_consultant_identity"), true);
});

Deno.test("delete transfere ativos antes de apagar o usuário", () => {
  const transferIdx = deleteSrc.indexOf("admin_transfer_consultant_assets");
  const deleteIdx = deleteSrc.indexOf("auth.admin.deleteUser");
  assertEquals(transferIdx > -1, true);
  assertEquals(deleteIdx > -1, true);
  assertEquals(transferIdx < deleteIdx, true);
});

Deno.test("delete nunca apaga outro super admin", () => {
  assertEquals(deleteSrc.includes("Não é possível excluir um Super Admin"), true);
});
