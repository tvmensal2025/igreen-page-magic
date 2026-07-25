// Helper compartilhado de autenticação/posse para Edge Functions que rodam com
// `service_role` (bypass de RLS) e `verify_jwt = false`.
//
// Resolve o chamador por DOIS modos:
//   - `service`: header `x-service-secret` == `SERVICE_SHARED_SECRET` (comparação
//     em tempo constante). Usado por chamadas internas back-end→back-end
//     (ex.: evolution-webhook → ai-agent-router). Dispensa verificação de posse.
//   - `jwt`: `Authorization: Bearer <jwt>` válido (role `authenticated`) via
//     `anonClient.auth.getUser(token)`; `isAdmin` resolvido via RPC `has_role`.
//
// E verifica POSSE do recurso (`customer_id`/`consultant_id`) para o modo `jwt`
// não-admin, sem ler/modificar o recurso em caso de negação (exceto o lookup de
// posse estritamente necessário).
//
// Nomes deliberadamente alinhados ao spec arquivado `security-hardening-lgpd`
// (`SERVICE_SHARED_SECRET`, header `x-service-secret`) para reuso sem retrabalho.
//
// USO (no topo do handler, antes de qualquer efeito colateral):
//   import { resolveCaller, assertOwnership } from "../_shared/caller-auth.ts";
//   const caller = await resolveCaller(req, admin);
//   if (caller instanceof Response) return caller;            // 401
//   const deny = await assertOwnership(caller, { customerId }, admin);
//   if (deny) return deny;                                    // 400/403
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-secret",
};

export type Caller =
  | { mode: "jwt"; consultantId: string; isAdmin: boolean }
  | { mode: "service" };

// ─── Helpers internos ─────────────────────────────────────────────────────

/** Resposta JSON pronta com CORS, sem vazar PII. */
function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Comparação de strings em tempo constante para evitar timing oracle no segredo.
 * Não retorna cedo em caso de divergência de prefixo; acumula a diferença sobre
 * todos os bytes. A contagem de iterações depende do tamanho da entrada do
 * chamador, nunca de quantos caracteres iniciais batem com o segredo.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  // Divergência de tamanho já marca diff != 0, mas ainda iteramos para não vazar.
  let diff = aBytes.length ^ bBytes.length;
  const len = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < len; i++) {
    const av = i < aBytes.length ? aBytes[i] : 0;
    const bv = i < bBytes.length ? bBytes[i] : 0;
    diff |= av ^ bv;
  }
  return diff === 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida um identificador uuid v4-ish; ausente/vazio/malformado → false. */
function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// ─── Contrato público ───────────────────────────────────────────────────────

/**
 * Resolve o chamador da requisição.
 *
 * Retorna:
 *   - `{ mode: "service" }` quando o header `x-service-secret` casa com
 *     `SERVICE_SHARED_SECRET` (tempo constante);
 *   - `{ mode: "jwt", consultantId, isAdmin }` quando há um Bearer JWT válido;
 *   - `Response` 401 (pronta, com CORS) quando nenhuma das duas vias valida.
 *
 * Nunca produz efeito colateral no ramo de negação (401).
 */
export async function resolveCaller(
  req: Request,
  admin: SupabaseClient,
): Promise<Caller | Response> {
  // 1) Modo service: segredo compartilhado em header (tempo constante).
  const serviceSecret = Deno.env.get("SERVICE_SHARED_SECRET") ?? "";
  const headerSecret = req.headers.get("x-service-secret");
  if (serviceSecret.length > 0 && headerSecret !== null) {
    if (timingSafeEqual(headerSecret, serviceSecret)) {
      return { mode: "service" };
    }
  }

  // 2) Modo jwt: Authorization Bearer validado via anon client.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  if (token.length > 0) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (supabaseUrl && anonKey) {
      const anonClient = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await anonClient.auth.getUser(token);
      const user = data?.user;
      if (!error && user?.id) {
        // has_role roda com o client service_role (mesmo padrão de admin-reset-password)
        let isAdmin = false;
        try {
          const { data: roleData } = await admin.rpc("has_role", {
            _user_id: user.id,
            _role: "admin",
          });
          isAdmin = roleData === true;
        } catch {
          isAdmin = false;
        }
        if (!isAdmin) {
          try {
            const { data: sa } = await admin.rpc("is_super_admin", {
              _user_id: user.id,
            });
            isAdmin = sa === true;
          } catch {
            /* keep false */
          }
        }
        return { mode: "jwt", consultantId: user.id, isAdmin };
      }
    }
  }

  // 3) Nenhuma via válida → 401 sem efeito colateral.
  return jsonResponse(401, { error: "unauthorized" });
}

/**
 * Verifica a posse do recurso-alvo para o chamador.
 *
 * Retorna `null` quando autorizado; ou uma `Response` (400/403) pronta quando
 * negado. Não lê nem modifica o recurso nos ramos de negação, exceto o lookup
 * de posse estritamente necessário.
 *
 * Regras:
 *   - `service`            → ok (chamada interna confiável; dispensa posse).
 *   - jwt admin            → ok.
 *   - `customerId` alvo    → busca `customers.consultant_id`: inexistente/
 *                            malformado → 400; outro consultor → 403; bate → ok.
 *   - `consultantId` alvo  → diverge → 403; ausente/malformado → 400; igual → ok.
 *   - nenhum alvo informado → 400 (identificador ausente).
 */
export async function assertOwnership(
  caller: Caller,
  target: { consultantId?: string; customerId?: string },
  admin: SupabaseClient,
): Promise<null | Response> {
  // Chamada interna confiável dispensa verificação de posse.
  if (caller.mode === "service") return null;

  // Admin acessa qualquer recurso.
  if (caller.isAdmin) return null;

  // Caminho por customerId (mais específico; tem precedência).
  if (target.customerId !== undefined) {
    if (!isValidUuid(target.customerId)) {
      return jsonResponse(400, { error: "invalid_request" });
    }
    const { data, error } = await admin
      .from("customers")
      .select("consultant_id")
      .eq("id", target.customerId)
      .maybeSingle();
    // Inexistente ou erro de lookup → 400 (não confirma existência de recurso alheio).
    if (error || !data) {
      return jsonResponse(400, { error: "invalid_request" });
    }
    if ((data as { consultant_id: string | null }).consultant_id !== caller.consultantId) {
      return jsonResponse(403, { error: "forbidden" });
    }
    return null;
  }

  // Caminho por consultantId.
  if (target.consultantId !== undefined) {
    if (!isValidUuid(target.consultantId)) {
      return jsonResponse(400, { error: "invalid_request" });
    }
    if (target.consultantId !== caller.consultantId) {
      return jsonResponse(403, { error: "forbidden" });
    }
    return null;
  }

  // Nenhum identificador informado → 400.
  return jsonResponse(400, { error: "invalid_request" });
}
