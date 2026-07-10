// Testes do parser e helpers do atendimento profissional (nota 1–5).
// Pesquisa é TEXTO numerado (Whapi maxButtons=3 — nunca 5 botões).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ATTENDANCE_DONE_STEP,
  ATTENDANCE_RATING_STEP,
  isAttendanceDone,
  isAttendanceTerminalStep,
  isAwaitingAttendanceRating,
  parseAttendanceRating,
} from "./attendance-flow.ts";

Deno.test("parseAttendanceRating: dígitos e variantes", () => {
  assertEquals(parseAttendanceRating({ messageText: "5" }), 5);
  assertEquals(parseAttendanceRating({ messageText: "5." }), 5);
  assertEquals(parseAttendanceRating({ messageText: "*4*" }), 4);
  assertEquals(parseAttendanceRating({ messageText: "nota 3" }), 3);
  assertEquals(parseAttendanceRating({ messageText: "5/5" }), 5);
  assertEquals(parseAttendanceRating({ messageText: "bom" }), 4);
  assertEquals(parseAttendanceRating({ messageText: "excelente" }), 5);
  assertEquals(parseAttendanceRating({ messageText: "oi" }), null);
  assertEquals(parseAttendanceRating({ messageText: "pdf" }), null);
});

Deno.test("parseAttendanceRating: buttonId rating_N", () => {
  assertEquals(parseAttendanceRating({ buttonId: "rating_1" }), 1);
  assertEquals(parseAttendanceRating({ buttonId: "rating-5" }), 5);
  assertEquals(parseAttendanceRating({ buttonId: "other" }), null);
});

Deno.test("isAwaitingAttendanceRating / isAttendanceDone / terminal", () => {
  assertEquals(
    isAwaitingAttendanceRating({
      conversation_step: ATTENDANCE_RATING_STEP,
      attendance_rating: null,
      attendance_rating_requested_at: "x",
    }),
    true,
  );
  assertEquals(
    isAwaitingAttendanceRating({
      conversation_step: null,
      attendance_rating: null,
      attendance_rating_requested_at: "x",
    }),
    true,
  );
  assertEquals(
    isAwaitingAttendanceRating({
      conversation_step: ATTENDANCE_RATING_STEP,
      attendance_rating: 5,
      attendance_rating_requested_at: "x",
    }),
    false,
  );
  assertEquals(
    isAttendanceDone({ conversation_step: ATTENDANCE_DONE_STEP, attendance_rating: null }),
    true,
  );
  assertEquals(
    isAttendanceDone({ conversation_step: "welcome", attendance_rating: 4 }),
    true,
  );
  assertEquals(isAttendanceTerminalStep(ATTENDANCE_RATING_STEP), true);
  assertEquals(isAttendanceTerminalStep(ATTENDANCE_DONE_STEP), true);
  assertEquals(isAttendanceTerminalStep("aguardando_conta"), false);
});
