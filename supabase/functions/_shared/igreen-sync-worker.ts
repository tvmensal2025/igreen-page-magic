/**
 * Worker de LEITURA do escritório iGreen (carteira / sync).
 *
 * NÃO confundir com:
 * - portal2_worker_url → cadastro (worker-portal-2)
 * - club_worker_url → Club
 *
 * Fonte oficial (EasyPanel, verificado 2026-07-20):
 *   https://igreen-worker-igreen.d9v63q.easypanel.host
 *   GET /health → mode tor+playwright+api-vo-*
 */

export const IGREEN_SYNC_WORKER_OFFICIAL_URL =
  "https://igreen-worker-igreen.d9v63q.easypanel.host";

/** Hosts legados / locais que NÃO devem ser usados em produção. */
const BLOCKED_HOST_SNIPPETS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "igreen-sync-worker:", // docker interno sem domínio público
  "igreen-sync.d9v83a", // typo antigo na migration (cluster errado)
  "igreen_portal-worker",
  "igreen-portal-worker-2", // portal de CADASTRO, não sync
  "igreen-worker-club",
] as const;

export function sanitizeIgreenSyncWorkerUrl(raw: string | null | undefined): string {
  const url = String(raw || "").trim().replace(/\/$/, "");
  if (!url) return IGREEN_SYNC_WORKER_OFFICIAL_URL;
  const lower = url.toLowerCase();
  if (BLOCKED_HOST_SNIPPETS.some((s) => lower.includes(s))) {
    console.warn(
      `[igreen-sync-worker] URL bloqueada ("${url}") — usando oficial ${IGREEN_SYNC_WORKER_OFFICIAL_URL}`,
    );
    return IGREEN_SYNC_WORKER_OFFICIAL_URL;
  }
  return url;
}

export interface IgreenSyncWorkerCreds {
  url: string;
  secret: string;
}

/**
 * Resolve URL/secret do sync worker.
 * Ordem: settings → env → URL oficial hardcoded.
 * Sempre sanitiza hosts ruins (localhost / portal2 / typo).
 */
export async function resolveIgreenSyncWorker(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<IgreenSyncWorkerCreds | null> {
  const { data: settingsRows } = await supabase.from("settings").select("key, value");
  const settings: Record<string, string> = {};
  settingsRows?.forEach((s: { key: string; value: string }) => {
    settings[s.key] = s.value;
  });

  const url = sanitizeIgreenSyncWorkerUrl(
    settings.igreen_sync_worker_url ||
      Deno.env.get("IGREEN_SYNC_WORKER_URL") ||
      IGREEN_SYNC_WORKER_OFFICIAL_URL,
  );

  const secret =
    settings.igreen_sync_worker_secret ||
    Deno.env.get("IGREEN_SYNC_WORKER_SECRET") ||
    settings.worker_secret ||
    Deno.env.get("WORKER_SECRET") ||
    "";

  if (!url) return null;
  return { url, secret };
}
