// Testes do bot-flow: helpers puros + regex de transição checkin_pos_video.
// Não cobre o runBotFlow inteiro (depende de muitas chamadas Supabase).
// Foca nas mudanças recentes: timing de mídia, OCR fallback, check-in pós-vídeo.

import {
  assert,
  assertEquals,
  assertAlmostEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { __test } from "./bot-flow.ts";

const { sleepForMedia, fetchUrlToBase64, trigramSim, resolvePostBillNextStepId } = __test;

// ─────────────────────────────────────────────────────────────────────
// resolvePostBillNextStepId — destino pós-SIM da conta (anti-duplicação)
// Regressão do bug 2026-05-30: handler ignorava fallback.goto_step_id.
// ─────────────────────────────────────────────────────────────────────
Deno.test("resolvePostBillNextStepId: honra fallback.goto_step_id (mode goto)", () => {
  assertEquals(
    resolvePostBillNextStepId({ mode: "goto", goto_step_id: "d_resultado_id" }),
    "d_resultado_id",
  );
});

Deno.test("resolvePostBillNextStepId: success_goto_step_id tem prioridade", () => {
  assertEquals(
    resolvePostBillNextStepId({ mode: "goto", goto_step_id: "x", success_goto_step_id: "y" }),
    "y",
  );
});

Deno.test("resolvePostBillNextStepId: ignora goto_step_id quando mode != goto", () => {
  assertEquals(resolvePostBillNextStepId({ mode: "repeat", goto_step_id: "x" }), null);
});

Deno.test("resolvePostBillNextStepId: null/sem destino → null", () => {
  assertEquals(resolvePostBillNextStepId(null), null);
  assertEquals(resolvePostBillNextStepId(undefined), null);
  assertEquals(resolvePostBillNextStepId({}), null);
});

// ─────────────────────────────────────────────────────────────────────
// trigramSim — usado pelo Q&A configurado e pelo anti-loop
// ─────────────────────────────────────────────────────────────────────
Deno.test("trigramSim: idênticas → 1", () => {
  assertEquals(trigramSim("pode seguir", "pode seguir"), 1);
});

Deno.test("trigramSim: variação leve > 0.7", () => {
  const s = trigramSim("pode seguir", "pode seguir.");
  assert(s > 0.7, `esperado > 0.7, got ${s}`);
});

Deno.test("trigramSim: textos diferentes < 0.3", () => {
  const s = trigramSim("quanto custa", "vermelho amarelo");
  assert(s < 0.3, `esperado < 0.3, got ${s}`);
});

Deno.test("trigramSim: vazias → 0", () => {
  assertEquals(trigramSim("", "x"), 0);
  assertEquals(trigramSim("x", ""), 0);
});

// ─────────────────────────────────────────────────────────────────────
// sleepForMedia — controla o tempo entre áudio e vídeo
// Estratégia: monkey-patch setTimeout para acelerar mas medir o ms pedido.
// ─────────────────────────────────────────────────────────────────────
function withFakeSetTimeout<T>(fn: (recorded: number[]) => Promise<T>): Promise<T> {
  const recorded: number[] = [];
  const real = globalThis.setTimeout;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).setTimeout = (cb: () => void, ms: number) => {
    recorded.push(ms);
    return real(cb, 0);
  };
  return fn(recorded).finally(() => {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).setTimeout = real;
  });
}

Deno.test("sleepForMedia(audio, 5) → ~5000ms", async () => {
  await withFakeSetTimeout(async (rec) => {
    await sleepForMedia("audio", 5);
    assertEquals(rec[0], 5000);
  });
});

Deno.test("sleepForMedia(audio, 9999) → cap 120000ms", async () => {
  await withFakeSetTimeout(async (rec) => {
    await sleepForMedia("audio", 9999);
    assertEquals(rec[0], 120_000);
  });
});

Deno.test("sleepForMedia(audio, undefined) → default 90000ms", async () => {
  await withFakeSetTimeout(async (rec) => {
    await sleepForMedia("audio", undefined);
    assertEquals(rec[0], 90_000);
  });
});

Deno.test("sleepForMedia(video, 2) → 2000ms", async () => {
  await withFakeSetTimeout(async (rec) => {
    await sleepForMedia("video", 2);
    assertEquals(rec[0], 2000);
  });
});

