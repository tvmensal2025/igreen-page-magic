import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  formatBRL,
  buildConfirmacaoConta,
  buildConfirmacaoDoc,
} from "./confirmation-formatters.ts";

Deno.test("formatBRL pt-BR", () => {
  assertEquals(formatBRL(1234.5), "1.234,50");
});

Deno.test("buildConfirmacaoConta snapshot", () => {
  const t = buildConfirmacaoConta({
    bill_holder_name: "Maria",
    address_street: "Rua A",
    address_number: "10",
    address_neighborhood: "Centro",
    address_city: "SP",
    address_state: "SP",
    cep: "01000-000",
    distribuidora: "Enel",
    numero_instalacao: "123",
    electricity_bill_value: 100,
  });
  assertEquals(t.includes("*Nome:* Maria"), true);
  assertEquals(t.includes("R$ 100,00"), true);
  assertEquals(t.includes("Está tudo correto?"), true);
});

Deno.test("buildConfirmacaoDoc snapshot", () => {
  const t = buildConfirmacaoDoc({
    doc_holder_name: "Maria",
    cpf: "123",
    rg: "456",
    data_nascimento: "01/01/1990",
  });
  assertEquals(t.includes("Nome: *Maria*"), true);
  assertEquals(t.includes("CPF: *123*"), true);
});
