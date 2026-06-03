import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { Megaphone, Send, Loader2, Pause, Play, X, CheckCircle2, XCircle, ArrowRight, ArrowLeft, Download, RotateCw, AlertTriangle, Users, MessageSquare, Settings2, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ContactImporter } from "../ContactImporter";
import { sendWhatsAppMessage } from "@/services/messageSender";
import { getConnectionState } from "@/services/evolutionApi";
import type { BulkContact, MessageTemplate } from "@/types/whatsapp";
import { MessageEditor } from "./MessageEditor";
import { ScheduleStep } from "./ScheduleStep";
import { DEFAULT_CONFIG, type SendConfig, type PreparedMedia, type CampaignTarget } from "./types";
import { renderFinal } from "./spintax";
import { createCampaign, updateCampaignStatus, updateTargetStatus, listCampaigns, deleteCampaign, type PersistedCampaignRow } from "./useCampaignPersistence";

interface Customer {
  id: string; name: string; phone_whatsapp: string; electricity_bill_value?: number;
  status?: string; devolutiva?: string | null; registered_by_name?: string | null;
  last_inbound_at?: string | null;
}

interface Props {
  instanceName: string;
  customers: Customer[];
  templates: MessageTemplate[];
  consultantId: string;
}

type Step = 1 | 2 | 3 | 4;

const STEPS: { n: Step; label: string; icon: any }[] = [
  { n: 1, label: "Contatos", icon: Users },
  { n: 2, label: "Mensagem", icon: MessageSquare },
  { n: 3, label: "Envio", icon: Settings2 },
  { n: 4, label: "Acompanhar", icon: Activity },
];

function isValidPhone(p: string): boolean {
  if (!p) return false;
  if (/sem_celular/i.test(p)) return false;
  return p.replace(/\D/g, "").length >= 10;
}

function normalizePhone(p: string): string { return p.replace(/\D/g, ""); }

function dedupe(list: BulkContact[]): { unique: BulkContact[]; removed: number } {
  const seen = new Set<string>();
  const out: BulkContact[] = [];
  let removed = 0;
  for (const c of list) {
    const k = normalizePhone(c.phone);
    if (seen.has(k)) { removed++; continue; }
    seen.add(k); out.push(c);
  }
  return { unique: out, removed };
}

function inWindow(cfg: SendConfig, now = new Date()): boolean {
  if (cfg.weekdaysOnly) {
    const d = now.getDay();
    if (d === 0 || d === 6) return false;
  }
  const [sH, sM] = cfg.windowStart.split(":").map(Number);
  const [eH, eM] = cfg.windowEnd.split(":").map(Number);
  const start = sH * 60 + sM;
  const end = eH * 60 + eM;
  const cur = now.getHours() * 60 + now.getMinutes();
  // Overnight window (e.g. 22:00 → 06:00)
  if (end < start) return cur >= start || cur <= end;
  return cur >= start && cur <= end;
}

