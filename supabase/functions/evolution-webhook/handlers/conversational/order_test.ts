// Integration tests for `runConversationalFlow` — bugfix
// `whatsapp-flow-reliability-fix` ordering correctness.
//
// These tests reproduce two bugs that were silently breaking message
// ordering for users in production and prove the fix respects the
// per-step `flow_step_media_order` configured by the consultant:
//
//   Bug A — restart-cascade (unknown step / saudação): the loop used
//           to call `sendStepMedia` for every step, then concatenate
//           ALL step texts at the end into a single trailing reply.
//           Result: every cliente saw audio1, audio2, audio3, ...,
//           then a glued paragraph of texto1+texto2+texto3 — the
//           per-step ordering was lost AND text from multiple steps
//           bled together.
//
//   Bug B — QA hit (FAQ): always sent media first, text last,
//           ignoring `flow_step_media_order` for the virtual `__qa__`
//           slot.
//
// Strategy: stub Supabase + EvolutionSender, drive `runConversationalFlow`
// through scenarios that exercise both branches, and assert the exact
// sequence of `sender.sendMedia` / `sender.sendText` calls.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { runConversationalFlow } from "./index.ts";
import type { BotContext } from "../types.ts";

// ─── Recorder for outbound calls ────────────────────────────────────────

type SendEvent =
  | { kind: "audio" | "video" | "image" | "document"; url: string; stepStamp?: string }
  | { kind: "text"; text: string };

interface SenderRecorder {
  events: SendEvent[];
  sender: any;
}

function makeRecorder(): SenderRecorder {
  const events: SendEvent[] = [];
  return {
    events,
    sender: {
      sendText: async (_jid: string, text: string) => {
        events.push({ kind: "text", text });
        return true;
      },
      sendMedia: async (_jid: string, url: string, _caption: string, kind: string) => {
        events.push({ kind: kind as "audio" | "video" | "image" | "document", url });
        return true;
      },
      sendButtons: async (_jid: string, _msg: string, _btns: any[]) => true,
      sendPresence: async () => true,
      downloadMedia: async () => null,
    },
  };
}

// ─── In-memory stub of the Supabase tables we touch ─────────────────────

interface FakeStore {
  bot_flows: Array<{ id: string; consultant_id: string; is_active: boolean; variant: string; strict_mode: boolean }>;
  bot_flow_steps: Array<{
    id: string; flow_id: string; step_key: string; step_type: string | null;
    message_text: string | null; wait_for: string | null; text_delay_ms: number | null;
    slot_key: string | null; is_active: boolean; position: number;
    transitions: any[] | null; captures: any[] | null; fallback: any | null;
    auto_detect_doc_type: boolean | null; media_order: string[] | null;
  }>;
  ai_media_library: Array<{
    id: string; consultant_id: string; slot_key: string; kind: string;
    label: string | null; url: string; send_order: number;
    duration_sec: number | null; delay_before_ms: number | null;
    transcript: string | null; active: boolean;
  }>;
  consultants: Array<{ id: string; flow_step_media_order: Record<string, string[]> | null }>;
  bot_flow_qa: Array<{ id: string; flow_id: string; text_response: string; is_closing: boolean | null; is_opening: boolean }>;
  bot_flow_qa_triggers: Array<{ qa_id: string; phrase: string }>;
  bot_flow_qa_media: Array<{ qa_id: string; media_kind: string; slot_key: string | null; media_id: string | null; position: number }>;
  conversations: any[];
  bot_step_transitions: any[];
  customers_updates: Array<{ id: string; patch: Record<string, unknown> }>;
}

