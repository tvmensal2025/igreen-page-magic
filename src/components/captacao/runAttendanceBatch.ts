// Fila operacional: inicia atendimento + envia áudio/imagem/texto/arquivo por lead, com delay.
// Também agenda o auto-fechamento do atendimento se `autoCloseAfterMin` for informado.
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
  /** Áudio extra (gravado na hora ou upload). */
  extraAudioUrl?: string | null;
  /** Arquivo genérico (imagem/documento/vídeo). */
  fileUrl?: string | null;
  fileType?: "image" | "video" | "document" | null;
  fileName?: string | null;
  /** Texto livre (suporta {{nome}}). Enviado após protocolo/mídia. */
  customText?: string | null;
  delayMs?: number;
  /** Se > 0: agenda auto-fechamento X minutos após o disparo (por lead). */
  autoCloseAfterMin?: number;
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
  opts?: { restart?: boolean },
): Promise<"sent" | "restarted" | "already" | { fallback: string }> {
  const restart = opts?.restart === true;
  const { data, error } = await supabase.functions.invoke("start-customer-attendance", {
    body: { customerId, consultantId, restart },
  });
  const body = (data ?? null) as {
    ok?: boolean;
    skipped?: string;
    message?: string;
    detail?: string;
    error?: string;
    fallback?: boolean;
  } | null;

  if (error && !body) throw new Error(errorMessage(error, "Falha no protocolo"));
  if (body?.ok === false) {
    if (body.skipped === "already_sent") return "already";
    // Erros "soft" que a edge marca como fallback: não tratamos como falha hard;
    // devolvemos um status leve para o loop marcar como "skipped" com aviso.
    if (body.fallback) {
      return { fallback: body.message || body.detail || body.error || "envio manual" };
    }
    throw new Error(body.message || body.detail || body.error || "Falha no protocolo");
  }
  if (body?.skipped === "already_sent") return "already";
  return restart ? "restarted" : "sent";
}

