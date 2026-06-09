// =============================================================================
// CORS — allowlist de origens para Edge Functions
// =============================================================================
// Em vez de "Access-Control-Allow-Origin: *", reflete a origem da requisição
// somente quando ela está na allowlist (env `ALLOWED_ORIGINS`, separada por
// vírgula). Isso reduz a superfície de CSRF/abuso em funções sensíveis.
//
// USO:
//   import { buildCors } from "../_shared/cors.ts";
//   const cors = buildCors(req);
//   if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
//   ...
//   return new Response(JSON.stringify(body), {
//     status, headers: { ...cors, "Content-Type": "application/json" },
//   });
// =============================================================================

/** Origens liberadas em desenvolvimento quando `ALLOWED_ORIGINS` não está setada. */
const DEV_FALLBACK_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:8080",
];

const BASE_ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type";

function allowedOrigins(): string[] {
  const raw = Deno.env.get("ALLOWED_ORIGINS") ?? "";
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : DEV_FALLBACK_ORIGINS;
}

/**
 * Monta os headers de CORS para a requisição.
 *
 * @param req Requisição recebida (usada para ler o header `Origin`).
 * @param extraAllowHeaders Headers adicionais permitidos, separados por vírgula
 *                          (ex.: "x-service-secret").
 */
export function buildCors(req: Request, extraAllowHeaders = ""): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allow = allowedOrigins();
  // Reflete a origem quando permitida; senão devolve a primeira da allowlist
  // (o navegador bloqueia por mismatch, que é o comportamento desejado).
  const allowOrigin = allow.includes(origin) ? origin : allow[0];

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": extraAllowHeaders
      ? `${BASE_ALLOW_HEADERS}, ${extraAllowHeaders}`
      : BASE_ALLOW_HEADERS,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
