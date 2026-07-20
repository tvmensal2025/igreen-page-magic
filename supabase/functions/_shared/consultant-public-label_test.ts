import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  displayNameMatchesOwner,
  resolvePublicConsultantLabel,
} from "./consultant-public-label.ts";

Deno.test("Rafael com display Abel → usa Rafael (nunca Abel)", () => {
  assertEquals(
    resolvePublicConsultantLabel("Rafael Ferreira", "Abel Olympio"),
    "Rafael Ferreira",
  );
  assertEquals(displayNameMatchesOwner("Rafael Ferreira", "Abel Olympio"), false);
});

Deno.test("mesmo consultor com apelido curto → usa display", () => {
  assertEquals(
    resolvePublicConsultantLabel("Rafael Ferreira Dias", "Rafael Ferreira"),
    "Rafael Ferreira",
  );
  assertEquals(displayNameMatchesOwner("Rafael Ferreira Dias", "Rafael"), true);
});

Deno.test("só name humano", () => {
  assertEquals(resolvePublicConsultantLabel("Maria Silva", null), "Maria Silva");
});

Deno.test("só display", () => {
  assertEquals(resolvePublicConsultantLabel(null, "João Pedro"), "João Pedro");
});

Deno.test("slug name + display humano → display", () => {
  assertEquals(
    resolvePublicConsultantLabel("rafael123", "Rafael Ferreira"),
    "Rafael Ferreira",
  );
});

Deno.test("vazio → fallback", () => {
  assertEquals(resolvePublicConsultantLabel("", ""), "seu consultor");
});
