import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  Loader2,
  LogOut,
  Square,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  hasValidBatchPhone,
  type BatchLeadTarget,
} from "@/components/captacao/runAttendanceBatch";

type CloseStatus = "pending" | "running" | "ok" | "skipped" | "failed" | "queued_stop";

interface CloseLeadResult {
  id: string;
  status: CloseStatus;
  detail?: string;
  errorCode?: string;
}

interface EndBody {
  ok?: boolean;
  skipped?: string;
  fixHint?: string;
  message?: string;
  detail?: string;
  error?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consultantId: string;
  leads: BatchLeadTarget[];
  delaySec?: number;
  onFinished?: () => void;
}

/** Só estes param o lote de imediato (canal realmente fora). */
const HARD_CHANNEL_STOP = new Set([
  "channel_unavailable",
  "rate_limit",
  "whapi_token",
  "evolution_instance",
]);

/**
 * O que TRAVA o lote:
 * - Cada finalização manda 2 msgs; fila Whapi ~18s entre envios (até ~25s/slot).
 * - Sem timeout no client, a UI fica em "Enviando…" 40–70s+ sem feedback.
 * Mitigação: timeout por lead + pausa anti-ban com countdown + timer de envio.
 */
const INVOKE_TIMEOUT_MS = 55_000;
const DEFAULT_PAUSE_SEC = 12;
const ETA_SEC_PER_LEAD = 40;

function humanizeCloseFailure(body: EndBody): string {
  const msg = (body.message || "").trim();
  const detail = (body.detail || "").trim();
  const code = (body.error || "").trim();
  if (msg) return msg;
  if (detail) {
    const map: Record<string, string> = {
      whapi_send_returned_false: "WhatsApp recusou o envio para este número",
      evolution_send_returned_false: "WhatsApp recusou o envio para este número",
      whapi_token_missing: "Token WhatsApp ausente",
    };
    return map[detail] || detail;
  }
  const codeMap: Record<string, string> = {
    attendance_not_started: "Atendimento não iniciado neste lead",
    no_phone: "Telefone inválido",
    channel_unavailable: "Canal WhatsApp indisponível",
    send_failed_closing: "Falha ao enviar encerramento",
    send_failed_rating: "Falha ao enviar pesquisa",
    rate_limited: "Limite de envio (anti-ban)",
    customer_not_found: "Cliente não encontrado",
    unauthorized: "Sessão expirada — faça login de novo",
    forbidden: "Sem permissão neste cliente",
  };
  if (code && codeMap[code]) return codeMap[code];
  if (code) return `Erro: ${code}`;
  return "Falha desconhecida ao finalizar";
}

function isPerLeadRefuse(detail: string): boolean {
  return /whapi_send_returned_false|evolution_send_returned_false/i.test(detail);
}

function isTransientNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || "");
  return /failed to fetch|network|timeout|abort|546|502|503|504|fetch/i.test(msg);
}

async function readInvokeErrorBody(error: unknown): Promise<EndBody | null> {
  try {
    const ctx = (error as { context?: Response })?.context;
    if (ctx && typeof ctx.json === "function") {
      return (await ctx.json()) as EndBody;
    }
  } catch {
    /* ignore */
  }
  return null;
}

const AVATAR_TONES = [
  "bg-primary/15 text-primary",
  "bg-info/15 text-info",
  "bg-warning/15 text-warning",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
];

function toneFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

function initialsFrom(name: string | null, phone: string | null) {
  const src = (name || "").trim();
  if (src) {
    const parts = src.split(/\s+/);
    return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
  }
  return (phone || "?").replace(/\D/g, "").slice(-2) || "?";
}

function formatPhone(phone: string | null): string {
  const d = (phone || "").replace(/\D/g, "");
  if (d.length >= 12) {
    const local = d.slice(-11);
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone || "—";
}

function statusPill(result?: CloseLeadResult) {
  if (!result || result.status === "pending") {
    return (
      <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
        Na fila
      </span>
    );
  }
  if (result.status === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
        <Loader2 className="w-3 h-3 animate-spin" /> Enviando
      </span>
    );
  }
  if (result.status === "ok") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
        <CheckCircle2 className="w-3 h-3" /> Fechado
      </span>
    );
  }
  if (result.status === "failed") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded-full max-w-[9.5rem] truncate"
        title={result.detail}
      >
        <XCircle className="w-3 h-3 shrink-0" /> Falhou
      </span>
    );
  }
  if (result.status === "queued_stop") {
    return (
      <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
        Não enviado
      </span>
    );
  }
  return (
    <span
      className="text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full"
      title={result.detail}
    >
      {result.detail || "Pulado"}
    </span>
  );
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });

