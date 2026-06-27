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

// Origens de produção sempre liberadas, mesmo que `ALLOWED_ORIGINS` não esteja
// definida no ambiente. Evita que o portal pare de funcionar caso a env não
// tenha sido configurada (foi exatamente o que quebrou o suporte remoto).
const PROD_ORIGINS = [
  "https://igreen.cloud",
  "https://www.igreen.cloud",
];

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
  // Produção é sempre permitida; soma-se ao que vier da env (sem duplicar) e,
  // em dev, também libera localhost.
  return Array.from(new Set([...PROD_ORIGINS, ...list, ...DEV_FALLBACK_ORIGINS]));
}

/**
 * Monta os headers de CORS para a requisição.
 *
 * @param req Requisição recebida (usada para ler o header `Origin`).
 * @param extraAllowHeaders Headers adicionais permitidos, separados por vírgula
 *                          (ex.: "x-service-secret").
 */
// Padrões de origens sempre liberadas (preview/sandbox do Lovable).
// Mantemos as previews liberadas pra não quebrar testes da equipe direto do editor.
const ORIGIN_PATTERNS: RegExp[] = [
  /^https:\/\/([a-z0-9-]+\.)*lovable\.app$/i,
  /^https:\/\/([a-z0-9-]+\.)*lovableproject\.com$/i,
  /^https:\/\/([a-z0-9-]+\.)*lovable\.dev$/i,
];

function isOriginAllowed(origin: string, allow: string[]): boolean {
  if (!origin) return false;
  if (allow.includes(origin)) return true;
  return ORIGIN_PATTERNS.some((re) => re.test(origin));
}

export function buildCors(req: Request, extraAllowHeaders = ""): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allow = allowedOrigins();
  // Reflete a origem quando permitida (lista fixa ou pattern de preview);
  // senão devolve a primeira da allowlist (browser bloqueia por mismatch).
  const allowOrigin = isOriginAllowed(origin, allow) ? origin : allow[0];


  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": extraAllowHeaders
      ? `${BASE_ALLOW_HEADERS}, ${extraAllowHeaders}`
      : BASE_ALLOW_HEADERS,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