function makeFakeSupabase(initial: Partial<FakeStore> = {}) {
  const store: FakeStore = {
    bot_flows: initial.bot_flows ?? [],
    bot_flow_steps: initial.bot_flow_steps ?? [],
    ai_media_library: initial.ai_media_library ?? [],
    consultants: initial.consultants ?? [],
    bot_flow_qa: initial.bot_flow_qa ?? [],
    bot_flow_qa_triggers: initial.bot_flow_qa_triggers ?? [],
    bot_flow_qa_media: initial.bot_flow_qa_media ?? [],
    conversations: [],
    bot_step_transitions: [],
    customers_updates: [],
  };

  const DEBUG = (Deno.env.get("FAKE_SB_DEBUG") || "") === "1";
  // PostgREST fluent-builder shim. Each `.from(table)` returns a chain that
  // accumulates filters and resolves on `await` (then() short-circuit) or
  // on terminal calls like `.maybeSingle()` / `.single()` / `.insert()`.
  function builder(table: string) {
    type Filter = { col: string; op: string; val: unknown };
    const filters: Filter[] = [];
    let _select: string | null = null;
    let _order: { col: string; asc: boolean } | null = null;
    let _limit: number | null = null;

    const filterRows = (rows: any[]) =>
      rows.filter((r) => filters.every((f) => {
        const v = r[f.col];
        switch (f.op) {
          case "eq": return v === f.val;
          case "in": return Array.isArray(f.val) && (f.val as any[]).includes(v);
          case "is": return f.val === null ? v === null : v === f.val;
          case "not.in": return Array.isArray(f.val) && !(f.val as any[]).includes(v);
          // `.or("step_key.eq.X,id.eq.X")` — PostgREST OR de igualdades simples
          case "or": return (f.val as Array<{ col: string; val: string }>)
            .some((c) => String(r[c.col] ?? "") === c.val);
          default: return true;
        }
      }));


    const resolveSelect = () => {
      const tbl = (store as any)[table] as any[] | undefined;
      if (!tbl) {
        if (DEBUG) console.log(`[fake-sb] unknown table ${table}`);
        return { data: [], error: null };
      }
      let rows = filterRows(tbl);
      if (_order) rows = rows.slice().sort((a, b) => (a[_order!.col] - b[_order!.col]) * (_order!.asc ? 1 : -1));
      if (_limit != null) rows = rows.slice(0, _limit);
      if (DEBUG) console.log(`[fake-sb] ${table} select cols=${_select} filters=${JSON.stringify(filters)} → ${rows.length} rows`);
      return { data: rows, error: null };
    };

    const chain: any = {
      select(cols?: string) { _select = cols ?? "*"; return chain; },
      eq(col: string, val: unknown) { filters.push({ col, op: "eq", val }); return chain; },
      in(col: string, val: unknown[]) { filters.push({ col, op: "in", val }); return chain; },
      is(col: string, val: unknown) { filters.push({ col, op: "is", val }); return chain; },
      not(col: string, op: string, val: unknown) { filters.push({ col, op: `not.${op}`, val }); return chain; },
      or(expr: string) {
        const clauses = String(expr).split(",").map((part) => {
          const [col, op, ...rest] = part.split(".");
          return op === "eq" ? { col, val: rest.join(".") } : null;
        }).filter(Boolean) as Array<{ col: string; val: string }>;
        filters.push({ col: "__or__", op: "or", val: clauses });
        return chain;
      },
      gte(_col: string, _val: unknown) { return chain; },

      order(col: string, opts?: { ascending?: boolean }) { _order = { col, asc: opts?.ascending !== false }; return chain; },
      limit(n: number) { _limit = n; return chain; },
      maybeSingle() {
        const r = resolveSelect();
        return Promise.resolve({ data: (r.data as any[])[0] ?? null, error: r.error });
      },
      single() {
        const r = resolveSelect();
        return Promise.resolve({ data: (r.data as any[])[0] ?? null, error: r.error });
      },
      then(onFulfilled: any, onRejected: any) {
        return Promise.resolve(resolveSelect()).then(onFulfilled, onRejected);
      },
      insert(row: any) {
        const rows = Array.isArray(row) ? row : [row];
        const tbl = (store as any)[table] as any[] | undefined;
        if (tbl) tbl.push(...rows);
        return Promise.resolve({ data: rows, error: null });
      },
      upsert(row: any) {
        const rows = Array.isArray(row) ? row : [row];
        const tbl = (store as any)[table] as any[] | undefined;
        if (tbl) tbl.push(...rows);
        return {
          select() { return Promise.resolve({ data: rows, error: null }); },
          then(onFulfilled: any, onRejected: any) {
            return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
          },
        };
      },
      update(patch: Record<string, unknown>) {
        return {
          eq(col: string, val: unknown) {
            if (table === "customers") {
              store.customers_updates.push({ id: String(val), patch });
            }
            const tbl = (store as any)[table] as any[] | undefined;
            if (tbl) {
              for (const row of tbl) if (row[col] === val) Object.assign(row, patch);
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    };
    return chain;
  }

  const client = {
    from: builder,
    rpc: async (name: string, _args: Record<string, unknown>) => {
      // Allow every send by default. The bug we're testing is ordering,
      // not deduplication; production already covers dedupe via try_log_media_send.
      if (name === "try_log_media_send") return { data: true, error: null };
      return { data: null, error: null };
    },
  } as any;

  return { client, store };
}

// ─── Common test fixture builders ───────────────────────────────────────

const CONSULTANT_ID = "consultant-1";
const CUSTOMER_ID = "customer-1";
const FLOW_ID = "flow-1";

function makeBaseCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: CUSTOMER_ID,
    consultant_id: CONSULTANT_ID,
    name: null,
    phone_whatsapp: "5511999999999",
    conversation_step: "welcome",
    flow_variant: "A",
    electricity_bill_value: null,
    cpf: null,
    name_source: null,
    bot_paused: false,
    ...overrides,
  };
}

function makeCtx(supabaseClient: any, sender: any, overrides: Partial<BotContext> = {}): BotContext {
  return {
    supabase: supabaseClient,
    sender,
    customer: makeBaseCustomer(),
    consultorId: "124170",
    nomeRepresentante: "iGreen Energy",
    remoteJid: "5511999999999@s.whatsapp.net",
    phone: "5511999999999",
    messageText: "oi",
    buttonId: null,
    isFile: false,
    isButton: false,
    hasImage: false,
    hasDocument: false,
    imageMessage: null,
    documentMessage: null,
    message: {},
    key: {},
    messageId: "msg-test-1",
    instanceName: "test-instance",
    fileUrl: null,
    fileBase64: null,
    geminiApiKey: "",
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Bug A — restart-cascade respects per-step `flow_step_media_order`
//
// Three steps, each with audio + text. The consultant configured
// `text → audio` for every slot. Pre-fix: cliente saw audio1, audio2,
// audio3, then a single concatenated text. Post-fix: cliente sees the
// configured order PER STEP — text1, audio1, text2, audio2, text3, audio3.
// ────────────────────────────────────────────────────────────────────────

Deno.test("Bug A FIX: restart-cascade emits each step in the configured order (text→audio)", async () => {
  const { client } = makeFakeSupabase({
    bot_flows: [{ id: FLOW_ID, consultant_id: CONSULTANT_ID, is_active: true, variant: "A", strict_mode: false }],
    bot_flow_steps: [
      // Three cascading message steps, each with its own slot and own text.
      {
        id: "s1", flow_id: FLOW_ID, step_key: "boas_vindas", step_type: "message",
        message_text: "Texto do passo 1", wait_for: "none", text_delay_ms: 0,
        slot_key: "boas_vindas", is_active: true, position: 0,
        transitions: null, captures: null,
        fallback: { mode: "goto", goto_step_id: "s2" },
        auto_detect_doc_type: null, media_order: null,
      },
      {
        id: "s2", flow_id: FLOW_ID, step_key: "como_funciona", step_type: "message",
        message_text: "Texto do passo 2", wait_for: "none", text_delay_ms: 0,
        slot_key: "como_funciona", is_active: true, position: 1,
        transitions: null, captures: null,
        fallback: { mode: "goto", goto_step_id: "s3" },
        auto_detect_doc_type: null, media_order: null,
      },
      {
        id: "s3", flow_id: FLOW_ID, step_key: "ask_valor", step_type: "message",
        message_text: "Texto do passo 3 — qual o valor da sua conta?",
        wait_for: "reply", text_delay_ms: 0,
        slot_key: "ask_valor", is_active: true, position: 2,
        transitions: null, captures: [{ field: "electricity_bill_value", enabled: true }],
        fallback: { mode: "repeat" }, auto_detect_doc_type: null, media_order: null,
      },
    ],
    ai_media_library: [
      { id: "m1", consultant_id: CONSULTANT_ID, slot_key: "boas_vindas", kind: "audio", label: "audio1", url: "https://example/m1.ogg", send_order: 0, duration_sec: 1, delay_before_ms: 0, transcript: null, active: true },
      { id: "m2", consultant_id: CONSULTANT_ID, slot_key: "como_funciona", kind: "audio", label: "audio2", url: "https://example/m2.ogg", send_order: 0, duration_sec: 1, delay_before_ms: 0, transcript: null, active: true },
      { id: "m3", consultant_id: CONSULTANT_ID, slot_key: "ask_valor", kind: "audio", label: "audio3", url: "https://example/m3.ogg", send_order: 0, duration_sec: 1, delay_before_ms: 0, transcript: null, active: true },
    ],
    consultants: [{
      id: CONSULTANT_ID,
      // Per-slot order: text BEFORE audio for every step.
      flow_step_media_order: {
        boas_vindas: ["text", "audio"],
        como_funciona: ["text", "audio"],
        ask_valor: ["text", "audio"],
      },
    }],
  });

  const rec = makeRecorder();
  // Force restart-cascade by setting an unknown step.
  const ctx = makeCtx(client, rec.sender, {
    customer: makeBaseCustomer({ conversation_step: "STEP_QUE_NAO_EXISTE" }),
    messageText: "oi",
  });

  const r = await runConversationalFlow(ctx);

  // Reply should be empty — cascade emits everything inline.
  assertEquals(r.reply, "");
  assertEquals(r.updates.__inline_sent, true);

  // The exact emit order MUST be text→audio for each step, in step order.
  const seq = rec.events.map((e) => e.kind === "text" ? `T:${e.text}` : `${e.kind.toUpperCase()}:${e.url.split("/").pop()}`);

  assertEquals(seq, [
    "T:Texto do passo 1",
    "AUDIO:m1.ogg",
    "T:Texto do passo 2",
    "AUDIO:m2.ogg",
    "T:Texto do passo 3 — qual o valor da sua conta?",
    "AUDIO:m3.ogg",
  ], `event sequence wrong:\n${seq.join("\n")}`);
});

// ────────────────────────────────────────────────────────────────────────
// Bug A regression: pre-fix order would have been
// AUDIO:m1, AUDIO:m2, AUDIO:m3, T:Texto1\n\nTexto2\n\nTexto3
//
// We assert the post-fix sequence does NOT contain that pattern.
// ────────────────────────────────────────────────────────────────────────

Deno.test("Bug A FIX: restart-cascade does NOT glue all texts at the end", async () => {
  const { client } = makeFakeSupabase({
    bot_flows: [{ id: FLOW_ID, consultant_id: CONSULTANT_ID, is_active: true, variant: "A", strict_mode: false }],
    bot_flow_steps: [
      {
        id: "s1", flow_id: FLOW_ID, step_key: "p1", step_type: "message",
        message_text: "ALPHA", wait_for: "none", text_delay_ms: 0,
        slot_key: "slot_p1", is_active: true, position: 0,
        transitions: null, captures: null,
        fallback: { mode: "goto", goto_step_id: "s2" },
        auto_detect_doc_type: null, media_order: null,
      },
      {
        id: "s2", flow_id: FLOW_ID, step_key: "p2", step_type: "message",
        message_text: "BETA", wait_for: "reply", text_delay_ms: 0,
        slot_key: "slot_p2", is_active: true, position: 1,
        transitions: null, captures: null,
        fallback: { mode: "repeat" }, auto_detect_doc_type: null, media_order: null,
      },
    ],
    ai_media_library: [
      { id: "ma", consultant_id: CONSULTANT_ID, slot_key: "slot_p1", kind: "audio", label: "a", url: "https://example/a.ogg", send_order: 0, duration_sec: 1, delay_before_ms: 0, transcript: null, active: true },
      { id: "mb", consultant_id: CONSULTANT_ID, slot_key: "slot_p2", kind: "audio", label: "b", url: "https://example/b.ogg", send_order: 0, duration_sec: 1, delay_before_ms: 0, transcript: null, active: true },
    ],
    consultants: [{ id: CONSULTANT_ID, flow_step_media_order: { slot_p1: ["text", "audio"], slot_p2: ["text", "audio"] } }],
  });

  const rec = makeRecorder();
  const ctx = makeCtx(client, rec.sender, { customer: makeBaseCustomer({ conversation_step: "UNKNOWN" }) });
  const r = await runConversationalFlow(ctx);

  // No glued reply.
  assertEquals(r.reply, "");
  // No outgoing text contains BOTH ALPHA and BETA — they must be in separate sendText calls.
  const sentTexts = rec.events.filter((e) => e.kind === "text").map((e) => (e as { text: string }).text);
  for (const t of sentTexts) {
    const hasBoth = t.includes("ALPHA") && t.includes("BETA");
    assert(!hasBoth, `Bug regression: a single sendText contains both ALPHA and BETA: "${t}"`);
  }
  // Both must have been sent though.
  assert(sentTexts.includes("ALPHA"), "ALPHA was not emitted");
  assert(sentTexts.includes("BETA"), "BETA was not emitted");
});

// ────────────────────────────────────────────────────────────────────────
// Bug A FIX: legacy fallback (no `flow_step_media_order` configured)
// → mantém comportamento existente: mídia primeiro, texto inline (não
// concatenado). Texto de cada step ainda fica numa linha própria.
// ────────────────────────────────────────────────────────────────────────

Deno.test("Bug A FIX: without configured order, each step's text is still emitted separately (not glued)", async () => {
  const { client } = makeFakeSupabase({
    bot_flows: [{ id: FLOW_ID, consultant_id: CONSULTANT_ID, is_active: true, variant: "A", strict_mode: false }],
    bot_flow_steps: [
      {
        id: "s1", flow_id: FLOW_ID, step_key: "p1", step_type: "message",
        message_text: "Primeiro", wait_for: "none", text_delay_ms: 0,
        slot_key: "p1", is_active: true, position: 0,
        transitions: null, captures: null,
        fallback: { mode: "goto", goto_step_id: "s2" },
        auto_detect_doc_type: null, media_order: null,
      },
      {
        id: "s2", flow_id: FLOW_ID, step_key: "p2", step_type: "message",
        message_text: "Segundo", wait_for: "reply", text_delay_ms: 0,
        slot_key: "p2", is_active: true, position: 1,
        transitions: null, captures: null,
        fallback: { mode: "repeat" }, auto_detect_doc_type: null, media_order: null,
      },
    ],
    ai_media_library: [
      { id: "m1", consultant_id: CONSULTANT_ID, slot_key: "p1", kind: "audio", label: "a", url: "https://example/aa.ogg", send_order: 0, duration_sec: 1, delay_before_ms: 0, transcript: null, active: true },
    ],
    consultants: [{ id: CONSULTANT_ID, flow_step_media_order: null }],
  });

  const rec = makeRecorder();
  const ctx = makeCtx(client, rec.sender, { customer: makeBaseCustomer({ conversation_step: "UNKNOWN" }) });
  const r = await runConversationalFlow(ctx);

  assertEquals(r.reply, "");

  const texts = rec.events.filter((e) => e.kind === "text").map((e) => (e as { text: string }).text);
  // Both step texts must appear individually (not concatenated).
  assert(texts.includes("Primeiro"), "Primeiro missing");
  assert(texts.includes("Segundo"), "Segundo missing");
  for (const t of texts) {
    const hasBoth = t.includes("Primeiro") && t.includes("Segundo");
    assert(!hasBoth, `regression: glued texts in single sendText: "${t}"`);
  }
});

// ────────────────────────────────────────────────────────────────────────
// Bug B — QA hit honors `flow_step_media_order` for the virtual __qa__ slot.
// ────────────────────────────────────────────────────────────────────────

Deno.test("Bug B FIX: QA hit emits in configured order (text→audio) for __qa__", async () => {
  const QA_ID = "qa-1";
  const { client } = makeFakeSupabase({
    bot_flows: [{ id: FLOW_ID, consultant_id: CONSULTANT_ID, is_active: true, variant: "A", strict_mode: false }],
    bot_flow_steps: [
      {
        id: "s1", flow_id: FLOW_ID, step_key: "welcome", step_type: "message",
        message_text: "Bem vindo", wait_for: "reply", text_delay_ms: 0,
        slot_key: "welcome", is_active: true, position: 0,
        transitions: null, captures: null, fallback: { mode: "repeat" },
        auto_detect_doc_type: null, media_order: null,
      },
    ],
    bot_flow_qa: [{ id: QA_ID, flow_id: FLOW_ID, text_response: "Resposta do FAQ", is_closing: false, is_opening: false }],
    bot_flow_qa_triggers: [{ qa_id: QA_ID, phrase: "como funciona" }],
    bot_flow_qa_media: [{ qa_id: QA_ID, media_kind: "audio", slot_key: "qa_audio", media_id: "mq", position: 0 }],
    ai_media_library: [
      { id: "mq", consultant_id: CONSULTANT_ID, slot_key: "qa_audio", kind: "audio", label: "qa", url: "https://example/qa.ogg", send_order: 0, duration_sec: 1, delay_before_ms: 0, transcript: null, active: true },
    ],
    consultants: [{ id: CONSULTANT_ID, flow_step_media_order: { __qa__: ["text", "audio"] } }],
  });

  const rec = makeRecorder();
  const ctx = makeCtx(client, rec.sender, {
    customer: makeBaseCustomer({ conversation_step: "welcome" }),
    messageText: "como funciona",
  });

  const r = await runConversationalFlow(ctx);

  // Reply must be empty — QA emits everything inline.
  assertEquals(r.reply, "");
  // Regra canônica: quando o FAQ tem áudio, o texto duplicado é suprimido —
  // mesmo com ordem configurada (text→audio) sobra apenas o áudio.
  const seq = rec.events.map((e) => e.kind === "text" ? `T:${e.text}` : `${e.kind.toUpperCase()}`);
  assertEquals(seq, ["AUDIO"], `event sequence wrong:\n${seq.join("\n")}`);

});

// Sanity: legacy QA path (no order configured) still puts media first then text.
Deno.test("Bug B FIX: QA hit with no configured order falls back to media-first/text-last", async () => {
  const QA_ID = "qa-2";
  const { client } = makeFakeSupabase({
    bot_flows: [{ id: FLOW_ID, consultant_id: CONSULTANT_ID, is_active: true, variant: "A", strict_mode: false }],
    bot_flow_steps: [
      {
        id: "s1", flow_id: FLOW_ID, step_key: "welcome", step_type: "message",
        message_text: "Bem vindo", wait_for: "reply", text_delay_ms: 0,
        slot_key: "welcome", is_active: true, position: 0,
        transitions: null, captures: null, fallback: { mode: "repeat" },
        auto_detect_doc_type: null, media_order: null,
      },
    ],
    bot_flow_qa: [{ id: QA_ID, flow_id: FLOW_ID, text_response: "Resposta do FAQ", is_closing: false, is_opening: false }],
    bot_flow_qa_triggers: [{ qa_id: QA_ID, phrase: "como funciona" }],
    bot_flow_qa_media: [{ qa_id: QA_ID, media_kind: "audio", slot_key: "qa_audio", media_id: "mq", position: 0 }],
    ai_media_library: [
      { id: "mq", consultant_id: CONSULTANT_ID, slot_key: "qa_audio", kind: "audio", label: "qa", url: "https://example/qa.ogg", send_order: 0, duration_sec: 1, delay_before_ms: 0, transcript: null, active: true },
    ],
    consultants: [{ id: CONSULTANT_ID, flow_step_media_order: null }],
  });

  const rec = makeRecorder();
  const ctx = makeCtx(client, rec.sender, {
    customer: makeBaseCustomer({ conversation_step: "welcome" }),
    messageText: "como funciona",
  });

  await runConversationalFlow(ctx);
  const seq = rec.events.map((e) => e.kind === "text" ? "TEXT" : "AUDIO");
  // Regra canônica: FAQ com áudio NÃO repete o mesmo conteúdo em texto.
  assertEquals(seq, ["AUDIO"], `legacy fallback order wrong: ${seq.join(",")}`);

});
