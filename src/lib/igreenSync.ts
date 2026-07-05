// Sincronização com o Escritório iGreen via edge function `sync-igreen-customers`
// (que delega ao worker green no EasyPanel). Substitui a antiga extensão Chrome.
import { supabase } from "@/integrations/supabase/client";

export type SyncMode = "sync" | "sync_network" | "sync_metrics" | "sync_boletos" | "sync_telecom" | "sync_seguros" | "sync_all" | "validate";

export type SyncResult =
  | { ok: true; data: Record<string, unknown> }
  | {
      ok: false;
      reason: "not_configured" | "waf_blocked" | "invalid_credentials" | "already_running" | "failed";
      error: string;
      retry_scheduled_at?: string | null;
    };

// Auto-retry: quando a edge devolve `retry_scheduled_at` (WAF), agendamos uma
// nova chamada no cliente para que o consultor não precise reclicar. Um único
// timer ativo por consultor+mode; se o usuário forçar sync antes, cancela.
const pendingAutoRetries = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleAutoRetry(consultantId: string, mode: SyncMode, retryAtIso: string) {
  const key = `${consultantId}:${mode}`;
  const prev = pendingAutoRetries.get(key);
  if (prev) clearTimeout(prev);
  const delay = Math.max(15_000, new Date(retryAtIso).getTime() - Date.now());
  const t = setTimeout(() => {
    pendingAutoRetries.delete(key);
    void runIgreenSync(consultantId, mode);
  }, delay);
  pendingAutoRetries.set(key, t);
}

/**
 * Dispara a sincronização do consultor logado. As credenciais do portal iGreen
 * ficam salvas em `consultants` (email/senha) — a edge as usa quando recebe só
 * o `consultant_id`. Individual e isolado por consultor.
 */
export async function runIgreenSync(consultantId: string, mode: SyncMode = "sync_all"): Promise<SyncResult> {
  try {
    const { data, error } = await supabase.functions.invoke("sync-igreen-customers", {
      body: { consultant_id: consultantId, mode },
    });
    if (error) return { ok: false, reason: "failed", error: error.message };

    // A edge devolve 200 com { success:false, error } em vários casos.
    const d = data as Record<string, unknown> | null;
    if (!d || (d as { success?: boolean }).success === false) {
      const err = String((d as { error?: string })?.error || "Falha na sincronização.");
      const reasonFromEdge = String((d as { reason?: string })?.reason || "").toLowerCase();
      const retryAt = (d as { retry_scheduled_at?: string | null })?.retry_scheduled_at || null;
      const low = err.toLowerCase();

      let reason: "not_configured" | "waf_blocked" | "invalid_credentials" | "already_running" | "failed";
      if (reasonFromEdge === "waf_blocked" || low.includes("waf") || low.includes("cloudflare") || low.includes("bloque") || low.includes("cooldown"))
        reason = "waf_blocked";
      else if (reasonFromEdge === "already_running" || low.includes("já existe uma sincroniz") || low.includes("em andamento"))
        reason = "already_running";
      else if (reasonFromEdge === "invalid_credentials" || low.includes("credenciais") || low.includes("senha") || low.includes("invalid"))
        reason = "invalid_credentials";
      else if (low.includes("não configurado") || low.includes("nao configurado"))
        reason = "not_configured";
      else
        reason = "failed";

      if (reason === "waf_blocked" && retryAt) {
        scheduleAutoRetry(consultantId, mode, retryAt);
      }
      if (reason === "already_running") {
        // A fila do worker já vai processar; refazemos o poll em 12s.
        scheduleAutoRetry(consultantId, mode, new Date(Date.now() + 12_000).toISOString());
      }

      return { ok: false, reason, error: err, retry_scheduled_at: retryAt };
    }
    // Sucesso: cancela retry pendente pra esse consultor+mode.
    const key = `${consultantId}:${mode}`;
    const prev = pendingAutoRetries.get(key);
    if (prev) { clearTimeout(prev); pendingAutoRetries.delete(key); }
    return { ok: true, data: d };
  } catch (e) {
    return { ok: false, reason: "failed", error: e instanceof Error ? e.message : "Erro desconhecido" };
  }
}

/**
 * Poll no último run do consultor até detectar `success`/`partial`/`error`.
 * A edge/worker às vezes só grava as linhas alguns segundos depois de responder;
 * este helper deixa a UI aguardar antes de recarregar a lista.
 */
export async function waitIgreenSyncFinished(
  consultantId: string,
  opts?: { timeoutMs?: number; intervalMs?: number; minStartedAt?: string },
): Promise<{ status: string; counts: Record<string, unknown> | null } | null> {
  const timeoutMs = opts?.timeoutMs ?? 150_000;
  const intervalMs = opts?.intervalMs ?? 4_000;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    let query = supabase
      .from("igreen_sync_runs")
      .select("mode, status, counts, finished_at")
      .eq("consultant_id", consultantId);
    if (opts?.minStartedAt) query = query.gte("started_at", opts.minStartedAt);
    const { data } = await query
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = data as { mode?: string; status?: string; counts?: Record<string, unknown> | null; finished_at?: string | null } | null;
    if (row?.status && row.status !== "running" && row.finished_at) {
      if (row.mode === "sync_all") {
        const extras = (row.counts?.extras ?? null) as Record<string, unknown> | null;
        if (!extras?._background_finished_at) {
          await new Promise((r) => setTimeout(r, intervalMs));
          continue;
        }
      }
      return { status: row.status, counts: row.counts ?? null };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

/** Mensagem amigável para cada motivo de falha. */
export function syncErrorMessage(reason: SyncResult extends { ok: false } ? never : string, fallback?: string): string {
  return fallback || "Falha ao sincronizar. Tente novamente em instantes.";
}

