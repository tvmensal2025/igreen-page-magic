/**
 * Property test para `resolveCaller` do helper compartilhado de auth das Edge
 * Functions service_role (`supabase/functions/_shared/caller-auth.ts`).
 *
 * Task 5.9 do spec evolution-multiconsultor-pronto.
 *
 * // Feature: evolution-multiconsultor-pronto, Property 5: resolveCaller
 * // classifica o chamador corretamente — retorna `service` sse o header
 * // `x-service-secret` casa com `SERVICE_SHARED_SECRET` (tempo constante);
 * // caso contrário retorna `jwt` sse o `Authorization: Bearer` for um JWT
 * // válido (role `authenticated`); caso contrário retorna `401`, sem produzir
 * // qualquer efeito colateral.
 *
 * **Validates: Requirements 5.1, 5.4**
 *
 * Estratégia de teste sem mocks de dados falsos no fluxo de produção:
 *   - O módulo importa `createClient` de uma URL esm.sh (Deno) e lê `Deno.env`.
 *     Para exercitá-lo sob Vitest (Node), mockamos APENAS as dependências de
 *     runtime Deno/esm.sh (o cliente anon e `Deno.env`), preservando 100% da
 *     lógica real de classificação do helper sob teste.
 *   - O cliente `admin` é um duplo que CONTA acessos a `.rpc`/`.from`, para
 *     afirmar a ausência de efeito colateral no ramo 401.
 *
 * Combinações geradas (Property 5):
 *   header x-service-secret: ausente × presente-correto × presente-incorreto
 *   Authorization:           ausente × Bearer inválido × Bearer válido
 */

import { fc, test } from "@fast-check/vitest";
import { describe, expect, beforeAll, vi } from "vitest";

// Segredo de serviço constante usado no ambiente de teste.
const SERVICE_SECRET = "test-shared-secret-7f3a91c2";

// Mock APENAS da dependência esm.sh (cliente Supabase). O `createClient`
// retornado é o cliente "anon" usado por `resolveCaller` para validar o JWT.
// `getUser` considera válido qualquer token no formato `valid:<userId>`.
vi.mock("https://esm.sh/@supabase/supabase-js@2.45.0", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        if (typeof token === "string" && token.startsWith("valid:")) {
          return { data: { user: { id: token.slice("valid:".length) } }, error: null };
        }
        return { data: { user: null }, error: { message: "invalid token" } };
      },
    },
  }),
}));

import { resolveCaller } from "../../supabase/functions/_shared/caller-auth.ts";

// Stub do runtime Deno (lido por `resolveCaller` em tempo de execução).
beforeAll(() => {
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: {
      get: (key: string): string | undefined =>
        ({
          SERVICE_SHARED_SECRET: SERVICE_SECRET,
          SUPABASE_URL: "https://test-project.supabase.co",
          SUPABASE_ANON_KEY: "anon-test-key",
        } as Record<string, string>)[key],
    },
  };
});

// ─── Duplo do client `admin` (service_role) com contadores ──────────────────
// `resolveCaller` só usa `admin.rpc("has_role", ...)` (e somente no ramo JWT
// válido). Contamos qualquer acesso a `.rpc`/`.from` para provar a ausência de
// efeito colateral nos ramos `service` e `401`.
function makeAdmin(hasRoleResult: boolean) {
  const calls = { rpc: 0, from: 0 };
  const client = {
    rpc: async (_name: string, _args: unknown) => {
      calls.rpc++;
      return { data: hasRoleResult, error: null };
    },
    from: (_table: string) => {
      calls.from++;
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      };
    },
  };
  return { client, calls };
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

// Valor de header seguro (alfanumérico) e que nunca coincide com o segredo
// (o alfabeto exclui '-', portanto difere de SERVICE_SECRET por construção).
const arbHeaderValue = fc
  .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), {
    minLength: 0,
    maxLength: 24,
  })
  .map((chars) => chars.join(""));

const arbServiceHeader = fc.oneof(
  fc.constant({ kind: "absent" as const }),
  fc.constant({ kind: "correct" as const }),
  arbHeaderValue.map((value) => ({ kind: "incorrect" as const, value })),
);

const arbAuthHeader = fc.oneof(
  fc.constant({ kind: "absent" as const }),
  arbHeaderValue.map((value) => ({ kind: "invalid" as const, value })),
  fc.record({ userId: fc.uuid(), isAdmin: fc.boolean() }).map(({ userId, isAdmin }) => ({
    kind: "valid" as const,
    userId,
    isAdmin,
  })),
);

const arbCase = fc.record({ svc: arbServiceHeader, auth: arbAuthHeader });

function buildRequest(svc: { kind: string; value?: string }, auth: { kind: string; value?: string; userId?: string }): Request {
  const headers = new Headers();
  if (svc.kind === "correct") headers.set("x-service-secret", SERVICE_SECRET);
  else if (svc.kind === "incorrect") headers.set("x-service-secret", svc.value ?? "");

  if (auth.kind === "invalid") headers.set("Authorization", `Bearer inv-${auth.value}`);
  else if (auth.kind === "valid") headers.set("Authorization", `Bearer valid:${auth.userId}`);

  return new Request("https://example.com/fn", { method: "POST", headers });
}

// ─── Property 5 ───────────────────────────────────────────────────────────

describe("Property 5 — resolveCaller classifica o chamador corretamente (R5.1, R5.4)", () => {
  test.prop([arbCase], { numRuns: 200 })(
    "service sse segredo casa; senão jwt sse Bearer válido; senão 401 sem efeito colateral",
    async ({ svc, auth }) => {
      const hasRoleResult = auth.kind === "valid" ? auth.isAdmin : false;
      const admin = makeAdmin(hasRoleResult);
      const req = buildRequest(svc, auth);

      const caller = await resolveCaller(req, admin.client as never);

      if (svc.kind === "correct") {
        // Segredo correto vence (checado primeiro) → modo service.
        expect(caller).toEqual({ mode: "service" });
        // Modo service dispensa qualquer acesso ao banco via admin.
        expect(admin.calls.rpc).toBe(0);
        expect(admin.calls.from).toBe(0);
      } else if (auth.kind === "valid") {
        // Segredo ausente/incorreto + Bearer válido → modo jwt.
        expect(caller).not.toBeInstanceOf(Response);
        expect(caller).toEqual({
          mode: "jwt",
          consultantId: auth.userId,
          isAdmin: auth.isAdmin === true,
        });
      } else {
        // Sem via válida → 401.
        expect(caller).toBeInstanceOf(Response);
        expect((caller as Response).status).toBe(401);
        // Ramo 401 NÃO produz efeito colateral: admin nunca é tocado.
        expect(admin.calls.rpc).toBe(0);
        expect(admin.calls.from).toBe(0);
      }
    },
  );
});
