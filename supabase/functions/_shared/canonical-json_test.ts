import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { canonicalHash, canonicalStringify } from "./canonical-json.ts";

Deno.test("ordem das chaves não altera a forma canônica", () => {
  const a = { campaign: "x", budget: 1000, city: { slug: "udi", ddd: 34 } };
  const b = { city: { ddd: 34, slug: "udi" }, budget: 1000, campaign: "x" };
  assertEquals(canonicalStringify(a), canonicalStringify(b));
});

Deno.test("hash é estável e sensível a mudança real de conteúdo", async () => {
  const base = { adset: "a", budget: 1000 };
  const same = await canonicalHash({ budget: 1000, adset: "a" });
  const first = await canonicalHash(base);
  assertEquals(first, same, "mesmo conteúdo lógico gera a mesma chave");
  assertEquals(first.length, 64);

  const changed = await canonicalHash({ adset: "a", budget: 1001 });
  assertEquals(first === changed, false, "conteúdo diferente muda a chave");
});

Deno.test("undefined é descartado em objeto e virá null em array", () => {
  assertEquals(canonicalStringify({ a: 1, b: undefined }), '{"a":1}');
  assertEquals(canonicalStringify([1, undefined, 2]), "[1,null,2]");
});

Deno.test("normaliza números não representáveis e -0", () => {
  assertEquals(canonicalStringify({ a: Number.NaN }), '{"a":null}');
  assertEquals(
    canonicalStringify({ a: Number.POSITIVE_INFINITY }),
    '{"a":null}',
  );
  assertEquals(canonicalStringify({ a: -0 }), '{"a":0}');
});

Deno.test("Date vira ISO e BigInt vira string decimal", () => {
  assertEquals(
    canonicalStringify({ at: new Date("2026-07-24T00:00:00.000Z") }),
    '{"at":"2026-07-24T00:00:00.000Z"}',
  );
  assertEquals(canonicalStringify({ n: 10n }), '{"n":"10"}');
});

Deno.test("array preserva ordem — só objeto é reordenado", () => {
  assertEquals(canonicalStringify([3, 1, 2]), "[3,1,2]");
});

Deno.test("ciclo falha explicitamente em vez de gerar chave errada", () => {
  const cyclic: Record<string, unknown> = { a: 1 };
  cyclic.self = cyclic;
  assertThrows(() => canonicalStringify(cyclic), Error, "circular");
});
