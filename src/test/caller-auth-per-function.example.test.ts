// Feature: evolution-multiconsultor-pronto
//
// Testes de EXEMPLO por função (Task 5.11) para a guarda IDOR (REQ 5) aplicada
// nas 5 Edge Functions service_role: `capture-extract`, `upload-documents-minio`,
// `ai-agent-router`, `ai-sales-agent` e `facebook-capi`.
//
// **Validates: Requirements 5.7** (e cobre os códigos 401/403/400/200 do REQ 5.4/5.5/5.6
// no contexto da escolha de alvo de cada função).
//
// ─── O QUE ESTE TESTE BOOTA (e o que NÃO boota) ──────────────────────────────
// HONESTIDADE DE ESCOPO: este arquivo NÃO sobe o servidor `Deno.serve` de cada
// função, NEM faz HTTP real, NEM toca Gemini/Evolution/MinIO/Meta CAPI. Os
// handlers chamam `Deno.serve` no import e alcançam APIs externas, o que torna
// um `deno test` de handler completo impraticável neste ambiente.
//
// Em vez disso, exercitamos o CONTRATO REAL da guarda por função: para cada uma
// das 5 funções, reproduzimos EXATAMENTE a sequência de 2 linhas que o handler
// roda no topo, antes de qualquer efeito colateral:
//
//     const caller = await resolveCaller(req, admin);
//     if (caller instanceof Response) return caller;            // 401
//     const deny = await assertOwnership(caller, <ALVO DA FUNÇÃO>, admin);
//     if (deny) return deny;                                    // 400/403
//     // ...segue o caminho-feliz (200) — NÃO bootado aqui
//
// usando o `resolveCaller`/`assertOwnership` REAIS importados de
// `supabase/functions/_shared/caller-auth.ts` e o ALVO real que cada função
// passa (ver `TARGET_SELECTORS`). Validamos, assim, a fiação da guarda por
// função — não a inicialização de cada servidor Deno.
//
// Alvo de cada função (verificado no código-fonte):
//   capture-extract        → { customerId: customer_id }
//   upload-documents-minio → { customerId: customer_id }
//   ai-agent-router        → { customerId: customer_id }
//   ai-sales-agent         → { customerId: customer_id }
//   facebook-capi          → customer_id ? { customerId } : { consultantId }
//
// Também cobrimos a invocação interna `evolution-webhook → ai-agent-router`:
// o header `x-service-secret` válido resolve como `mode: "service"` e a guarda
// libera a chamada (dispensa posse), espelhando o que o webhook envia.

import { describe, test, expect, beforeAll, vi } from "vitest";

// Segredo de serviço constante usado no ambiente de teste.
const SERVICE_SECRET = "test-shared-secret-5b11-per-fn";

// Mock APENAS da dependência esm.sh (cliente Supabase anon usado por
// `resolveCaller` para validar o JWT). `getUser` aceita tokens `valid:<userId>`.
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

import {
  resolveCaller,
  assertOwnership,
  type Caller,
} from "../../supabase/functions/_shared/caller-auth.ts";

// Stub do runtime Deno (lido por `resolveCaller`/`assertOwnership` em runtime).
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

// ─── UUIDs fixos para os cenários ───────────────────────────────────────────
const OWNER = "11111111-1111-4111-8111-111111111111"; // consultor chamador (dono)
const OTHER = "22222222-2222-4222-8222-222222222222"; // outro consultor
const CUSTOMER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // id de cliente alvo

// ─── Admin client FALSO (service_role) com gravador de efeitos colaterais ────
// `resolveCaller` usa `admin.rpc("has_role", ...)`. `assertOwnership` usa
// `admin.from("customers").select(...).eq(...).maybeSingle()`. Gravamos
// qualquer mutação para provar que ramos de negação não tocam o recurso.
type Lookup = { data: { consultant_id: string | null } | null; error: unknown };

function makeFakeAdmin(opts: { lookup?: Lookup; hasRole?: boolean } = {}) {
  const lookup: Lookup = opts.lookup ?? { data: null, error: null };
  const hasRole = opts.hasRole ?? false;
  const calls = { rpc: 0, from: 0, maybeSingle: 0, mutations: [] as string[] };

  const builder: Record<string, unknown> = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    maybeSingle() {
      calls.maybeSingle++;
      return Promise.resolve(lookup);
    },
    insert() {
      calls.mutations.push("insert");
      return builder;
    },
    update() {
      calls.mutations.push("update");
      return builder;
    },
    delete() {
      calls.mutations.push("delete");
      return builder;
    },
    upsert() {
      calls.mutations.push("upsert");
      return builder;
    },
  };

  const client = {
    rpc: async (_name: string, _args: unknown) => {
      calls.rpc++;
      return { data: hasRole, error: null };
    },
    from: (_table: string) => {
      calls.from++;
      return builder;
    },
  };

  return { client, calls };
}

