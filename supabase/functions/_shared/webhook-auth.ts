// webhook-auth.ts — Validação OPCIONAL de origem de webhooks (fail-open).
//
// Problema: `whapi-webhook` e `evolution-webhook` rodam com verify_jwt=false
// (precisam, pois o provedor externo não manda JWT do Supabase). Hoje
// qualquer um que descubra a URL pode injetar mensagens falsas no bot.
//
// Solução fail-open (NÃO quebra produção):
//   - Se a env do segredo NÃO estiver configurada -> comportamento ATUAL
//     (segue normalmente). Nada muda até você ativar.
//   - Se a env do segredo ESTIVER configurada -> verifyWebhookOrigin retorna
//     ok=false quando o token falta/erra. Os handlers (evolution/whapi) ainda
//     ficam em grace/log-only até ENFORCE_WEBHOOK_ORIGIN=true.
//
// Ativação em duas etapas (quando quiser):
//   1) Definir WHAPI_WEBHOOK_SECRET / EVOLUTION_WEBHOOK_SECRET e configurar
//      o provedor (header x-webhook-secret ou ?secret= / ?token=).
//   2) Só então setar ENFORCE_WEBHOOK_ORIGIN=true para passar a 401.

/** Comparação de tempo constante para evitar timing attacks. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  const max = Math.max(ba.length, bb.length);
  let diff = ba.length === bb.length ? 0 : 1;
  for (let i = 0; i < max; i++) {
    diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export type WebhookAuthReason =
  | "no_secret_configured"
  | "missing_token"
  | "mismatch"
  | "match";

export interface WebhookAuthResult {
  ok: boolean;
  /** true quando há segredo configurado no ambiente (modo de validação ativo). */
  configured: boolean;
  reason: WebhookAuthReason;
}

/**
 * Verifica a origem do webhook contra a env `secretEnvName`. Fail-open:
 * sem segredo configurado, retorna ok=true (mantém o comportamento atual).
 */
export function verifyWebhookOrigin(req: Request, secretEnvName: string): WebhookAuthResult {
  const expected = (Deno.env.get(secretEnvName) || "").trim();
  if (!expected) {
    return { ok: true, configured: false, reason: "no_secret_configured" };
  }
  const headerToken = (
    req.headers.get("x-webhook-secret") ||
    req.headers.get("x-webhook-token") ||
    ""
  ).trim();
  let queryToken = "";
  try {
    const url = new URL(req.url);
    queryToken = (url.searchParams.get("secret") || url.searchParams.get("token") || "").trim();
  } catch (_) {
    /* URL inválida — trata como sem token */
  }
  const provided = headerToken || queryToken;
  if (!provided) {
    return { ok: false, configured: true, reason: "missing_token" };
  }
  const match = timingSafeEqualStr(provided, expected);
  return { ok: match, configured: true, reason: match ? "match" : "mismatch" };
}
