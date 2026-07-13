// Testes da fila espaçadora anti-ban do Whapi (whapi-throttle.ts).
// Rodar: deno test --allow-env supabase/functions/_shared/whapi-throttle_test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { awaitWhapiSendSlot } from "./whapi-throttle.ts";

function fakeClient(rpcImpl: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>) {
  return {
    rpc: (fn: string, args: Record<string, unknown>) => rpcImpl(fn, args),
  } as never;
}

Deno.test("awaitWhapiSendSlot: aguarda wait_ms devolvido pela RPC", async () => {
  let calledWith: Record<string, unknown> | null = null;
  const client = fakeClient((fn, args) => {
    calledWith = { fn, ...args };
    return Promise.resolve({
      data: { wait_ms: 150, same_contact: false, sent_today: 3 },
      error: null,
    });
  });

  const t0 = Date.now();
  const r = await awaitWhapiSendSlot("5511999990001@s.whatsapp.net", {
    supabase: client,
    kind: "test",
  });
  const elapsed = Date.now() - t0;

  assertEquals(r.source, "rpc");
  assertEquals(r.waitedMs, 150);
  assertEquals(r.sentToday, 3);
  assert(elapsed >= 140, `esperava aguardar ~150ms, aguardou ${elapsed}ms`);
  assertEquals((calledWith as Record<string, unknown> | null)?.fn, "claim_whapi_send_slot");
  assertEquals((calledWith as Record<string, unknown> | null)?.p_instance, "whapi-superadmin");
});

Deno.test("awaitWhapiSendSlot: wait_ms=0 retorna imediato", async () => {
  const client = fakeClient(() =>
    Promise.resolve({ data: { wait_ms: 0, same_contact: true, sent_today: 4 }, error: null })
  );
  const t0 = Date.now();
  const r = await awaitWhapiSendSlot("5511999990001@s.whatsapp.net", { supabase: client });
  assert(Date.now() - t0 < 100);
  assertEquals(r.source, "rpc");
  assertEquals(r.waitedMs, 0);
});

Deno.test("awaitWhapiSendSlot: fail-open quando RPC lança (nunca bloqueia envio)", async () => {
  const client = fakeClient(() => Promise.reject(new Error("boom")));
  const r = await awaitWhapiSendSlot("5511999990002@s.whatsapp.net", { supabase: client });
  assertEquals(r.source, "local");
  // Segunda chamada em fail-open aplica jitter local (700–2200ms) — não zero.
  const r2 = await awaitWhapiSendSlot("5511999990003@s.whatsapp.net", { supabase: client });
  assertEquals(r2.source, "local");
  assert(r2.waitedMs > 0, "segunda chamada fail-open deve espaçar localmente");
});

Deno.test("awaitWhapiSendSlot: erro de RPC (error != null) também fail-open", async () => {
  const client = fakeClient(() =>
    Promise.resolve({ data: null, error: { message: "function does not exist" } })
  );
  const r = await awaitWhapiSendSlot("5511999990004@s.whatsapp.net", { supabase: client });
  assertEquals(r.source, "local");
});

Deno.test("awaitWhapiSendSlot: intent reply usa intervalo curto (same-contact)", async () => {
  let args: Record<string, unknown> | null = null;
  const client = fakeClient((_fn, a) => {
    args = a;
    return Promise.resolve({ data: { wait_ms: 0, same_contact: false, sent_today: 1 }, error: null });
  });
  await awaitWhapiSendSlot("5511999990005@s.whatsapp.net", { supabase: client, intent: "reply" });
  const a = args as Record<string, unknown> | null;
  assertEquals(a?.p_global_ms, a?.p_same_contact_ms);
});
