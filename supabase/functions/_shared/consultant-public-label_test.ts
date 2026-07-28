import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  displayNameMatchesOwner,
  oAConsultor,
  resolveConsultantPresentationLabel,
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

Deno.test("slug/login silviaclaudiaalmeida NUNCA vaza", () => {
  assertEquals(resolvePublicConsultantLabel("silviaclaudiaalmeida", null), "seu consultor");
  assertEquals(resolvePublicConsultantLabel("silviaclaudiaalmeida", ""), "seu consultor");
  assertEquals(
    resolvePublicConsultantLabel("silviaclaudiaalmeida", "silviaclaudiaalmeida"),
    "seu consultor",
  );
  assertEquals(
    resolvePublicConsultantLabel("silviaclaudiaalmeida", "Silvia Claudia"),
    "Silvia Claudia",
  );
});

Deno.test("outros slugs reais do banco também bloqueados", () => {
  for (const slug of [
    "tvmensal12",
    "tvmensal11",
    "elizavip4545",
    "henzofelipef",
    "olimpiajanete15",
  ]) {
    assertEquals(resolvePublicConsultantLabel(slug, null), "seu consultor", slug);
  }
});

Deno.test("o/a + apresentação — nunca 'consultora' no lugar do nome", () => {
  assertEquals(oAConsultor("consultor"), "o");
  assertEquals(oAConsultor("consultora"), "a");
  // Sem nome humano → vazio (abertura vira "atendimento da iGreen")
  assertEquals(resolveConsultantPresentationLabel("", "", "consultor"), "");
  assertEquals(resolveConsultantPresentationLabel("", "", "consultora"), "");
  assertEquals(
    resolveConsultantPresentationLabel("silviaclaudiaalmeida", null, "consultora"),
    "",
  );
  assertEquals(
    resolveConsultantPresentationLabel("Rafael Ferreira", null, "consultor"),
    "Rafael Ferreira",
  );
  assertEquals(
    resolveConsultantPresentationLabel("Rafael Ferreira, Gestor", null, "consultor"),
    "Rafael Ferreira",
  );
});