Deno.test("sleepForMedia(video, 9999) → cap 90000ms", async () => {
  await withFakeSetTimeout(async (rec) => {
    await sleepForMedia("video", 9999);
    assertEquals(rec[0], 90_000);
  });
});

Deno.test("sleepForMedia(other) → fallback 1500ms", async () => {
  await withFakeSetTimeout(async (rec) => {
    await sleepForMedia("image", 0);
    assertEquals(rec[0], 1500);
  });
});

// ─────────────────────────────────────────────────────────────────────
// fetchUrlToBase64 — fallback de OCR quando proxy não trouxe bytes
// ─────────────────────────────────────────────────────────────────────
function withMockedFetch<T>(handler: (url: string) => Promise<Response>, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).fetch = (input: any) => handler(String(input));
  return fn().finally(() => {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).fetch = real;
  });
}

Deno.test("fetchUrlToBase64: 200 → base64 + mime", async () => {
  await withMockedFetch(
    () =>
      Promise.resolve(
        new Response(new Uint8Array([72, 105]), { // "Hi"
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      ),
    async () => {
      const res = await fetchUrlToBase64("https://x/y.jpg");
      assert(res !== null);
      assertEquals(res!.mime, "image/jpeg");
      assertEquals(atob(res!.base64), "Hi");
    },
  );
});

Deno.test("fetchUrlToBase64: 404 → null", async () => {
  await withMockedFetch(
    () => Promise.resolve(new Response("nope", { status: 404 })),
    async () => {
      const res = await fetchUrlToBase64("https://x/missing");
      assertEquals(res, null);
    },
  );
});

Deno.test({
  name: "fetchUrlToBase64: throw → null",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withMockedFetch(
      () => Promise.reject(new Error("boom")),
      async () => {
        const res = await fetchUrlToBase64("https://x/err");
        assertEquals(res, null);
      },
    );
  },
});

// ─────────────────────────────────────────────────────────────────────
// checkin_pos_video — valida regex de afirmativa/negativa usadas no case
// (replicadas idênticas — ver bot-flow.ts linha ~1030)
// ─────────────────────────────────────────────────────────────────────
const RE_AFFIRM = /^(sim|ss+|s|deu|entendi|entendido|claro|ok|okay|beleza|blz|certo|positivo|isso|🆗|👌|👍|✅|com\s*certeza|perfeito|bacana|massa|legal|joia|tranquilo)\b/i;
const RE_NEG = /^(n[aã]o|nn|n|nada|n[aã]o\s*entendi|n[aã]o\s*muito|mais\s*ou\s*menos|m[ãa]is\s*menos|confuso)\b/i;

Deno.test("checkin: 'sim entendi' é AFIRMATIVO", () => {
  assert(RE_AFFIRM.test("sim entendi"));
});
Deno.test("checkin: 'pode seguir' NÃO bate AFIRMATIVO direto (cai na qualificação default)", () => {
  // 'pode seguir' não está na lista — usado em duvidas_pos_club, não aqui
  assert(!RE_AFFIRM.test("pode seguir"));
});
Deno.test("checkin: 'não entendi' é NEGATIVO", () => {
  assert(RE_NEG.test("não entendi"));
});
Deno.test("checkin: pergunta com '?' deve cair na rota de dúvida", () => {
  const txt = "o que é igreen?";
  assert(!RE_AFFIRM.test(txt));
  assert(/\?/.test(txt));
});
Deno.test("checkin: '1600' captura valor (≥30)", () => {
  const txt = "1600";
  const m = txt.match(/(?:r\$\s*)?(\d{2,5}(?:[\.,]\d{1,2})?)/i);
  assert(m);
  const v = Number(m![1].replace(".", "").replace(",", "."));
  assertEquals(v, 1600);
  assert(v >= 30);
});
Deno.test("checkin: 'r$ 250,50' captura valor com vírgula", () => {
  const txt = "r$ 250,50";
  const m = txt.match(/(?:r\$\s*)?(\d{2,5}(?:[\.,]\d{1,2})?)/i);
  assert(m);
  const v = Number(m![1].replace(".", "").replace(",", "."));
  assertAlmostEquals(v, 250.5, 0.001);
});
