import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertCronAuthStrict } from "./cron-auth.ts";

const AUTH_ENV_KEYS = [
  "SERVICE_SHARED_SECRET",
  "EMBED_INTERNAL_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ENFORCE_CRON_AUTH",
] as const;

async function withCleanAuthEnv(run: () => Promise<void>): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const key of AUTH_ENV_KEYS) {
    previous.set(key, Deno.env.get(key));
    Deno.env.delete(key);
  }

  try {
    await run();
  } finally {
    for (const key of AUTH_ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

Deno.test("auth cron estrita rejeita ambiente legado sem segredo", async () => {
  await withCleanAuthEnv(async () => {
    const result = await assertCronAuthStrict(
      new Request("https://example.test/cron", { method: "POST" }),
    );

    assertFalse(result.ok);
    assertEquals(result.reason, "missing");
  });
});

Deno.test("auth cron estrita aceita x-service-secret correto", async () => {
  await withCleanAuthEnv(async () => {
    Deno.env.set("SERVICE_SHARED_SECRET", "segredo-forte");
    const result = await assertCronAuthStrict(
      new Request("https://example.test/cron", {
        method: "POST",
        headers: { "x-service-secret": "segredo-forte" },
      }),
    );

    assertEquals(result, { ok: true, reason: "service_secret" });
  });
});

Deno.test("auth cron estrita distingue credencial incorreta", async () => {
  await withCleanAuthEnv(async () => {
    Deno.env.set("SERVICE_SHARED_SECRET", "segredo-forte");
    const result = await assertCronAuthStrict(
      new Request("https://example.test/cron", {
        method: "POST",
        headers: { "x-service-secret": "segredo-errado" },
      }),
    );

    assertFalse(result.ok);
    assertEquals(result.reason, "mismatch");
  });
});
