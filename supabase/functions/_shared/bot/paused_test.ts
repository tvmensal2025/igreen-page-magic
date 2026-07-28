import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isCustomerPausedByHuman, wrapSenderWithLivePauseGuard } from "./paused.ts";

Deno.test("isCustomerPausedByHuman: assigned_human_id silencia", () => {
  assertEquals(isCustomerPausedByHuman({ assigned_human_id: "u1" }), true);
});

Deno.test("isCustomerPausedByHuman: humano_assumiu silencia", () => {
  assertEquals(
    isCustomerPausedByHuman({ bot_paused: true, bot_paused_reason: "humano_assumiu" }),
    true,
  );
});

Deno.test("isCustomerPausedByHuman: manual_capture NÃO silencia", () => {
  assertEquals(
    isCustomerPausedByHuman({ bot_paused: true, bot_paused_reason: "manual_capture" }),
    false,
  );
});

Deno.test("wrapSenderWithLivePauseGuard: aborta sendText se humano assumiu", async () => {
  let sent = 0;
  const base = {
    sendText: async (_jid: string, _text: string) => {
      sent++;
      return true;
    },
  };
  const fakeSb = {
    from(_table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: {
                    bot_paused: true,
                    bot_paused_reason: "humano_assumiu",
                    assigned_human_id: "u1",
                    bot_paused_until: null,
                    do_not_contact: false,
                  },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };
  const guarded = wrapSenderWithLivePauseGuard(base as any, {
    supabase: fakeSb as any,
    getCustomerId: () => "cust-1",
  });
  const ok = await guarded.sendText("jid", "oi");
  assertEquals(ok, false);
  assertEquals(sent, 0);
});

Deno.test("wrapSenderWithLivePauseGuard: deixa passar se não pausado", async () => {
  let sent = 0;
  const base = {
    sendText: async (_jid: string, _text: string) => {
      sent++;
      return true;
    },
  };
  const fakeSb = {
    from(_table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: {
                    bot_paused: false,
                    bot_paused_reason: null,
                    assigned_human_id: null,
                    bot_paused_until: null,
                    do_not_contact: false,
                  },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };
  const guarded = wrapSenderWithLivePauseGuard(base as any, {
    supabase: fakeSb as any,
    getCustomerId: () => "cust-1",
  });
  const ok = await guarded.sendText("jid", "oi");
  assertEquals(ok, true);
  assertEquals(sent, 1);
});