async function scheduleAutoClose(customerId: string, minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  const at = new Date(Date.now() + minutes * 60_000).toISOString();
  await supabase
    .from("customers")
    .update({
      attendance_auto_close_at: at,
      attendance_auto_close_source: "batch",
    })
    .eq("id", customerId);
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
    extraAudioUrl,
    fileUrl,
    fileType,
    fileName,
    customText,
    delayMs = 5000,
    autoCloseAfterMin = 0,
    signal,
    onProgress,
  } = opts;

  const queue = leads.map((l) => ({ ...l }));
  const results: BatchLeadResult[] = queue.map((l) => ({ id: l.id, status: "pending" as const }));
  const emit = () => onProgress?.(results.map((r) => ({ ...r })));

  const assertNotAborted = () => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  };

  const hasCustomText = !!(customText && customText.trim());
  const needsChannel = !!(audioUrl || imageUrl || extraAudioUrl || fileUrl || hasCustomText);

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

    // Minha página = só meus leads. Nunca abre atendimento de outro consultor no lote.
    try {
      const { data: ownerRow } = await supabase
        .from("customers")
        .select("consultant_id")
        .eq("id", lead.id)
        .maybeSingle();
      const ownerId = String((ownerRow as { consultant_id?: string } | null)?.consultant_id || "");
      if (ownerId && ownerId !== consultantId) {
        results[i] = { id: lead.id, status: "failed", detail: "Lead de outro consultor" };
        emit();
        continue;
      }
    } catch {
      // fail-open só se a checagem quebrar — a edge ainda bloqueia forbidden
    }

    if (needsChannel && !instanceName) {
      results[i] = { id: lead.id, status: "failed", detail: "WhatsApp desconectado" };
      emit();
      continue;
    }

    const phone = String(lead.phone_whatsapp);
    const parts: string[] = [];
    let failed = false;
    let anythingSent = false;

    try {
      assertNotAborted();

      if (startAttendance) {
        // Já iniciado e sem resposta: encerra a ficha silenciosamente (sem pesquisa)
        // via restart e abre um atendimento novo.
        const restart = !!lead.welcome_sent_at;
        const outcome = await startAttendanceForLead(lead.id, consultantId, { restart });
        assertNotAborted();
        if (outcome === "already") {
          parts.push("já iniciado");
          lead.welcome_sent_at = lead.welcome_sent_at || new Date().toISOString();
        } else if (typeof outcome === "object" && "fallback" in outcome) {
          // Envio automático não rolou (canal/rate/etc). Marca skipped legível
          // em vez de "Falhou" e pula os próximos envios deste lead.
          results[i] = { id: lead.id, status: "skipped", detail: `Envie manualmente: ${outcome.fallback}` };
          emit();
          continue;
        } else if (outcome === "restarted") {
          parts.push("reaberto");
          lead.welcome_sent_at = new Date().toISOString();
          anythingSent = true;
        } else {
          parts.push("protocolo");
          lead.welcome_sent_at = new Date().toISOString();
          anythingSent = true;
        }
      }

      if (audioUrl) {
        assertNotAborted();
        const r = await sendWhatsAppMessage({
          instanceName, phone, mediaCategory: "audio",
          mediaUrl: audioUrl, isWhapi, customerId: lead.id,
        });
        if (r.status === "failed") throw new Error(r.error || "Falha no áudio");
        parts.push(r.status === "pending" || r.status === "timeout" ? "áudio (fila)" : "áudio");
        anythingSent = true;
      }

      if (extraAudioUrl && extraAudioUrl !== audioUrl) {
        assertNotAborted();
        const r = await sendWhatsAppMessage({
          instanceName, phone, mediaCategory: "audio",
          mediaUrl: extraAudioUrl, isWhapi, customerId: lead.id,
        });
        if (r.status === "failed") throw new Error(r.error || "Falha no áudio gravado");
        parts.push(r.status === "pending" || r.status === "timeout" ? "áudio (fila)" : "áudio gravado");
        anythingSent = true;
      }

      if (imageUrl) {
        assertNotAborted();
        const r = await sendWhatsAppMessage({
          instanceName, phone, mediaCategory: "image",
          mediaUrl: imageUrl, isWhapi, customerId: lead.id,
        });
        if (r.status === "failed") throw new Error(r.error || "Falha na imagem");
        parts.push(r.status === "pending" || r.status === "timeout" ? "imagem (fila)" : "imagem");
        anythingSent = true;
      }

      if (fileUrl) {
        assertNotAborted();
        const cat = fileType || "document";
        const r = await sendWhatsAppMessage({
          instanceName, phone, mediaCategory: cat,
          mediaUrl: fileUrl,
          fileName: cat === "document" ? (fileName || fileUrl.split("/").pop() || "documento") : undefined,
          isWhapi, customerId: lead.id,
        });
        if (r.status === "failed") throw new Error(r.error || "Falha no arquivo");
        parts.push(r.status === "pending" || r.status === "timeout" ? "arquivo (fila)" : "arquivo");
        anythingSent = true;
      }

      if (hasCustomText) {
        assertNotAborted();
        const firstName = (lead.name || "").trim().split(/\s+/)[0] || "";
        const rendered = customText!
          .split("{{nome}}").join(firstName || "tudo bem")
          .split("{{name}}").join(firstName || "tudo bem");
        const r = await sendWhatsAppMessage({
          instanceName, phone, mediaCategory: "text",
          text: rendered, isWhapi, customerId: lead.id,
        });
        if (r.status === "failed") throw new Error(r.error || "Falha no texto");
        parts.push(r.status === "pending" || r.status === "timeout" ? "texto (fila)" : "texto");
        anythingSent = true;
      }

      if (parts.length === 0) {
        results[i] = { id: lead.id, status: "skipped", detail: "Nada a enviar" };
      } else {
        results[i] = { id: lead.id, status: "ok", detail: parts.join(" · ") };
        // Auto-close só se algo foi realmente enviado.
        if (autoCloseAfterMin > 0 && anythingSent) {
          try {
            await scheduleAutoClose(lead.id, autoCloseAfterMin);
            results[i].detail = `${results[i].detail} · auto-fechar ${autoCloseAfterMin}min`;
          } catch (e) {
            console.warn("[batch] auto-close schedule fail", lead.id, e);
          }
        }
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
