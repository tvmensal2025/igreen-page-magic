/**
 * Deno tests: pickCadenceTheme (SMS reusa WA) + pool sem cruise.
 * deno test supabase/functions/_shared/cadence-themes_test.ts
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CADENCE_THEMES,
  pickCadenceTheme,
} from "./cadence-themes.ts";

Deno.test("CADENCE_THEMES tem 7 temas e nenhum cruise", () => {
  assertEquals(CADENCE_THEMES.length, 7);
  assertEquals(CADENCE_THEMES.some((t) => t.id === "cruise"), false);
});

Deno.test("SMS_TEMA_2 reusa o mesmo theme_id do WA anterior", () => {
  const t = pickCadenceTheme({
    customerId: "cust-1",
    stage: "SMS_TEMA_2",
    lastThemeId: "security",
  });
  assertEquals(t.id, "security");
});

Deno.test("SMS_TEMA_7 reusa lastThemeId", () => {
  const t = pickCadenceTheme({
    customerId: "cust-2",
    stage: "SMS_TEMA_7",
    lastThemeId: "digital_app",
  });
  assertEquals(t.id, "digital_app");
});

Deno.test("COLD_2 rotaciona e evita lastThemeId", () => {
  const t = pickCadenceTheme({
    customerId: "cust-3",
    stage: "COLD_2",
    lastThemeId: "simplified_analysis",
  });
  assertEquals(t.id === "simplified_analysis", false);
});

Deno.test("SMS sem lastThemeId escolhe do pool", () => {
  const t = pickCadenceTheme({
    customerId: "cust-4",
    stage: "SMS_TEMA_2",
    lastThemeId: null,
  });
  assertEquals(!!t.id && !!t.sms, true);
});
