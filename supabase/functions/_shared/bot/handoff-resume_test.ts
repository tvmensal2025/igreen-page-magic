import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideHandoffResume,
  HANDOFF_RESUME_HOURS,
  handoffResumeAtIso,
} from "./handoff-resume.ts";

const AGORA = new Date("2026-08-07T12:00:00Z");
const horas = (n: number) => new Date(AGORA.getTime() - n * 3_600_000);

Deno.test("handoffResumeAtIso agenda a volta em vez de deixar null", () => {
  const iso = handoffResumeAtIso(AGORA);
  assertEquals(iso, new Date(AGORA.getTime() + HANDOFF_RESUME_HOURS * 3_600_000).toISOString());
});

Deno.test("caso Robinho: silêncio total além da janela devolve o lead ao robô", () => {
  const d = decideHandoffResume(
    { bot_paused: true, bot_paused_reason: "humano_assumiu" },
    horas(50),
    AGORA,
  );
  assertEquals(d.resume, true);
});

Deno.test("conversa recente mantém o humano no comando", () => {
  const d = decideHandoffResume(
    { bot_paused: true, bot_paused_reason: "humano_assumiu" },
    horas(3),
    AGORA,
  );
  assertEquals(d.resume, false);
  if (!d.resume) {
    assertEquals(d.reason, "conversa_recente");
    // Volta a olhar exatamente quando a janela fecha — nunca "nunca mais".
    assertEquals(d.retryAtIso, new Date(horas(3).getTime() + HANDOFF_RESUME_HOURS * 3_600_000).toISOString());
  }
});

Deno.test("pausa definitiva não volta por tempo", () => {
  for (const reason of ["requested", "opt_out", "complaint", "blocked", "bulk_pro"]) {
    const d = decideHandoffResume(
      { bot_paused: true, bot_paused_reason: reason },
      horas(500),
      AGORA,
    );
    assertEquals(d.resume, false, reason);
  }
});

Deno.test("do_not_contact nunca volta, mesmo com silêncio antigo", () => {
  const d = decideHandoffResume(
    { do_not_contact: true, bot_paused: true, bot_paused_reason: "humano_assumiu" },
    horas(999),
    AGORA,
  );
  assertEquals(d.resume, false);
});

Deno.test("bot_paused_until no futuro adia até a data marcada", () => {
  const until = new Date(AGORA.getTime() + 5 * 3_600_000).toISOString();
  const d = decideHandoffResume(
    { bot_paused: true, bot_paused_reason: "humano_assumiu", bot_paused_until: until },
    horas(500),
    AGORA,
  );
  assertEquals(d.resume, false);
  if (!d.resume) assertEquals(d.retryAtIso, until);
});

Deno.test("sem conversa registrada não trava o lead para sempre", () => {
  const d = decideHandoffResume(
    { bot_paused: true, bot_paused_reason: "humano_assumiu" },
    null,
    AGORA,
  );
  assertEquals(d.resume, true);
});
