// Fast-start "Iniciar atendimento" — invoca start-customer-attendance com toasts
// consistentes. Usado pelos CTAs de topo (Chat/Cockpit/Lista) para 1 lead.
import { supabase } from "@/integrations/supabase/client";
import { toast as sonnerToast } from "sonner";
import { notifyAttendanceOutcome, type AttendanceOutcome } from "@/lib/attendanceShortcut";

export interface FastStartResult {
  ok: boolean;
  protocol?: string;
  fallback?: boolean;
  message?: string;
  fixHint?: string | null;
}

export async function runFastStartAttendance({
  customerId,
  consultantId,
  alreadyStarted,
  navigate,
}: {
  customerId: string;
  consultantId: string;
  alreadyStarted?: boolean;
  /** Router navigate — habilita atalho clicável nos toasts. */
  navigate?: (path: string) => void;
}): Promise<FastStartResult> {
  if (alreadyStarted) {
    sonnerToast.info("Atendimento já iniciado para este lead.");
    return { ok: true };
  }
  const tId = sonnerToast.loading("Iniciando atendimento...");
  const doInvoke = () => supabase.functions.invoke("start-customer-attendance", {
    body: { customerId, consultantId },
  });
  try {
    const { data, error } = await doInvoke();
    if (error && !data) throw new Error(error.message || "Falha ao iniciar");
    const body = (data ?? {}) as AttendanceOutcome;
    notifyAttendanceOutcome(body, {
      kind: "start",
      toastId: tId,
      navigate,
      onRetry: () => {
        void runFastStartAttendance({ customerId, consultantId, navigate });
      },
    });
    if (body.ok === false) {
      return {
        ok: false,
        fallback: !!body.fallback,
        message: body.message,
        fixHint: (body.fixHint as string) ?? null,
      };
    }
    return { ok: true, protocol: body.protocol };
  } catch (e) {
    const msg = (e as Error).message || "Falha ao iniciar";
    sonnerToast.error(msg, { id: tId });
    return { ok: false, message: msg };
  }
}
