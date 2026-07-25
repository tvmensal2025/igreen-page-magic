/**
 * Serialização canônica e determinística.
 *
 * Objetivo: gerar a MESMA string para o mesmo conteúdo lógico, independente da
 * ordem de inserção das chaves. É a base para `client_request_id`/idempotência
 * (saga de publicação) e para `event_id` estável do CAPI (outbox).
 *
 * Regras:
 *  - Chaves de objeto são ordenadas de forma estável (code point).
 *  - `undefined` e funções são descartados (como no JSON.stringify de objeto).
 *  - `NaN`/`Infinity` viram `null` (JSON puro não os representa).
 *  - `-0` é normalizado para `0`.
 *  - Datas viram ISO string; BigInt vira string decimal.
 *  - Ciclos são rejeitados com erro explícito (nunca hash silenciosamente errado).
 *
 * Puro: sem I/O, sem relógio, sem aleatoriedade.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function normalizeNumber(value: number): Json {
  if (!Number.isFinite(value)) return null;
  return value === 0 ? 0 : value;
}

function canonicalize(value: unknown, seen: WeakSet<object>): Json | undefined {
  if (value === null) return null;

  const kind = typeof value;
  if (kind === "boolean" || kind === "string") return value as Json;
  if (kind === "number") return normalizeNumber(value as number);
  if (kind === "bigint") return (value as bigint).toString();
  if (kind === "undefined" || kind === "function" || kind === "symbol") {
    return undefined;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error("canonical-json: referência circular");
    seen.add(value);
    const items = value.map((item) => {
      const normalized = canonicalize(item, seen);
      // Buracos e valores não serializáveis viram null dentro de arrays,
      // exatamente como JSON.stringify faz.
      return normalized === undefined ? null : normalized;
    });
    seen.delete(value);
    return items;
  }

  if (kind === "object") {
    const record = value as Record<string, unknown>;
    if (seen.has(record)) {
      throw new Error("canonical-json: referência circular");
    }
    seen.add(record);
    const out: Record<string, Json> = {};
    for (const key of Object.keys(record).sort()) {
      const normalized = canonicalize(record[key], seen);
      if (normalized !== undefined) out[key] = normalized;
    }
    seen.delete(record);
    return out;
  }

  return undefined;
}

/** Retorna a string canônica. Lança em ciclos. */
export function canonicalStringify(value: unknown): string {
  const normalized = canonicalize(value, new WeakSet());
  return JSON.stringify(normalized === undefined ? null : normalized);
}

/** SHA-256 hex da forma canônica — chave estável de idempotência/event_id. */
export async function canonicalHash(value: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonicalStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