function downloadCsv(rows: CampaignTarget[]) {
  const head = ["telefone", "nome", "status", "erro", "mensagem", "enviado_em"];
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = rows.map(r => [
    r.phone, r.name, r.status, r.error || "",
    (r.finalMessage || "").replace(/\n/g, " ").slice(0, 500),
    r.sentAt ? new Date(r.sentAt).toISOString() : "",
  ].map(esc).join(",")).join("\n");
  const csv = head.join(",") + "\n" + body;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `disparo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function BulkProPanel({ instanceName, customers, templates, consultantId }: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>(1);
  const [contacts, setContacts] = useState<BulkContact[]>([]);
  const [text, setText] = useState("");
  const [media, setMedia] = useState<PreparedMedia | null>(null);
  const [config, setConfig] = useState<SendConfig>(DEFAULT_CONFIG);

  // Live last-inbound enrichment (kept from original panel for ContactImporter compatibility)
  const [lastInboundMap, setLastInboundMap] = useState<Map<string, string | null>>(new Map());
  useEffect(() => {
    let cancelled = false;
    const ids = customers.map(c => c.id).filter(Boolean);
    if (ids.length === 0) { setLastInboundMap(new Map()); return; }
    (async () => {
      const map = new Map<string, string | null>();
      const CHUNK = 500;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { data, error } = await (supabase as any)
          .from("customer_flow_state").select("customer_id,last_inbound_at").in("customer_id", slice);
        if (error) continue;
        for (const row of (data as any[]) || []) map.set(String(row.customer_id), row.last_inbound_at ?? null);
        if (cancelled) return;
      }
      if (!cancelled) setLastInboundMap(map);
    })();
    return () => { cancelled = true; };
  }, [customers]);

  const enrichedCustomers = useMemo<Customer[]>(
    () => customers.map(c => ({ ...c, last_inbound_at: lastInboundMap.get(c.id) ?? null })),
    [customers, lastInboundMap],
  );

  const validContacts = useMemo(() => contacts.filter(c => isValidPhone(c.phone)), [contacts]);
  const { unique: deduped, removed: dupCount } = useMemo(() => dedupe(validContacts), [validContacts]);

  // ── Runtime state ──
  const [targets, setTargets] = useState<CampaignTarget[]>([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [done, setDone] = useState(false);
  const [waitingSchedule, setWaitingSchedule] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const pausedRef = useRef(false);
  const [filterStatus, setFilterStatus] = useState<"all" | "sent" | "failed">("all");

  const stats = useMemo(() => {
    const sent = targets.filter(t => t.status === "sent").length;
    const failed = targets.filter(t => t.status === "failed").length;
    const queued = targets.filter(t => t.status === "queued").length;
    return { sent, failed, queued, total: targets.length };
  }, [targets]);

  const sleep = useCallback((ms: number) => new Promise<boolean>(resolve => {
    let elapsed = 0;
    const it = setInterval(() => {
      if (cancelledRef.current) { clearInterval(it); resolve(false); return; }
      if (pausedRef.current) return;
      elapsed += 250;
      if (elapsed >= ms) { clearInterval(it); resolve(true); }
    }, 250);
  }), []);

  const checkConnection = useCallback(async () => {
    try {
      const r = await getConnectionState(instanceName);
      return (r?.state || "close") === "open";
    } catch { return false; }
  }, [instanceName]);

  const runCampaign = useCallback(async (initialTargets: CampaignTarget[]) => {
    cancelledRef.current = false;
    pausedRef.current = false;
    setPaused(false);
    setRunning(true);
    setDone(false);
    setTargets(initialTargets);
    setStep(4);

    // Wait for schedule (treat scheduleAt as LOCAL time)
    if (config.scheduleAt) {
      // datetime-local format "YYYY-MM-DDTHH:mm" is parsed as local by Date()
      const target = new Date(config.scheduleAt).getTime();
      if (!isNaN(target) && target > Date.now()) {
        setWaitingSchedule(config.scheduleAt);
        while (Date.now() < target && !cancelledRef.current) {
          await new Promise(r => setTimeout(r, 1000));
        }
        setWaitingSchedule(null);
        if (cancelledRef.current) { setRunning(false); setDone(true); return; }
      }
    }

    let consecutiveFailures = 0;
    const work = [...initialTargets];

    for (let idx = 0; idx < work.length; idx++) {
      if (cancelledRef.current) break;

      // Window check
      while (!inWindow(config) && !cancelledRef.current) {
        await new Promise(r => setTimeout(r, 30_000));
      }
      if (cancelledRef.current) break;

      // Pause check
      while (pausedRef.current && !cancelledRef.current) await new Promise(r => setTimeout(r, 500));
      if (cancelledRef.current) break;

      // Connection check at block boundary
      if (idx % config.blockSize === 0 && idx > 0) {
        const ok = await checkConnection();
        if (!ok) {
          toast({ title: "WhatsApp desconectado", description: "Envio pausado. Reconecte e clique em Retomar.", variant: "destructive" });
          pausedRef.current = true; setPaused(true);
          while (pausedRef.current && !cancelledRef.current) await new Promise(r => setTimeout(r, 1000));
          if (cancelledRef.current) break;
        }
        // Block pause
        const pauseMs = config.blockPauseMin * 60_000;
        const ok2 = await sleep(pauseMs);
        if (!ok2) break;
      }

      const t = work[idx];
      setTargets(prev => prev.map(x => x.id === t.id ? { ...x, status: "sending" } : x));

      const finalMsg = renderFinal(text, { name: t.name, bill: t.bill, city: t.city });

      let ok = true;
      let err: string | undefined;
      try {
        if (media) {
          // Send media first or text first
          if (config.mediaOrder === "text_first" && finalMsg.trim()) {
            const r = await sendWhatsAppMessage({ instanceName, phone: t.phone, mediaCategory: "text", text: finalMsg });
            if (r.status === "failed") { ok = false; err = r.error; }
            await new Promise(r2 => setTimeout(r2, 1500 + Math.random() * 1500));
          }
          const cat = media.kind === "image" ? "image" : media.kind === "video" ? "video" : media.kind === "audio" ? "audio" : "document";
          const caption = config.mediaOrder === "caption_only" || config.mediaOrder === "media_first" ? finalMsg : undefined;
          const r = await sendWhatsAppMessage({
            instanceName, phone: t.phone, mediaCategory: cat as any,
            mediaUrl: media.url,
            text: cat === "image" || cat === "video" ? caption : undefined,
            fileName: media.fileName,
          });
          if (r.status === "failed") { ok = false; err = r.error || err; }
          if (config.mediaOrder === "media_first" && finalMsg.trim() && media.kind !== "image" && media.kind !== "video") {
            await new Promise(r2 => setTimeout(r2, 1500 + Math.random() * 1500));
            const r2 = await sendWhatsAppMessage({ instanceName, phone: t.phone, mediaCategory: "text", text: finalMsg });
            if (r2.status === "failed") { ok = false; err = r2.error || err; }
          }
        } else {
          if (!finalMsg.trim()) { ok = false; err = "Mensagem vazia"; }
          else {
            const r = await sendWhatsAppMessage({ instanceName, phone: t.phone, mediaCategory: "text", text: finalMsg });
            if (r.status === "failed") { ok = false; err = r.error; }
          }
        }
      } catch (e: any) {
        ok = false; err = e?.message || "Erro desconhecido";
      }

      setTargets(prev => prev.map(x => x.id === t.id ? {
        ...x, status: ok ? "sent" : "failed", error: err, finalMessage: finalMsg, sentAt: Date.now(),
      } : x));

      if (ok) consecutiveFailures = 0;
      else consecutiveFailures++;

      // Circuit breaker
      if (consecutiveFailures >= 5) {
        toast({ title: "5 falhas seguidas", description: "Envio pausado. Verifique a conexão.", variant: "destructive" });
        pausedRef.current = true; setPaused(true);
        while (pausedRef.current && !cancelledRef.current) await new Promise(r => setTimeout(r, 500));
        if (cancelledRef.current) break;
        consecutiveFailures = 0;
      }

      // Random interval before next
      if (idx < work.length - 1) {
        const minS = Math.max(1, config.intervalMinS);
        const maxS = Math.max(minS, config.intervalMaxS);
        const secs = minS + Math.random() * (maxS - minS);
        const ok3 = await sleep(Math.round(secs * 1000));
        if (!ok3) break;
      }
    }

    setRunning(false);
    setDone(true);
    // Use functional setter to read fresh stats
    setTargets(prev => {
      const sent = prev.filter(t => t.status === "sent").length;
      const failed = prev.filter(t => t.status === "failed").length;
      toast({ title: "Disparo finalizado", description: `${sent} enviadas, ${failed} falhas` });
      return prev;
    });
  }, [config, text, media, instanceName, checkConnection, sleep, toast]);

  const startCampaign = useCallback(() => {
    if (deduped.length === 0) { toast({ title: "Selecione contatos", variant: "destructive" }); return; }
    if (!text.trim() && !media) { toast({ title: "Adicione mensagem ou anexo", variant: "destructive" }); return; }
    if (config.intervalMaxS < config.intervalMinS) {
      toast({ title: "Intervalo inválido", description: "Intervalo máximo deve ser maior ou igual ao mínimo", variant: "destructive" });
      return;
    }
    const initial: CampaignTarget[] = deduped.map(c => ({
      id: c.id, phone: c.phone, name: c.name,
      bill: c.electricity_bill_value,
      status: "queued",
    }));
    runCampaign(initial);
  }, [deduped, text, media, config, runCampaign, toast]);

  const handlePause = () => { pausedRef.current = !pausedRef.current; setPaused(pausedRef.current); };
  const handleCancel = () => { cancelledRef.current = true; pausedRef.current = false; setPaused(false); };

  const retryFailed = () => {
    const failed = targets.filter(t => t.status === "failed").map(t => ({ ...t, status: "queued" as const, error: undefined }));
    if (failed.length === 0) return;
    runCampaign(failed);
  };

  const resetAll = () => {
    setStep(1); setTargets([]); setDone(false); setRunning(false); setPaused(false);
    cancelledRef.current = false; pausedRef.current = false;
  };

  const canGoNext = step === 1 ? deduped.length > 0
    : step === 2 ? (text.trim().length > 0 || !!media)
    : true;

  const filteredTargets = useMemo(() => {
    if (filterStatus === "all") return targets;
    return targets.filter(t => t.status === filterStatus);
  }, [targets, filterStatus]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-emerald-950/10">
      <div className="absolute -top-20 -right-20 w-40 h-40 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="relative p-5 sm:p-7 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 flex items-center justify-center border border-emerald-500/30">
              <Megaphone className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h3 className="font-heading font-bold text-foreground text-lg">Disparo PRO</h3>
              <p className="text-xs text-muted-foreground">Mensagens em massa com mídia, agendamento e anti-bloqueio</p>
            </div>
          </div>
          {(running || done) && (
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Progresso</p>
              <p className="text-sm font-bold text-foreground">
                {stats.sent + stats.failed}/{stats.total}
              </p>
            </div>
          )}
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto pb-1">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = step === s.n;
            const past = step > s.n;
            return (
              <div key={s.n} className="flex items-center gap-1 sm:gap-2">
                <button
                  type="button"
                  disabled={running}
                  onClick={() => { if (!running && s.n <= step) setStep(s.n); }}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                    active ? "bg-primary text-primary-foreground"
                    : past ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                    : "bg-secondary/30 text-muted-foreground"
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                    active ? "bg-primary-foreground/20" : past ? "bg-emerald-500/30" : "bg-secondary"
                  }`}>{past ? "✓" : s.n}</span>
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {i < STEPS.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground/40" />}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="min-h-[200px]">
          {step === 1 && (
            <div className="space-y-3">
              <ContactImporter
                customers={enrichedCustomers}
                contacts={contacts}
                onContactsChange={setContacts}
                instanceName={instanceName}
              />
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-secondary/20 border border-border/40 p-2 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase">Selecionados</p>
                  <p className="text-lg font-bold text-foreground">{deduped.length}</p>
                </div>
                <div className="rounded-lg bg-secondary/20 border border-border/40 p-2 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase">Duplicados</p>
                  <p className="text-lg font-bold text-yellow-400">{dupCount}</p>
                </div>
                <div className="rounded-lg bg-secondary/20 border border-border/40 p-2 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase">Inválidos</p>
                  <p className="text-lg font-bold text-red-400">{contacts.length - validContacts.length}</p>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <MessageEditor
              consultantId={consultantId}
              text={text}
              onTextChange={setText}
              media={media}
              onMediaChange={setMedia}
              previewName={deduped[0]?.name}
              previewBill={deduped[0]?.electricity_bill_value}
            />
          )}

          {step === 3 && (
            <div className="space-y-4">
              <ScheduleStep config={config} onChange={setConfig} totalContacts={deduped.length} />
              {/* Templates quick load */}
              {templates.length > 0 && (
                <div className="rounded-xl border border-border/40 bg-secondary/10 p-3">
                  <p className="text-xs font-bold mb-2">Carregar mensagem de um template</p>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
                    {templates.map(t => (
                      <button
                        key={t.id} type="button"
                        onClick={() => {
                          setText(t.content);
                          if (t.media_url && t.media_type && t.media_type !== "text") {
                            setMedia({ url: t.media_url, kind: t.media_type as any, fileName: t.name });
                          }
                          toast({ title: "Template carregado", description: t.name });
                        }}
                        className="text-[11px] px-2 py-1 rounded bg-secondary/40 hover:bg-secondary text-foreground border border-border/40"
                      >{t.name}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              {waitingSchedule && (
                <div className="rounded-xl bg-blue-500/10 border border-blue-500/30 p-3 text-center">
                  <p className="text-sm font-bold text-blue-300">⏰ Aguardando horário agendado</p>
                  <p className="text-xs text-blue-300/80">Início: {new Date(waitingSchedule).toLocaleString("pt-BR")}</p>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Total", val: stats.total, cls: "text-foreground" },
                  { label: "Enviadas", val: stats.sent, cls: "text-emerald-400" },
                  { label: "Falhas", val: stats.failed, cls: "text-red-400" },
                  { label: "Fila", val: stats.queued, cls: "text-muted-foreground" },
                ].map(s => (
                  <div key={s.label} className="rounded-lg bg-secondary/20 border border-border/40 p-2 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">{s.label}</p>
                    <p className={`text-lg font-bold ${s.cls}`}>{s.val}</p>
                  </div>
                ))}
              </div>

              <Progress value={stats.total ? ((stats.sent + stats.failed) / stats.total) * 100 : 0} className="h-2.5" />

              {/* Controls */}
              {running && (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handlePause} className="flex-1 gap-1.5 rounded-xl h-10">
                    {paused ? <><Play className="w-4 h-4" /> Retomar</> : <><Pause className="w-4 h-4" /> Pausar</>}
                  </Button>
                  <Button variant="destructive" onClick={handleCancel} className="flex-1 gap-1.5 rounded-xl h-10">
                    <X className="w-4 h-4" /> Cancelar
                  </Button>
                </div>
              )}

              {/* Filter */}
              {targets.length > 0 && (
                <div className="flex items-center gap-2">
                  {(["all", "sent", "failed"] as const).map(f => (
                    <button
                      key={f} onClick={() => setFilterStatus(f)}
                      className={`text-[11px] px-2.5 py-1 rounded-md font-medium ${
                        filterStatus === f ? "bg-primary text-primary-foreground" : "bg-secondary/40 text-muted-foreground"
                      }`}
                    >{f === "all" ? "Todos" : f === "sent" ? "Enviados" : "Falhas"}</button>
                  ))}
                </div>
              )}

              {/* Live list */}
              <div className="rounded-xl border border-border/40 bg-secondary/10 max-h-80 overflow-auto">
                {filteredTargets.slice(0, 200).map(t => (
                  <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 last:border-0 text-xs">
                    <span className="w-5 flex-shrink-0">
                      {t.status === "queued" && <span className="w-2 h-2 rounded-full bg-muted-foreground/40 inline-block" />}
                      {t.status === "sending" && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
                      {t.status === "sent" && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                      {t.status === "failed" && <XCircle className="w-3 h-3 text-red-400" />}
                    </span>
                    <span className="flex-1 truncate text-foreground">{t.name}</span>
                    <span className="text-muted-foreground font-mono">{t.phone}</span>
                    {t.error && <span className="text-red-400 text-[10px] truncate max-w-[120px]" title={t.error}>{t.error}</span>}
                  </div>
                ))}
                {filteredTargets.length === 0 && (
                  <p className="p-4 text-center text-xs text-muted-foreground">Nada para mostrar</p>
                )}
              </div>

              {done && (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => downloadCsv(targets)} className="flex-1 gap-1.5 rounded-xl h-10">
                    <Download className="w-4 h-4" /> Baixar relatório CSV
                  </Button>
                  {stats.failed > 0 && (
                    <Button variant="outline" onClick={retryFailed} className="flex-1 gap-1.5 rounded-xl h-10">
                      <RotateCw className="w-4 h-4" /> Reenviar falhas ({stats.failed})
                    </Button>
                  )}
                  <Button onClick={resetAll} className="flex-1 rounded-xl h-10">Novo disparo</Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer navigation */}
        {step < 4 && !running && (
          <div className="flex items-center justify-between pt-2 border-t border-border/30">
            <Button
              variant="outline" disabled={step === 1}
              onClick={() => setStep((s) => Math.max(1, s - 1) as Step)}
              className="gap-1.5 rounded-xl"
            >
              <ArrowLeft className="w-4 h-4" /> Voltar
            </Button>

            {step < 3 ? (
              <Button
                onClick={() => setStep((s) => Math.min(3, s + 1) as Step)}
                disabled={!canGoNext}
                className="gap-1.5 rounded-xl"
              >
                Avançar <ArrowRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button
                onClick={startCampaign}
                disabled={deduped.length === 0 || (!text.trim() && !media)}
                className="gap-1.5 rounded-xl h-11 font-bold"
                style={{ background: "var(--gradient-green)" }}
              >
                <Send className="w-4 h-4" />
                {config.scheduleAt ? "Agendar e iniciar" : `Iniciar disparo (${deduped.length})`}
              </Button>
            )}
          </div>
        )}

        {/* Warning low */}
        {step === 1 && deduped.length > 200 && (
          <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/30 p-2.5 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-yellow-300">
              Mais de 200 contatos em um envio aumenta o risco de bloqueio. Considere dividir em dias.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