// ─── Construtores de requisição (modos de auth) ──────────────────────────────
function reqNoAuth(): Request {
  return new Request("https://example.com/fn", { method: "POST" });
}

function reqJwt(userId: string): Request {
  const headers = new Headers();
  headers.set("Authorization", `Bearer valid:${userId}`);
  return new Request("https://example.com/fn", { method: "POST", headers });
}

/** Header EXATO que o `evolution-webhook` envia ao `ai-agent-router`. */
function reqInternalService(): Request {
  const headers = new Headers();
  headers.set("x-service-secret", SERVICE_SECRET);
  // O webhook também envia Authorization/apikey com o service_role key, mas o
  // `x-service-secret` é checado PRIMEIRO e resolve como mode:"service".
  headers.set("Authorization", "Bearer service-role-key");
  headers.set("apikey", "service-role-key");
  return new Request("https://example.com/fn", { method: "POST", headers });
}

// ─── Seletores de alvo por função (espelham 1:1 o código de produção) ─────────
type Body = { customer_id?: unknown; consultant_id?: unknown };
type Selector = (body: Body) => { consultantId?: string; customerId?: string };

const TARGET_SELECTORS: Record<string, Selector> = {
  "capture-extract": (b) => ({ customerId: b.customer_id as string }),
  "upload-documents-minio": (b) => ({ customerId: b.customer_id as string }),
  "ai-agent-router": (b) => ({ customerId: b.customer_id as string }),
  "ai-sales-agent": (b) => ({ customerId: b.customer_id as string }),
  "facebook-capi": (b) =>
    b.customer_id
      ? { customerId: b.customer_id as string }
      : { consultantId: b.consultant_id as string },
};

// As 4 funções que usam SEMPRE customerId.
const CUSTOMER_ID_FNS = [
  "capture-extract",
  "upload-documents-minio",
  "ai-agent-router",
  "ai-sales-agent",
] as const;

// ─── Pipeline da guarda: reproduz a sequência REAL do topo do handler ─────────
// Retorna o status HTTP que o handler retornaria pela guarda (401/400/403) ou
// 200 quando a guarda LIBERA a requisição (o caminho-feliz não é bootado).
type GuardOutcome = { status: number; admin: ReturnType<typeof makeFakeAdmin> };

async function runFunctionGuard(
  fnName: keyof typeof TARGET_SELECTORS,
  req: Request,
  body: Body,
  adminOpts: { lookup?: Lookup; hasRole?: boolean },
): Promise<GuardOutcome> {
  const admin = makeFakeAdmin(adminOpts);

  const caller = await resolveCaller(req, admin.client as never);
  if (caller instanceof Response) return { status: caller.status, admin };

  const deny = await assertOwnership(caller, TARGET_SELECTORS[fnName](body), admin.client as never);
  if (deny) return { status: deny.status, admin };

  // Guarda liberou → o handler real seguiria para o caminho-feliz (200).
  return { status: 200, admin };
}

// ─── Suites por função ────────────────────────────────────────────────────────

describe.each(CUSTOMER_ID_FNS)(
  "Guarda IDOR por função: %s (alvo = customerId) — REQ 5.7",
  (fnName) => {
    test("401 — sem auth (nem x-service-secret nem Bearer) → sem efeito colateral", async () => {
      const { status, admin } = await runFunctionGuard(
        fnName,
        reqNoAuth(),
        { customer_id: CUSTOMER },
        {},
      );
      expect(status).toBe(401);
      // Ramo 401 não toca o banco.
      expect(admin.calls.rpc).toBe(0);
      expect(admin.calls.from).toBe(0);
      expect(admin.calls.mutations).toEqual([]);
    });

    test("403 — JWT de outro consultor (customer pertence a OUTRO) sem mutação", async () => {
      const { status, admin } = await runFunctionGuard(
        fnName,
        reqJwt(OWNER),
        { customer_id: CUSTOMER },
        { lookup: { data: { consultant_id: OTHER }, error: null }, hasRole: false },
      );
      expect(status).toBe(403);
      expect(admin.calls.mutations).toEqual([]);
    });

    test("400 — customer_id ausente → sem efeito colateral", async () => {
      const { status, admin } = await runFunctionGuard(
        fnName,
        reqJwt(OWNER),
        {}, // customer_id undefined
        { hasRole: false },
      );
      expect(status).toBe(400);
      expect(admin.calls.mutations).toEqual([]);
    });

    test("400 — customer_id malformado (não-UUID) → sem lookup nem mutação", async () => {
      const { status, admin } = await runFunctionGuard(
        fnName,
        reqJwt(OWNER),
        { customer_id: "not-a-uuid" },
        { hasRole: false },
      );
      expect(status).toBe(400);
      // Malformado é rejeitado ANTES do lookup no banco.
      expect(admin.calls.maybeSingle).toBe(0);
      expect(admin.calls.mutations).toEqual([]);
    });

    test("200/legítimo (a) — JWT do DONO (customer pertence ao chamador) segue funcionando", async () => {
      const { status, admin } = await runFunctionGuard(
        fnName,
        reqJwt(OWNER),
        { customer_id: CUSTOMER },
        { lookup: { data: { consultant_id: OWNER }, error: null }, hasRole: false },
      );
      expect(status).toBe(200);
      expect(admin.calls.mutations).toEqual([]);
    });

    test("200/legítimo (b) — chamada interna com x-service-secret válido segue funcionando", async () => {
      const { status } = await runFunctionGuard(
        fnName,
        reqInternalService(),
        { customer_id: CUSTOMER },
        // service dispensa posse: nem precisa de lookup válido.
        { lookup: { data: { consultant_id: OTHER }, error: null } },
      );
      expect(status).toBe(200);
    });
  },
);

