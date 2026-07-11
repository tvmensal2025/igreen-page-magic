// Fast-start "Iniciar atendimento" — invoca start-customer-attendance com toasts
// consistentes. Usado pelos CTAs de topo (Chat/Cockpit/Lista) para 1 lead.
import { supabase } from "@/integrations/supabase/client";
import { toast as sonnerToast } from "sonner";

export interface FastStartResult {
  ok: boolean;
  protocol?: string;
  fallback?: boolean;
  message?: string;
}

export async function runFastStartAttendance({
  customerId,
  consultantId,
  alreadyStarted,
}: {
  customerId: string;
  consultantId: string;
  alreadyStarted?: boolean;
}): Promise<FastStartResult> {
  if (alreadyStarted) {
    sonnerToast.info("Atendimento já iniciado para este lead.");
    return { ok: true };
  }
  const tId = sonnerToast.loading("Iniciando atendimento...");
  try {
    const { data, error } = await supabase.functions.invoke("start-customer-attendance", {
      body: { customerId, consultantId },
    });
    if (error && !data) throw new Error(error.message || "Falha ao iniciar");
    const body = (data ?? {}) as {
      ok?: boolean;
      skipped?: string;
      protocol?: string;
      message?: string;
      detail?: string;
      error?: string;
      fallback?: boolean;
    };
    if (body.ok === false) {
      if (body.fallback) {
        sonnerToast.warning(body.message || "Envie manualmente pelo chat.", { id: tId });
        return { ok: false, fallback: true, message: body.message };
      }
      sonnerToast.error(body.message || body.detail || body.error || "Falha ao iniciar", { id: tId });
      return { ok: false, message: body.message || body.detail || body.error };
    }
    sonnerToast.success(
      body.skipped === "already_sent" ? "Atendimento já iniciado" : "Atendimento iniciado",
      { id: tId, description: body.protocol ? `Protocolo ${body.protocol}` : undefined },
    );
    return { ok: true, protocol: body.protocol };
  } catch (e) {
    const msg = (e as Error).message || "Falha ao iniciar";
    sonnerToast.error(msg, { id: tId });
    return { ok: false, message: msg };
  }
}
