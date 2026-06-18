import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyWebhookOrigin, timingSafeEqualStr } from "./webhook-auth.ts";

const ENV = "TEST_WEBHOOK_SECRET";

function reqWith(opts: { header?: string; query?: string } = {}): Request {
  const url = opts.query ? `https://x.test/hook?token=${opts.query}` : "https://x.test/hook";
  const headers: Record<string, string> = {};
  if (opts.header) headers["x-webhook-secret"] = opts.header;
  return new Request(url, { method: "POST", headers });
}

Deno.test("fail-open: sem segredo configurado, segue normalmente", () => {
  Deno.env.delete(ENV);
  const r = verifyWebhookOrigin(reqWith(), ENV);
  assertEquals(r.ok, true);
  assertEquals(r.configured, false);
  assertEquals(r.reason, "no_secret_configured");
});

Deno.test("configurado + header correto -> ok", () => {
  Deno.env.set(ENV, "s3cr3t-token");
  const r = verifyWebhookOrigin(reqWith({ header: "s3cr3t-token" }), ENV);
  assert(r.ok);
  assertEquals(r.reason, "match");
  Deno.env.delete(ENV);
});

Deno.test("configurado + query correta -> ok", () => {
  Deno.env.set(ENV, "s3cr3t-token");
  const r = verifyWebhookOrigin(reqWith({ query: "s3cr3t-token" }), ENV);
  assert(r.ok);
  Deno.env.delete(ENV);
});

Deno.test("configurado + token ausente -> 401 (missing_token)", () => {
  Deno.env.set(ENV, "s3cr3t-token");
  const r = verifyWebhookOrigin(reqWith(), ENV);
  assertEquals(r.ok, false);
  assertEquals(r.reason, "missing_token");
  Deno.env.delete(ENV);
});

Deno.test("configurado + token errado -> 401 (mismatch)", () => {
  Deno.env.set(ENV, "s3cr3t-token");
  const r = verifyWebhookOrigin(reqWith({ header: "errado" }), ENV);
  assertEquals(r.ok, false);
  assertEquals(r.reason, "mismatch");
  Deno.env.delete(ENV);
});

Deno.test("timingSafeEqualStr básico", () => {
  assert(timingSafeEqualStr("abc", "abc"));
  assert(!timingSafeEqualStr("abc", "abd"));
  assert(!timingSafeEqualStr("abc", "abcd"));
});
