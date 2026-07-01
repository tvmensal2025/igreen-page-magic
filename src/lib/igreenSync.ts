// Sincronização com o Escritório iGreen via edge function `sync-igreen-customers`
// (que delega ao worker green no EasyPanel). Substitui a antiga extensão Chrome.
import { supabase } from "@/integrations/supabase/client";

export type SyncMode = "sync" | "sync_network" | "sync_metrics" | "sync_boletos" | "sync_all";

export type SyncResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: "not_configured" | "waf_blocked" | "invalid_credentials" | "failed"; error: string };

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
      const low = err.toLowerCase();
      if (low.includes("não configurado") || low.includes("nao configurado") || low.includes("credenciais"))
        return { ok: false, reason: "not_configured", error: err };
      if (low.includes("waf") || low.includes("cloudflare") || low.includes("bloque"))
        return { ok: false, reason: "waf_blocked", error: err };
      if (low.includes("login") || low.includes("senha") || low.includes("invalid"))
        return { ok: false, reason: "invalid_credentials", error: err };
      return { ok: false, reason: "failed", error: err };
    }
    return { ok: true, data: d };
  } catch (e) {
    return { ok: false, reason: "failed", error: e instanceof Error ? e.message : "Erro desconhecido" };
  }
}

/** Mensagem amigável para cada motivo de falha. */
export function syncErrorMessage(reason: SyncResult extends { ok: false } ? never : string, fallback?: string): string {
  return fallback || "Falha ao sincronizar. Tente novamente em instantes.";
}
