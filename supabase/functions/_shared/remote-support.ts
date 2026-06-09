// =============================================================================
// Remote Support — helpers compartilhados das Edge Functions
// =============================================================================
// Consolida a lógica que estava duplicada nas 6 functions remote-support-*:
//   - criação dos clients (service_role + anon p/ identificar o chamador);
//   - identificação do usuário autenticado (JWT);
//   - checagem de super admin;
//   - geração e hash do código de acesso;
//   - resposta JSON com CORS.
//
// USO:
//   import { buildCors } from "../_shared/cors.ts";
//   import { rs } from "../_shared/remote-support.ts";
//   const cors = buildCors(req);
//   if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
//   const ctx = await rs.context(req, cors);
//   if (ctx instanceof Response) return ctx;   // 401
//   const { admin, user, json } = ctx;
// =============================================================================

import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getAdminClient } from "./admin-client.ts";

/** Duração de validade do código de acesso (ms). */
export const CODE_TTL_MS = 60_000;

/** Tempo máximo que uma sessão pode permanecer ativa antes de expirar (ms). */
export const SESSION_MAX_DURATION_MS = 2 * 60 * 60_000; // 2h

export interface RemoteSupportContext {
  admin: SupabaseClient;
  user: User;
  /** Resposta JSON pronta com os headers de CORS já aplicados. */
  json: (body: unknown, status?: number) => Response;
}

/** Gera um código numérico de 6 dígitos com fonte criptográfica. */
export function genCode(): string {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const n = ((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) >>> 0;
  return String(n % 1_000_000).padStart(6, "0");
}

/** SHA-256 hex de uma string. */
export async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** IP do chamador a partir do header `x-forwarded-for`. */
export function callerIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

/**
 * Monta o contexto comum: valida o JWT, cria o client service_role e devolve
 * um helper `json` já com CORS. Retorna `Response` 401 quando o usuário é
 * inválido (sem efeito colateral).
 */
async function context(
  req: Request,
  cors: Record<string, string>,
  callerName: string,
): Promise<RemoteSupportContext | Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing auth" }, 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return json({ error: "invalid user" }, 401);

  const admin = getAdminClient(callerName);
  return { admin, user, json };
}

/** Verifica se o usuário é super admin via RPC `is_super_admin`. */
async function isSuperAdmin(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin.rpc("is_super_admin", { _user_id: userId });
  return data === true;
}

export const rs = { context, isSuperAdmin };