describe("Guarda IDOR por função: facebook-capi (alvo = customerId-preferido-senão-consultantId) — REQ 5.7", () => {
  const fnName = "facebook-capi" as const;

  test("401 — sem auth → sem efeito colateral", async () => {
    const { status, admin } = await runFunctionGuard(
      fnName,
      reqNoAuth(),
      { consultant_id: OWNER },
      {},
    );
    expect(status).toBe(401);
    expect(admin.calls.from).toBe(0);
    expect(admin.calls.rpc).toBe(0);
  });

  test("403 — JWT de outro consultor via customer_id (pertence a OUTRO)", async () => {
    const { status, admin } = await runFunctionGuard(
      fnName,
      reqJwt(OWNER),
      { customer_id: CUSTOMER, consultant_id: OWNER },
      { lookup: { data: { consultant_id: OTHER }, error: null }, hasRole: false },
    );
    expect(status).toBe(403);
    expect(admin.calls.mutations).toEqual([]);
  });

  test("403 — sem customer_id, consultant_id de OUTRO consultor (caminho consultantId)", async () => {
    const { status, admin } = await runFunctionGuard(
      fnName,
      reqJwt(OWNER),
      { consultant_id: OTHER },
      { hasRole: false },
    );
    expect(status).toBe(403);
    expect(admin.calls.mutations).toEqual([]);
  });

  test("400 — sem customer_id e consultant_id malformado", async () => {
    const { status } = await runFunctionGuard(
      fnName,
      reqJwt(OWNER),
      { consultant_id: "not-a-uuid" },
      { hasRole: false },
    );
    expect(status).toBe(400);
  });

  test("200/legítimo (a) — JWT do DONO via consultant_id próprio segue funcionando", async () => {
    const { status } = await runFunctionGuard(
      fnName,
      reqJwt(OWNER),
      { consultant_id: OWNER },
      { hasRole: false },
    );
    expect(status).toBe(200);
  });

  test("200/legítimo (a') — JWT do DONO via customer_id próprio segue funcionando", async () => {
    const { status } = await runFunctionGuard(
      fnName,
      reqJwt(OWNER),
      { customer_id: CUSTOMER, consultant_id: OWNER },
      { lookup: { data: { consultant_id: OWNER }, error: null }, hasRole: false },
    );
    expect(status).toBe(200);
  });

  test("200/legítimo (b) — chamada interna com x-service-secret válido segue funcionando", async () => {
    const { status } = await runFunctionGuard(
      fnName,
      reqInternalService(),
      { consultant_id: OTHER }, // mesmo de outro consultor: service dispensa posse
      {},
    );
    expect(status).toBe(200);
  });
});

// ─── Invocação interna evolution-webhook → ai-agent-router (com segredo) ──────
describe("Invocação interna evolution-webhook → ai-agent-router (x-service-secret) — REQ 5.3/5.7", () => {
  test("resolveCaller classifica o header do webhook como mode:'service'", async () => {
    const admin = makeFakeAdmin({});
    const caller = await resolveCaller(reqInternalService(), admin.client as never);
    expect(caller).toEqual<Caller>({ mode: "service" });
    // Modo service não consulta o banco em resolveCaller.
    expect(admin.calls.rpc).toBe(0);
    expect(admin.calls.from).toBe(0);
  });

  test("ai-agent-router libera a chamada interna mesmo com customer de OUTRO consultor", async () => {
    // O webhook passa { customer_id } no corpo; modo service dispensa posse.
    const { status, admin } = await runFunctionGuard(
      "ai-agent-router",
      reqInternalService(),
      { customer_id: CUSTOMER },
      { lookup: { data: { consultant_id: OTHER }, error: null } },
    );
    expect(status).toBe(200);
    // Nenhum lookup de posse é necessário no modo service.
    expect(admin.calls.maybeSingle).toBe(0);
    expect(admin.calls.mutations).toEqual([]);
  });
});
