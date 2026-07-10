// Fila operacional: inicia atendimento + envia áudio/imagem por lead, com delay.
import { supabase } from "@/integrations/supabase/client";
import { sendWhatsAppMessage } from "@/services/messageSender";

export type BatchLeadStatus = "pending" | "running" | "ok" | "skipped" | "failed";

export interface BatchLeadTarget {
  id: string;
  name: string | null;
  phone_whatsapp: string | null;
  welcome_sent_at: string | null;
}

export interface BatchLeadResult {
  id: string;
  status: BatchLeadStatus;
  detail?: string;
}

export interface RunAttendanceBatchOptions {
  consultantId: string;
  instanceName: string;
  isWhapi: boolean;
  leads: BatchLeadTarget[];
  startAttendance: boolean;
  audioUrl: string | null;
  imageUrl: string | null;
  /** Texto livre (suporta {{nome}}). Enviado após protocolo/áudio/imagem. */
  customText?: string | null;
  delayMs?: number;
  signal?: AbortSignal;
  onProgress?: (results: BatchLeadResult[]) => void;
}


const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => resolve(), ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

export function hasValidBatchPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  if (/sem_celular/i.test(phone)) return false;
  return phone.replace(/\D/g, "").length >= 10;
}

function isAbortError(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as Error).name === "AbortError";
}

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e.trim()) return e;
  return fallback;
}

function markRestSkipped(results: BatchLeadResult[], fromIndex: number) {
  for (let j = fromIndex; j < results.length; j++) {
    if (results[j].status === "pending" || results[j].status === "running") {
      results[j] = { id: results[j].id, status: "skipped", detail: "Parado" };
    }
  }
}

async function startAttendanceForLead(
  customerId: string,
  consultantId: string,
): Promise<"sent" | "already"> {
  const { data, error } = await supabase.functions.invoke("start-customer-attendance", {
    body: { customerId, consultantId },
  });
  const body = (data ?? null) as {
    ok?: boolean;
    skipped?: string;
    message?: string;
    detail?: string;
    error?: string;
  } | null;

  // Edge devolve 200 com ok:false em falhas soft; só explode se não houver body útil.
  if (error && !body) throw new Error(errorMessage(error, "Falha no protocolo"));
  if (body?.ok === false && body.skipped !== "already_sent") {
    throw new Error(body.message || body.detail || body.error || "Falha no protocolo");
  }
  if (body?.skipped === "already_sent") return "already";
  return "sent";
}

export async function runAttendanceBatch(opts: RunAttendanceBatchOptions): Promise<BatchLeadResult[]> {
  const {
    consultantId,
    instanceName,
    isWhapi,
    leads,
    startAttendance,
    audioUrl,
    imageUrl,
    customText,
    delayMs = 5000,
    signal,
    onProgress,
  } = opts;


  // Cópia local — nunca mutar o array/objetos do caller (retry / React state).
  const queue = leads.map((l) => ({ ...l }));
  const results: BatchLeadResult[] = queue.map((l) => ({ id: l.id, status: "pending" as const }));
  const emit = () => onProgress?.(results.map((r) => ({ ...r })));

  const assertNotAborted = () => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  };

  for (let i = 0; i < queue.length; i++) {
    if (signal?.aborted) {
      markRestSkipped(results, i);
      emit();
      break;
    }

    const lead = queue[i];
    results[i] = { id: lead.id, status: "running" };
    emit();

    if (!hasValidBatchPhone(lead.phone_whatsapp)) {
      results[i] = { id: lead.id, status: "failed", detail: "Sem telefone" };
      emit();
      continue;
    }

    if ((audioUrl || imageUrl) && !instanceName) {
      results[i] = { id: lead.id, status: "failed", detail: "WhatsApp desconectado" };
      emit();
      continue;
    }

    const phone = String(lead.phone_whatsapp);
    const parts: string[] = [];
    let failed = false;
    let onlySkippedProtocol = false;

    try {
      assertNotAborted();

      if (startAttendance && !lead.welcome_sent_at) {
        const outcome = await startAttendanceForLead(lead.id, consultantId);
        assertNotAborted();
        if (outcome === "already") {
          parts.push("já iniciado");
          lead.welcome_sent_at = lead.welcome_sent_at || new Date().toISOString();
        } else {
          parts.push("protocolo");
          lead.welcome_sent_at = new Date().toISOString();
        }
      } else if (startAttendance && lead.welcome_sent_at) {
        onlySkippedProtocol = true;
        parts.push("protocolo pulado");
      }

      if (audioUrl) {
        assertNotAborted();
        const r = await sendWhatsAppMessage({
          instanceName,
          phone,
          mediaCategory: "audio",
          mediaUrl: audioUrl,
          isWhapi,
          customerId: lead.id,
        });
        if (r.status === "failed") throw new Error(r.error || "Falha no áudio");
        parts.push(r.status === "pending" || r.status === "timeout" ? "áudio (fila)" : "áudio");
      }

      if (imageUrl) {
        assertNotAborted();
        const r = await sendWhatsAppMessage({
          instanceName,
          phone,
          mediaCategory: "image",
          mediaUrl: imageUrl,
          isWhapi,
          customerId: lead.id,
        });
        if (r.status === "failed") throw new Error(r.error || "Falha na imagem");
        parts.push(r.status === "pending" || r.status === "timeout" ? "imagem (fila)" : "imagem");
      }

      if (parts.length === 0) {
        results[i] = { id: lead.id, status: "skipped", detail: "Nada a enviar" };
      } else if (onlySkippedProtocol && parts.length === 1 && !audioUrl && !imageUrl) {
        // Só "já tinha protocolo" e sem mídia → não conta como sucesso novo.
        results[i] = { id: lead.id, status: "skipped", detail: "Já iniciado" };
      } else {
        results[i] = { id: lead.id, status: "ok", detail: parts.join(" · ") };
      }
    } catch (e) {
      failed = true;
      if (isAbortError(e)) {
        results[i] = { id: lead.id, status: "skipped", detail: "Parado" };
        markRestSkipped(results, i + 1);
        emit();
        break;
      }
      results[i] = { id: lead.id, status: "failed", detail: errorMessage(e, "Erro") };
    }

    emit();

    const hasMore = i < queue.length - 1;
    if (!hasMore || signal?.aborted) continue;

    try {
      await sleep(failed ? Math.min(delayMs, 2000) : delayMs, signal);
    } catch {
      markRestSkipped(results, i + 1);
      emit();
      break;
    }
  }

  return results;
}
