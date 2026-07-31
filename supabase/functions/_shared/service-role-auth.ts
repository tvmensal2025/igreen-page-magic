/** Auth helpers para edge functions (cron / service_role). */

import { timingSafeEqualStr } from "./webhook-auth.ts";

/**
 * Aceita APENAS o Bearer exatamente igual a SUPABASE_SERVICE_ROLE_KEY
 * (comparação em tempo constante).
 *
 * NÃO decodifica JWT pelo claim `role`: isso permitia bypass com payload
 * forjado `{"role":"service_role"}` sem assinatura válida.
 */
export function isServiceRoleAuth(req: Request): boolean {
  const serviceRole = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (!serviceRole) return false;

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;

  return timingSafeEqualStr(token, serviceRole);
}