export function CloseAttendanceBatchDialog({
  open,
  onOpenChange,
  consultantId,
  leads,
  delaySec = DEFAULT_PAUSE_SEC,
  onFinished,
}: Props) {
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [results, setResults] = useState<CloseLeadResult[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [stoppedEarly, setStoppedEarly] = useState<string | null>(null);
  /** "sending" | "pausing" — evita parecer travado. */
  const [phase, setPhase] = useState<"idle" | "sending" | "pausing">("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [pauseLeftSec, setPauseLeftSec] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const userStopRef = useRef(false);
  /** Garante 1 boot por abertura — evita Strict Mode / remount matar o lote. */
  const bootedRef = useRef(false);
  const leadsRef = useRef(leads);
  const onFinishedRef = useRef(onFinished);
  const listRef = useRef<HTMLUListElement | null>(null);

  leadsRef.current = leads;
  onFinishedRef.current = onFinished;

  const resultById = useMemo(() => {
    const m = new Map<string, CloseLeadResult>();
    for (const r of results) m.set(r.id, r);
    return m;
  }, [results]);

  const withPhone = useMemo(
    () => leads.filter((l) => hasValidBatchPhone(l.phone_whatsapp)),
    [leads],
  );
  const withoutPhone = leads.length - withPhone.length;

  const okCount = results.filter((r) => r.status === "ok").length;
  const skippedCount = results.filter((r) => r.status === "skipped" || r.status === "queued_stop").length;
  const failedCount = results.filter((r) => r.status === "failed").length;
  const failureSummary = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of results) {
      if (r.status !== "failed" || !r.detail) continue;
      map.set(r.detail, (map.get(r.detail) || 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [results]);
  const totalWork = withPhone.length;
  const workDone = results.filter(
    (r) =>
      withPhone.some((l) => l.id === r.id) &&
      (r.status === "ok" || r.status === "skipped" || r.status === "failed" || r.status === "queued_stop"),
  ).length;
  const workPct =
    totalWork > 0
      ? Math.round((workDone / totalWork) * 100)
      : finished
        ? 100
        : 0;

  const currentLead = currentId ? leads.find((l) => l.id === currentId) : null;
  const etaMinLeft = useMemo(() => {
    if (!running || totalWork === 0) return null;
    const remaining = Math.max(0, totalWork - workDone);
    return Math.ceil((remaining * ETA_SEC_PER_LEAD) / 60);
  }, [running, totalWork, workDone]);

  useEffect(() => {
    if (!currentId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-lead-id="${currentId}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentId]);

  const patchResult = (id: string, patch: Partial<CloseLeadResult>, snapshot: BatchLeadTarget[]) => {
    setResults((prev) => {
      const map = new Map(prev.map((r) => [r.id, r]));
      const cur = map.get(id) ?? { id, status: "pending" as const };
      map.set(id, { ...cur, ...patch, id });
      return snapshot.map((l) => map.get(l.id) ?? { id: l.id, status: "pending" as const });
    });
  };

  const invokeEndWithRetry = async (
    leadId: string,
    signal: AbortSignal,
  ): Promise<EndBody> => {
    const invokeOnce = async (): Promise<EndBody> => {
      const { data, error } = await supabase.functions.invoke("end-customer-attendance", {
        body: { customerId: leadId, consultantId },
      });
      if (error && !data) {
        const fromCtx = await readInvokeErrorBody(error);
        if (fromCtx) return fromCtx;
        throw error instanceof Error ? error : new Error(String(error));
      }
      return (data ?? {}) as EndBody;
    };

    const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        const timer = setTimeout(() => {
          reject(new Error(`Timeout ${Math.round(ms / 1000)}s — fila de envio demorou demais; pulando este lead`));
        }, ms);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        p.then(
          (v) => {
            clearTimeout(timer);
            signal.removeEventListener("abort", onAbort);
            resolve(v);
          },
          (e) => {
            clearTimeout(timer);
            signal.removeEventListener("abort", onAbort);
            reject(e);
          },
        );
      });

    try {
      return await withTimeout(invokeOnce(), INVOKE_TIMEOUT_MS);
    } catch (e) {
      if (signal.aborted) throw e;
      // Timeout: NÃO dispara 2º envio cego (pode duplicar se o 1º ainda corre).
      // Só confirma 1x após espera — server é idempotente.
      if (e instanceof Error && /timeout/i.test(e.message)) {
        await sleep(3000, signal);
        if (signal.aborted) throw e;
        try {
          const verify = await withTimeout(invokeOnce(), 20_000);
          if (verify.ok !== false) return verify;
          // Já enviado / pendente conta como ok operacional
          if (verify.skipped === "rating_pending" || verify.skipped === "already_rated") {
            return { ok: true, skipped: verify.skipped };
          }
          return verify;
        } catch {
          throw e;
        }
      }
      // Rede pura: 1 retry curto
      if (isTransientNetworkError(e)) {
        await sleep(2000, signal);
        return await withTimeout(invokeOnce(), INVOKE_TIMEOUT_MS);
      }
      throw e;
    }
  };

  /** Pausa anti-ban com countdown visível (não trava a UI). */
  const pauseBetweenLeads = async (sec: number, signal: AbortSignal) => {
    setPhase("pausing");
    for (let left = sec; left > 0; left--) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      setPauseLeftSec(left);
      await sleep(1000, signal);
    }
    setPauseLeftSec(0);
  };

  const runBatch = async () => {
    const snapshot = leadsRef.current;
    const phoneLeads = snapshot.filter((l) => hasValidBatchPhone(l.phone_whatsapp));
    const noPhoneCount = snapshot.length - phoneLeads.length;

    const ac = new AbortController();
    abortRef.current = ac;
    const runId = ++runIdRef.current;
    userStopRef.current = false;

    setRunning(true);
    setFinished(false);
    setStoppedEarly(null);
    setCurrentId(null);
    setPhase("idle");
    setElapsedSec(0);
    setPauseLeftSec(0);
    setResults(
      snapshot.map((l) => ({
        id: l.id,
        status: hasValidBatchPhone(l.phone_whatsapp) ? ("pending" as const) : ("skipped" as const),
        detail: hasValidBatchPhone(l.phone_whatsapp) ? undefined : "Sem telefone",
      })),
    );

    let ok = 0;
    let skipped = noPhoneCount;
    let failed = 0;
    let early: string | null = null;
    let softChannelStreak = 0;
    const doneIds = new Set<string>(); // anti-dupe no mesmo lote

    try {
      const noPhoneIds = snapshot
        .filter((l) => !hasValidBatchPhone(l.phone_whatsapp))
        .map((l) => l.id);
      if (noPhoneIds.length > 0) {
        const now = new Date().toISOString();
        await supabase
          .from("customers")
          .update({ attendance_ended_at: now })
          .in("id", noPhoneIds)
          .eq("consultant_id", consultantId);
      }

      for (let i = 0; i < phoneLeads.length; i++) {
        if (ac.signal.aborted) break;
        if (runId !== runIdRef.current) return;

        const lead = phoneLeads[i];
        if (doneIds.has(lead.id)) continue;
        doneIds.add(lead.id);
        setCurrentId(lead.id);
        setPhase("sending");
        setElapsedSec(0);
        setPauseLeftSec(0);
        patchResult(lead.id, { status: "running", detail: "Encerramento + pesquisa (fila WhatsApp)" }, snapshot);

        const tick = window.setInterval(() => {
          setElapsedSec((s) => s + 1);
        }, 1000);

        try {
          const body = await invokeEndWithRetry(lead.id, ac.signal);

          if (ac.signal.aborted) break;
          if (runId !== runIdRef.current) return;

          if (body.ok === false) {
            const hint = body.fixHint || "";
            const reason = humanizeCloseFailure(body);
            const detailRaw = String(body.detail || "");
            const perLead = isPerLeadRefuse(detailRaw) || hint === "retry" || hint === "phone" || hint === "start_first";

            failed++;
            patchResult(lead.id, {
              status: "failed",
              detail: reason,
              errorCode: body.error || hint || undefined,
            }, snapshot);

            if (HARD_CHANNEL_STOP.has(hint)) {
              early = reason;
              for (let j = i + 1; j < phoneLeads.length; j++) {
                patchResult(phoneLeads[j].id, {
                  status: "queued_stop",
                  detail: `Parado: ${reason}`,
                }, snapshot);
              }
              skipped += phoneLeads.length - i - 1;
              break;
            }

            if (hint === "instance_offline" && !perLead) {
              softChannelStreak++;
              if (softChannelStreak >= 3) {
                early = `${reason} (3 falhas seguidas de canal)`;
                for (let j = i + 1; j < phoneLeads.length; j++) {
                  patchResult(phoneLeads[j].id, {
                    status: "queued_stop",
                    detail: `Parado: ${early}`,
                  }, snapshot);
                }
                skipped += phoneLeads.length - i - 1;
                break;
              }
            } else {
              softChannelStreak = 0;
            }
          } else if (body.skipped === "already_rated" || body.skipped === "rating_pending") {
            softChannelStreak = 0;
            ok++;
            const label =
              body.skipped === "already_rated" ? "Já avaliado" : "Pesquisa já enviada";
            patchResult(lead.id, { status: "ok", detail: label }, snapshot);
          } else if (body.skipped === "do_not_contact") {
            softChannelStreak = 0;
            skipped++;
            patchResult(lead.id, { status: "skipped", detail: "Bloqueado — nunca mais contatar" }, snapshot);
          } else {
            softChannelStreak = 0;
            ok++;
            patchResult(lead.id, { status: "ok", detail: "Encerrado + pesquisa enviada" }, snapshot);
          }
        } catch (e) {
          if (ac.signal.aborted) break;
          if (runId !== runIdRef.current) return;
          failed++;
          softChannelStreak = 0;
          const msg =
            e instanceof Error
              ? e.message || "Erro de rede ao chamar finalização"
              : String(e);
          patchResult(lead.id, { status: "failed", detail: msg }, snapshot);
          console.error("[captacao] closeBatch", lead.id, e);
        } finally {
          window.clearInterval(tick);
        }

        if (i < phoneLeads.length - 1 && !early && !ac.signal.aborted) {
          try {
            await pauseBetweenLeads(delaySec, ac.signal);
          } catch {
            break;
          }
        }
      }

      if (runId !== runIdRef.current) return;

      if (ac.signal.aborted && userStopRef.current && !early) {
        setResults((prev) =>
          prev.map((r) =>
            r.status === "pending" || r.status === "running"
              ? { ...r, status: "queued_stop" as const, detail: "Interrompido" }
              : r,
          ),
        );
        early = "Interrompido pelo consultor";
      }

      // Abort sem clique do usuário (não deveria acontecer) — não toasta
      if (ac.signal.aborted && !userStopRef.current && !early) return;

      setStoppedEarly(early);

      const parts = [
        ok > 0 ? `${ok} finalizado(s)` : null,
        skipped > 0 ? `${skipped} pulado(s)` : null,
        failed > 0 ? `${failed} falha(s)` : null,
      ].filter(Boolean);

      if (early) {
        toast.warning(`Lote parado: ${early}`, {
          description: parts.join(" · ") || undefined,
          duration: 10_000,
        });
      } else if (failed > 0 && ok === 0 && phoneLeads.length > 0) {
        toast.error("Nenhum atendimento finalizado", {
          description: parts.join(" · "),
          duration: 10_000,
        });
      } else if (failed > 0) {
        toast.warning("Lote concluído com falhas pontuais", {
          description: parts.join(" · ") + " — o restante foi processado.",
          duration: 10_000,
        });
      } else if (phoneLeads.length === 0) {
        toast.success("Atendimentos fechados (sem WhatsApp — sem telefone)");
      } else {
        toast.success("Lote de finalização concluído", { description: parts.join(" · ") });
      }
    } catch (e) {
      if (runId !== runIdRef.current) return;
      if (ac.signal.aborted && !userStopRef.current) return;
      toast.error("Erro ao finalizar atendimentos", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      if (runId === runIdRef.current) {
        setCurrentId(null);
        setRunning(false);
        setFinished(true);
        setPhase("idle");
        setElapsedSec(0);
        setPauseLeftSec(0);
        onFinishedRef.current?.();
      }
    }
  };

  // Boot único por abertura — sem abort no cleanup (Strict Mode / HMR não mata o lote)
  useEffect(() => {
    if (!open) {
      bootedRef.current = false;
      return;
    }
    if (leads.length === 0) return;
    if (bootedRef.current) return;
    bootedRef.current = true;
    void runBatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const stop = () => {
    userStopRef.current = true;
    abortRef.current?.abort();
  };

  const handleOpenChange = (o: boolean) => {
    if (running && !o) return;
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        hideCloseButton={running}
        className="max-w-lg max-h-[90dvh] flex flex-col gap-0 p-0 overflow-hidden"
        onPointerDownOutside={(e) => {
          if (running) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (running) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (running) e.preventDefault();
        }}
      >
        <DialogHeader className="px-5 pt-5 pb-3 shrink-0 space-y-1">
          <DialogTitle className="flex items-center gap-2">
            <LogOut className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            Finalizar atendimentos
          </DialogTitle>
          <DialogDescription>
            {leads.length} cliente{leads.length === 1 ? "" : "s"}
            {totalWork > 0
              ? ` · 1 a 1 · pausa ${delaySec}s · ~${Math.ceil((totalWork * ETA_SEC_PER_LEAD) / 60)} min`
              : ""}
            {withoutPhone > 0 ? ` · ${withoutPhone} sem telefone` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 space-y-3 shrink-0">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-semibold text-foreground">
                {running
                  ? phase === "pausing"
                    ? `Pausa anti-ban ${pauseLeftSec}s…`
                    : `Processando ${workDone}/${totalWork || leads.length}`
                  : finished
                    ? "Concluído"
                    : "Preparando…"}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {workPct}%
                {etaMinLeft != null && etaMinLeft > 0 ? ` · ~${etaMinLeft} min` : ""}
              </span>
            </div>
            <Progress value={workPct} className="h-2" />
          </div>

          {currentLead && running && phase === "sending" && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Enviando agora · {elapsedSec}s
                {elapsedSec >= 20 ? " (fila WhatsApp — normal)" : ""}
              </p>
              <p className="text-sm font-medium truncate sensitive-name mt-0.5">
                {currentLead.name || "Sem nome"}
              </p>
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {formatPhone(currentLead.phone_whatsapp)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Encerramento + pesquisa. Cada lead usa 2 msgs na fila (~18s cada).
                Timeout em {Math.round(INVOKE_TIMEOUT_MS / 1000)}s para não travar.
              </p>
            </div>
          )}

          {running && phase === "pausing" && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                Pausa anti-ban
              </p>
              <p className="text-sm font-medium mt-0.5 tabular-nums">
                Próximo envio em {pauseLeftSec}s…
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Espaço proposital para não saturar o WhatsApp nem parecer travado.
              </p>
            </div>
          )}

          {stoppedEarly && finished && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
              Parado cedo: {stoppedEarly}
            </div>
          )}

          {finished && failureSummary.length > 0 && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-destructive">
                Motivos das falhas
              </p>
              {failureSummary.map(([reason, n]) => (
                <p key={reason} className="text-[11px] text-destructive/90">
                  <span className="font-semibold tabular-nums">{n}×</span> {reason}
                </p>
              ))}
            </div>
          )}

          {(okCount > 0 || skippedCount > 0 || failedCount > 0) && (
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              {okCount > 0 && (
                <span className="rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 font-semibold">
                  {okCount} fechado{okCount === 1 ? "" : "s"}
                </span>
              )}
              {skippedCount > 0 && (
                <span className="rounded-full bg-muted text-muted-foreground px-2 py-0.5 font-semibold">
                  {skippedCount} pulado{skippedCount === 1 ? "" : "s"}
                </span>
              )}
              {failedCount > 0 && (
                <span className="rounded-full bg-destructive/10 text-destructive px-2 py-0.5 font-semibold">
                  {failedCount} falha{failedCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="px-5 flex-1 min-h-0 overflow-hidden py-3">
          <ul
            ref={listRef}
            className="rounded-lg border border-border divide-y divide-border/60 overflow-y-auto max-h-[min(42vh,320px)]"
          >
            {leads.map((l) => {
              const r = resultById.get(l.id);
              const isCurrent = l.id === currentId;
              return (
                <li
                  key={l.id}
                  data-lead-id={l.id}
                  className={`flex items-center gap-2.5 px-2.5 py-2 transition-colors ${
                    isCurrent ? "bg-amber-500/10" : ""
                  }`}
                >
                  <div
                    className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold ${toneFor(l.id)}`}
                  >
                    {initialsFrom(l.name, l.phone_whatsapp)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate sensitive-name">
                      {l.name || "Sem nome"}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate tabular-nums">
                      {formatPhone(l.phone_whatsapp)}
                    </p>
                    {r?.detail && r.status !== "running" && r.status !== "pending" && (
                      <p
                        className={`text-[10px] truncate mt-0.5 ${
                          r.status === "failed"
                            ? "text-destructive font-medium"
                            : r.status === "queued_stop"
                              ? "text-amber-700 dark:text-amber-400"
                              : "text-muted-foreground"
                        }`}
                        title={r.detail}
                      >
                        {r.detail}
                      </p>
                    )}
                  </div>
                  {statusPill(r)}
                </li>
              );
            })}
          </ul>
        </div>

        <DialogFooter className="px-5 py-4 border-t border-border shrink-0 gap-2 sm:gap-2">
          {running ? (
            <Button type="button" variant="destructive" size="sm" className="gap-1.5" onClick={stop}>
              <Square className="w-3.5 h-3.5" />
              Parar lote
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Fechar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
