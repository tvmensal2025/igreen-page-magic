import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { reemitStepButtons } from "./reemit-buttons.ts";

const BUTTON_CAPTURES = [
  {
    field: "_buttons",
    enabled: true,
    value: [
      { id: "sim", title: "Sim" },
      { id: "nao", title: "Não" },
    ],
  },
];

const FOUR_BUTTON_CAPTURES = [
  {
    field: "_buttons",
    enabled: true,
    value: [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
      { id: "c", title: "C" },
      { id: "d", title: "D" },
    ],
  },
];

function makeFakeSupabase() {
  const inserts: Record<string, unknown>[] = [];
  return {
    client: {
      from(table: string) {
        return {
          insert(row: Record<string, unknown>) {
            if (table === "conversations") inserts.push(row);
            return Promise.resolve({ data: null, error: null });
          },
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    },
    inserts,
  };
}

function baseOpts(overrides: Record<string, unknown> = {}) {
  const fake = makeFakeSupabase();
  const sendLog: string[] = [];
  const buttonsLog: Array<{ text: string; count: number }> = [];
  const textLog: string[] = [];

  const opts = {
    supabase: fake.client as any,
    customerId: "cust-1",
    consultantId: "cons-1",
    stepKey: "passo_test",
    remoteJid: "5511999999999@s.whatsapp.net",
    stepCaptures: BUTTON_CAPTURES,
    delayMs: 0,
    sendButtons: async (_jid: string, text: string, buttons: Array<{ id: string; title: string }>) => {
      buttonsLog.push({ text, count: buttons.length });
      sendLog.push("buttons");
      return true;
    },
    sendText: async (_jid: string, text: string) => {
      textLog.push(text);
      sendLog.push("text");
      return true;
    },
    ...overrides,
  };

  return { opts, fake, sendLog, buttonsLog, textLog };
}

Deno.test("reemitStepButtons: skipIfHandoff impede envio", async () => {
  const { opts, sendLog } = baseOpts({ skipIfHandoff: true });
  const ok = await reemitStepButtons(opts as any);
  assertEquals(ok, false);
  assertEquals(sendLog.length, 0);
});

Deno.test("reemitStepButtons: followups >= 2 impede envio", async () => {
  const { opts, sendLog } = baseOpts({ followups: 2 });
  const ok = await reemitStepButtons(opts as any);
  assertEquals(ok, false);
  assertEquals(sendLog.length, 0);
});

Deno.test("reemitStepButtons: sem botões no step retorna false", async () => {
  const { opts } = baseOpts({ stepCaptures: [{ field: "nome", value: "x" }] });
  const ok = await reemitStepButtons(opts as any);
  assertEquals(ok, false);
});

Deno.test("reemitStepButtons: envia botões e loga conversations", async () => {
  const { opts, fake, buttonsLog } = baseOpts();
  const ok = await reemitStepButtons(opts as any);
  assertEquals(ok, true);
  assertEquals(buttonsLog.length, 1);
  assertEquals(buttonsLog[0].count, 2);
  assertEquals(fake.inserts.length, 1);
  assertEquals(fake.inserts[0].message_type, "buttons");
});

Deno.test("reemitStepButtons: >3 opções usa sendText numerado", async () => {
  const { opts, sendLog, textLog } = baseOpts({ stepCaptures: FOUR_BUTTON_CAPTURES });
  const ok = await reemitStepButtons(opts as any);
  assertEquals(ok, true);
  assertEquals(sendLog, ["text"]);
  assertEquals(textLog[0].includes("*4.* D"), true);
});

Deno.test("reemitStepButtons: buttons[] direto (pós-FAQ conversational)", async () => {
  const { opts, sendLog, buttonsLog } = baseOpts({
    stepCaptures: undefined,
    buttons: [
      { id: "ativar", title: "Ativar" },
      { id: "simular", title: "Simular" },
    ],
  });
  const ok = await reemitStepButtons(opts as any);
  assertEquals(ok, true);
  assertEquals(sendLog, ["buttons"]);
  assertEquals(buttonsLog[0].count, 2);
});

Deno.test("reemitStepButtons: sendButtons false não loga conversations", async () => {
  const { opts, fake } = baseOpts({
    sendButtons: async () => false,
  });
  const ok = await reemitStepButtons(opts as any);
  assertEquals(ok, false);
  assertEquals(fake.inserts.length, 0);
});

Deno.test("reemitStepButtons: títulos truncados em 20 chars", async () => {
  const longTitle = "A".repeat(30);
  const captured: Array<{ id: string; title: string }> = [];
  const { opts } = baseOpts({
    stepCaptures: [{
      field: "_buttons",
      enabled: true,
      value: [{ id: "x", title: longTitle }],
    }],
    sendButtons: async (_jid: string, _text: string, buttons: Array<{ id: string; title: string }>) => {
      captured.push(...buttons);
      return true;
    },
  });
  await reemitStepButtons(opts as any);
  assertEquals(captured[0].title.length, 20);
});
