import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { resolveOcrFallback } from "./ocr-fallback.ts";

Deno.test("resolveOcrFallback: sem consultant → default", async () => {
  const r = await resolveOcrFallback(
    {},
    "cust",
    null,
    "capture_conta",
    1,
    "DEFAULT",
    "A",
  );
  assertEquals(r.retryText, "DEFAULT");
  assertEquals(r.escalate, false);
  assertEquals(r.retryAudioClipId, null);
});

Deno.test("resolveOcrFallback: mode retry com texto e clip", async () => {
  const supabase = {
    from(table: string) {
      if (table === "bot_flows") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: { id: "flow1" } }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "bot_flow_steps") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: {
                          fallback: {
                            mode: "retry",
                            max_retries: 2,
                            retry_text: "TEXTO PAINEL",
                            then: "humano",
                            retry_audio_clip_id: "clip-abc",
                          },
                        },
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  const r = await resolveOcrFallback(
    supabase,
    "cust",
    "cons",
    "capture_conta",
    1,
    "DEFAULT",
    "A",
  );
  assertEquals(r.retryText, "TEXTO PAINEL");
  assertEquals(r.escalate, false);
  assertEquals(r.retryAudioClipId, "clip-abc");
});

Deno.test("resolveOcrFallback: escalate após max_retries", async () => {
  const supabase = {
    from(table: string) {
      if (table === "bot_flows") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: { id: "flow1" } }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: {
                        fallback: {
                          mode: "retry",
                          max_retries: 2,
                          retry_text: "RETRY",
                          then: "humano",
                        },
                      },
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    },
  };

  const r = await resolveOcrFallback(
    supabase,
    "cust",
    "cons",
    "capture_documento",
    2,
    "DEFAULT",
    "A",
  );
  assertEquals(r.retryText, "RETRY");
  assertEquals(r.escalate, true);
});
