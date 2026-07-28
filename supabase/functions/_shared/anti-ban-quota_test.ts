import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  awaitOutboundSendQuota,
  computeMinIntervalWaitMs,
  type SendQuotaResult,
} from "./anti-ban.ts";

Deno.test("computeMinIntervalWaitMs: usa next_allowed_at no futuro", () => {
  const next = new Date(Date.now() + 12_500).toISOString();
  const ms = computeMinIntervalWaitMs({ allowed: false, next_allowed_at: next });
  assertEquals(ms >= 11_000 && ms <= 13_500, true);
});

Deno.test("computeMinIntervalWaitMs: fallback min_interval_ms", () => {
  assertEquals(computeMinIntervalWaitMs({ allowed: false, min_interval_ms: 9000 }), 9000);
});

Deno.test("awaitOutboundSendQuota: allowed imediato", async () => {
  const supabase = {
    rpc: async () => ({ data: { allowed: true } as SendQuotaResult, error: null }),
  };
  const r = await awaitOutboundSendQuota(supabase, "whapi-superadmin", { channelKind: "whapi" });
  assertEquals(r.allowed, true);
  assertEquals(r.waitedMs, 0);
});

Deno.test("awaitOutboundSendQuota: Whapi bypassa min_interval (fila própria)", async () => {
  const supabase = {
    rpc: async () => ({
      data: { allowed: false, reason: "min_interval_not_elapsed", min_interval_ms: 18000 } as SendQuotaResult,
      error: null,
    }),
  };
  const r = await awaitOutboundSendQuota(supabase, "whapi-superadmin", { channelKind: "whapi" });
  assertEquals(r.allowed, true);
  assertEquals(r.softDefer, undefined);
});

Deno.test("awaitOutboundSendQuota: Whapi bypassa instance_not_found", async () => {
  const supabase = {
    rpc: async () => ({
      data: { allowed: false, reason: "instance_not_found" } as SendQuotaResult,
      error: null,
    }),
  };
  const r = await awaitOutboundSendQuota(supabase, "whapi-superadmin", { channelKind: "whapi" });
  assertEquals(r.allowed, true);
});

Deno.test("awaitOutboundSendQuota: Evolution espera e libera se quota ok depois", async () => {
  let calls = 0;
  const supabase = {
    rpc: async () => {
      calls++;
      if (calls === 1) {
        return {
          data: {
            allowed: false,
            reason: "min_interval_not_elapsed",
            min_interval_ms: 5,
          } as SendQuotaResult,
          error: null,
        };
      }
      return { data: { allowed: true } as SendQuotaResult, error: null };
    },
  };
  const r = await awaitOutboundSendQuota(supabase, "evo-x", {
    channelKind: "evolution",
    maxWaitMs: 1000,
  });
  assertEquals(r.allowed, true);
  assertEquals(r.waitedMs >= 5, true);
  assertEquals(calls, 2);
});

Deno.test("awaitOutboundSendQuota: Evolution softDefer se ainda bloqueado após espera", async () => {
  const supabase = {
    rpc: async () => ({
      data: {
        allowed: false,
        reason: "min_interval_not_elapsed",
        min_interval_ms: 5,
        next_allowed_at: new Date(Date.now() + 8_000).toISOString(),
      } as SendQuotaResult,
      error: null,
    }),
  };
  const r = await awaitOutboundSendQuota(supabase, "evo-x", {
    channelKind: "evolution",
    maxWaitMs: 1000,
  });
  assertEquals(r.allowed, false);
  assertEquals(r.softDefer, true);
  assertEquals(String(r.reason), "min_interval_not_elapsed");
  assertEquals((r.retryInMs ?? 0) >= 3000, true);
});

Deno.test("awaitOutboundSendQuota: cap/recovery continua bloqueando", async () => {
  const supabase = {
    rpc: async () => ({
      data: { allowed: false, reason: "daily_cap_reached" } as SendQuotaResult,
      error: null,
    }),
  };
  const r = await awaitOutboundSendQuota(supabase, "evo-x", { channelKind: "evolution" });
  assertEquals(r.allowed, false);
  assertEquals(r.softDefer, undefined);
  assertEquals(r.reason, "daily_cap_reached");
});
