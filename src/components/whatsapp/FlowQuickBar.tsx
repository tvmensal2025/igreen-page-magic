import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import { normalizeSendStepError } from "@/lib/whatsapp/send";
import { Zap, Send, ListChecks, FastForward, Loader2, StopCircle, ExternalLink, Eye } from "lucide-react";
import { ManualStepDialog } from "@/components/admin/AIAgentTab/ManualStepDialog";
import { StepPartPreview, type PartKind } from "@/components/whatsapp/StepPartPreview";

type Step = { id: string; step_key: string | null; title: string | null; slot_key: string | null; message_text: string | null; position: number; captures?: any };

function extractStepButtons(step: Step | undefined): { id: string; title: string }[] {
  if (!step) return [];
  try {
    const caps = Array.isArray((step as any).captures) ? (step as any).captures : [];
    const found = caps.find((c: any) => c?.field === "_buttons" && c?.enabled !== false);
    if (found && Array.isArray(found.value)) {
      return found.value
        .map((b: any) => ({ id: String(b?.id || "").trim(), title: String(b?.title || "").trim() }))
        .filter((b: any) => b.id && b.title)
        .slice(0, 3);
    }
  } catch {}
  return [];
}
type Part = { kind: PartKind; text?: string | null; url?: string | null };

interface Props {
  consultantId?: string;
  customerId?: string;
  customerName?: string;
  disabled?: boolean;
}

async function loadStepParts(consultantId: string, step: Step): Promise<Part[]> {
  const slot = step.slot_key || step.step_key;
  const { data: medias } = await supabase
    .from("ai_media_library")
    .select("id, kind, url, send_order")
    .eq("consultant_id", consultantId)
    .eq("slot_key", slot || "")
    .eq("active", true).eq("is_draft", false)
    .order("send_order", { ascending: true });
  const items: Part[] = [];
  ((medias as Array<{ kind: string; url: string }>) || []).forEach((m) => {
    if (m.url) items.push({ kind: String(m.kind || "document").toLowerCase() as PartKind, url: m.url });
  });
  if (step.message_text && step.message_text.trim()) {
    items.push({ kind: "text", text: step.message_text });
  }
  return items;
}

// Cache em módulo (sobrevive a fechar/abrir o popover dentro da mesma sessão).
// Evita o flicker "encolhe e cresce" quando o consultor reabre o ⚡ no mesmo
// lead/variante. Chave: `${consultantId}|${variant}`.
const STEPS_CACHE = new Map<string, Step[]>();
const VARIANTS_CACHE = new Map<string, { byVariant: Map<"A" | "B" | "C" | "D" | "E", string>; available: Array<"A" | "B" | "C" | "D" | "E">; defaultVariant: "A" | "B" | "C" | "D" | "E" }>();

export function FlowQuickBar({ consultantId, customerId, customerName, disabled }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [seq, setSeq] = useState<{ current: number; total: number } | null>(null);
  const abortRef = useRef(false);
  const [previewStep, setPreviewStep] = useState<Step | null>(null);
  const [previewParts, setPreviewParts] = useState<Part[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmFrom, setConfirmFrom] = useState<number | null>(null);
  const [fromParts, setFromParts] = useState<Record<string, Part[]>>({});
  const [oneByOneStepId, setOneByOneStepId] = useState<string | null>(null);
  const [variant, setVariant] = useState<"A" | "B" | "C" | "D" | "E">("A");
  const [variantsAvailable, setVariantsAvailable] = useState<Array<"A" | "B" | "C" | "D" | "E">>(["A"]);
  const [byVariant, setByVariant] = useState<Map<"A" | "B" | "C" | "D" | "E", string>>(new Map());

  // Efeito 1 — inicialização: roda quando o popover abre ou o cliente muda.
  // Define a variante default a partir de customers.flow_variant SEM ouvir mudanças
  // posteriores em `variant` (senão o clique manual em A/B/C/D/E seria revertido).
  useEffect(() => {
    if (!open || !consultantId) return;
    let mounted = true;
    (async () => {
      // Cache hit: aplica imediatamente, sem `loading=true`, e revalida em
      // background. Acaba com o "encolhe e cresce" ao reabrir o popover.
      const cachedVar = VARIANTS_CACHE.get(consultantId);
      if (cachedVar) {
        setByVariant(cachedVar.byVariant);
        setVariantsAvailable(cachedVar.available.length ? cachedVar.available : ["A"]);
        setVariant((v) => cachedVar.byVariant.has(v) ? v : cachedVar.defaultVariant);
      } else {
        setLoading(true);
      }

      let custVariant: "A" | "B" | "C" | "D" | "E" = "A";
      if (customerId) {
        const { data: cust } = await supabase
          .from("customers").select("flow_variant")
          .eq("id", customerId).maybeSingle();
        const v = String((cust as { flow_variant?: string } | null)?.flow_variant || "A").toUpperCase();
        if (v === "A" || v === "B" || v === "C" || v === "D" || v === "E") custVariant = v;
      }

      const { data: flowsAll } = await supabase
        .from("bot_flows").select("id, variant, created_at")
        .eq("consultant_id", consultantId).eq("is_active", true)
        .order("created_at", { ascending: false });
      const flowsList = ((flowsAll as Array<{ id: string; variant: string }> | null) || []);
      const byV = new Map<"A" | "B" | "C" | "D" | "E", string>();
      flowsList.forEach((f) => {
        const v = String(f.variant || "A").toUpperCase() as "A" | "B" | "C" | "D" | "E";
        if (["A", "B", "C", "D", "E"].includes(v) && !byV.has(v)) byV.set(v, f.id);
      });
      const available = (["A", "B", "C", "D", "E"] as const).filter((v) => byV.has(v));
      const defaultVariant: "A" | "B" | "C" | "D" | "E" = byV.has(custVariant)
        ? custVariant
        : (available[0] || "A");
      VARIANTS_CACHE.set(consultantId, { byVariant: byV, available: [...available], defaultVariant });
      if (!mounted) return;
      setByVariant(byV);
      setVariantsAvailable(available.length > 0 ? available : ["A"]);
      // Só seta a variante se ainda não veio do cache (para não sobrescrever
      // uma escolha manual do consultor entre cache hit e revalidação).
      if (!cachedVar) setVariant(defaultVariant);
      if (byV.size === 0) {
        setSteps([]);
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [open, consultantId, customerId]);

  // Efeito 2 — carrega passos da variante. Usa cache para evitar flicker ao
  // alternar A/B/C ou reabrir o popover.
  useEffect(() => {
    if (!open || !consultantId) return;
    if (byVariant.size === 0) return;
    const flowId = byVariant.get(variant);
    if (!flowId) { setSteps([]); setLoading(false); return; }
    const cacheKey = `${consultantId}|${variant}`;
    const cached = STEPS_CACHE.get(cacheKey);
    if (cached) {
      setSteps(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("bot_flow_steps")
        .select("id, step_key, title, slot_key, message_text, position, captures")
        .eq("flow_id", flowId).eq("is_active", true)
        .order("position", { ascending: true });
      if (!mounted) return;
      const list = (data as Step[]) || [];
      STEPS_CACHE.set(cacheKey, list);
      setSteps(list);
      // Limpa previews/seleções da variante anterior.
      setPreviewStep(null);
      setPreviewParts([]);
      setOneByOneStepId(null);
      setFromParts({});
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [open, consultantId, variant, byVariant]);



  // Load preview parts when opening the single-step preview
  useEffect(() => {
    if (!previewStep || !consultantId) return;
    let mounted = true;
    setPreviewLoading(true);
    loadStepParts(consultantId, previewStep).then((p) => {
      if (mounted) { setPreviewParts(p); setPreviewLoading(false); }
    });
    return () => { mounted = false; };
  }, [previewStep, consultantId]);

  // Load parts for "from here" sequence preview
  useEffect(() => {
    if (confirmFrom === null || !consultantId) return;
    const slice = steps.slice(confirmFrom);
    let mounted = true;
    (async () => {
      const acc: Record<string, Part[]> = {};
      for (const s of slice) {
        if (!mounted) return;
        acc[s.id] = await loadStepParts(consultantId, s);
      }
      if (mounted) setFromParts(acc);
    })();
    return () => { mounted = false; };
  }, [confirmFrom, steps, consultantId]);

  async function invokeStep(stepId: string, opts?: { force?: boolean }): Promise<{ ok: boolean; code?: string }> {
    if (!consultantId || !customerId) return { ok: false };
    const { data, error } = await supabase.functions.invoke("manual-step-send", {
      body: { consultantId, customerId, stepId, part: "all", variant, force: opts?.force },
    });
    const d = data as { error?: string; ok?: boolean; code?: string };
    if (error || d?.error || d?.ok === false) {
      const { code, message } = normalizeSendStepError(error, data);
      toast({ title: code === "awaiting_inbound" ? "⏳ Aguardando lead" : "Erro ao enviar passo", description: message, variant: code === "awaiting_inbound" ? "default" : "destructive" });
      return { ok: false, code };
    }
    return { ok: true };
  }

  const confirmSendFull = useCallback(async () => {
    if (!previewStep) return;
    const step = previewStep;
    abortRef.current = false;
    setSendingId(step.id);
    setSeq({ current: 1, total: 1 });
    if (abortRef.current) { setSendingId(null); setSeq(null); setPreviewStep(null); toast({ title: "⏹️ Envio cancelado" }); return; }
    const res = await invokeStep(step.id);
    setSendingId(null);
    setSeq(null);
    setPreviewStep(null);
    if (abortRef.current) { toast({ title: "⏹️ Envio cancelado" }); return; }
    if (res.ok) toast({ title: `✅ Passo enviado`, description: step.title || step.step_key || `Passo ${step.position + 1}` });
  }, [previewStep, variant]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Daqui em diante" agora envia SÓ o passo escolhido (1 por vez). O backend
  // bloqueia rajadas via awaiting_inbound. Para enviar o próximo, o consultor
  // espera o lead responder e clica de novo.
  async function runFromHere(fromIdx: number) {
    const step = steps[fromIdx];
    if (!step) return;
    abortRef.current = false;
    setSeq({ current: 1, total: 1 });
    setOpen(false);
    if (abortRef.current) { setSeq(null); toast({ title: "⏹️ Envio cancelado" }); return; }
    const res = await invokeStep(step.id);
    if (abortRef.current) { setSeq(null); toast({ title: "⏹️ Envio cancelado" }); return; }
    if (res.ok) toast({ title: "✅ Passo enviado", description: `Aguarde o lead responder antes do próximo.` });
    setSeq(null);
  }

  if (!consultantId) return null;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost" size="icon"
            className="h-9 w-9 lg:h-8 lg:w-8 shrink-0 text-muted-foreground hover:text-primary relative"
            disabled={disabled || !!seq || !customerId}
            title={!customerId ? "Carregando lead…" : "Enviar passo do fluxo"}
          >
            <Zap className={`h-4 w-4 ${seq ? "opacity-30" : ""}`} />
            {seq && (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-primary absolute inset-0 m-auto" />
                <span className="absolute -top-1 -right-1 text-[9px] bg-primary text-primary-foreground rounded-full px-1 leading-tight pointer-events-none">
                  {seq.current}/{seq.total}
                </span>
              </>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-[22rem] p-0 min-h-[320px] flex flex-col">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2 bg-gradient-to-r from-primary/10 to-transparent">
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground">Enviar passo do fluxo para</p>
              <p className="text-sm font-semibold truncate">{customerName || customerId}</p>
              <p className="text-[10px] text-primary mt-0.5">✓ Envio manual funciona mesmo com bot pausado</p>
            </div>
            {steps.length > 0 && <Badge variant="secondary" className="text-[10px] shrink-0">{steps.length} passos</Badge>}
          </div>

          {/* Seletor A/B/C — troca o fluxo da conversa atual */}
          <div className="px-3 py-2 border-b border-border flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Fluxo</span>
            <div className="flex gap-1">
              {(["A", "B", "C", "D", "E"] as const).map((v) => {
                const enabled = variantsAvailable.includes(v);
                const active = variant === v;
                return (
                  <Button
                    key={v}
                    size="sm"
                    variant={active ? "default" : "outline"}
                    className="h-6 px-2 text-[11px] font-bold"
                    disabled={!enabled || !!seq}
                    onClick={() => setVariant(v)}
                    title={enabled ? `Usar fluxo ${v}` : `Fluxo ${v} não configurado`}
                  >
                    {v}
                  </Button>
                );
              })}
            </div>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {variant === "A" ? "com áudio" : variant === "B" ? "só texto" : variant === "C" ? "com vídeo" : variant === "D" ? "botões/auto" : "custom"}
            </span>
          </div>


          {seq && (
            <div className="px-3 py-2 bg-primary/5 border-b border-border flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
              <span className="text-xs text-foreground flex-1">Enviando {seq.current}/{seq.total}…</span>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive"
                onClick={() => { abortRef.current = true; }}>
                <StopCircle className="w-3 h-3 mr-1" /> Parar
              </Button>
            </div>
          )}

          <div className="max-h-[50vh] overflow-y-auto py-1">
            {loading ? (
              <div className="flex items-center justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
            ) : steps.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6 px-3">Nenhum passo configurado neste consultor.</p>
            ) : variant === "D" ? (() => {
              const first = steps[0];
              const btns = extractStepButtons(first);
              const preview = (first?.message_text || "").trim();
              return (
                <div className="px-3 py-3 space-y-3">
                  <div className="rounded-lg border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-3 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-primary/20 text-primary">
                        <Zap className="w-3.5 h-3.5" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground leading-tight">Fluxo D — automático</p>
                        <p className="text-[10px] text-muted-foreground leading-tight">Cliente clica, bot conduz sozinho</p>
                      </div>
                    </div>

                    {preview && (
                      <div className="rounded-md bg-background/60 border border-border/50 p-2.5">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Prévia da 1ª mensagem</p>
                        <p className="text-[11px] text-foreground/90 leading-relaxed line-clamp-4 whitespace-pre-wrap">{preview}</p>
                      </div>
                    )}

                    {btns.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Botões que o cliente verá</p>
                        <div className="flex flex-wrap gap-1.5">
                          {btns.map((b) => (
                            <span key={b.id} className="inline-flex items-center px-2 py-1 rounded-md border border-primary/40 bg-primary/5 text-[11px] font-medium text-primary">
                              {b.title}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <Button
                    className="w-full gap-2 h-10 font-semibold shadow-md shadow-primary/20"
                    disabled={!!seq || !!sendingId || !first}
                    onClick={async () => {
                      if (!first) return;
                      setSendingId(first.id);
                      setOpen(false);
                      const res = await invokeStep(first.id);
                      setSendingId(null);
                      if (res.ok) toast({ title: "▶️ Fluxo D iniciado", description: "Agora o bot continua sozinho conforme o cliente responder." });
                    }}
                  >
                    {sendingId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Iniciar Fluxo D
                  </Button>
                  <p className="text-[10px] text-muted-foreground text-center leading-tight">
                    Depois disso o bot continua sozinho ✨
                  </p>
                </div>
              );
            })() : (
              steps.map((s, i) => {
                const isSending = sendingId === s.id;
                return (
                  <div key={s.id} className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-secondary/40 rounded-md mx-1">
                    <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0">{i + 1}</span>
                    <span className="text-xs text-foreground flex-1 truncate" title={s.title || s.step_key || ""}>
                      {s.title || s.step_key || `Passo ${i + 1}`}
                    </span>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-primary hover:bg-primary/10"
                      title="Pré-visualizar e enviar passo completo"
                      disabled={isSending || !!seq}
                      onClick={() => { setPreviewStep(s); setOpen(false); }}>
                      {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7"
                      title="Enviar 1 a 1 (ouvir/ver cada mídia)"
                      disabled={!!seq}
                      onClick={() => { setOneByOneStepId(s.id); setOpen(false); }}>
                      <ListChecks className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-warning hover:bg-warning/10"
                      title="Pré-visualizar e enviar este passo + todos os seguintes"
                      disabled={!!seq}
                      onClick={() => setConfirmFrom(i)}>
                      <FastForward className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-border px-3 py-2 flex items-center justify-between bg-card">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary"><Eye className="w-3 h-3" /> Completo</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted"><ListChecks className="w-3 h-3" /> 1 a 1</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-warning/10 text-warning"><FastForward className="w-3 h-3" /> Daqui</span>
            </div>
            <a href="/admin/fluxos" target="_blank" rel="noreferrer"
              className="text-[10px] text-primary hover:underline flex items-center gap-1">
              Editar <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
        </PopoverContent>
      </Popover>

      {/* Preview: Passo completo */}
      <Dialog open={!!previewStep} onOpenChange={(o) => !o && setPreviewStep(null)}>
        <DialogContent className="max-w-xl p-0 gap-0 max-h-[90vh] grid grid-rows-[auto_minmax(0,1fr)_auto]">
          <DialogHeader className="px-5 py-4 border-b border-border bg-gradient-to-r from-primary/10 to-transparent space-y-1">
            <DialogTitle className="flex items-center gap-2 text-base">
              <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-primary/15 text-primary"><Eye className="w-3.5 h-3.5" /></span>
              Pré-visualizar antes de enviar
            </DialogTitle>
            <DialogDescription className="text-xs">
              <strong className="text-foreground">{previewStep?.title || previewStep?.step_key}</strong> → {customerName || customerId}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto px-5 py-4 space-y-3 min-h-0">
            {previewLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : previewParts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Este passo não tem texto nem mídia configurada.</p>
            ) : (
              previewParts.map((p, i) => (
                <div key={i} className="border border-border/60 rounded-lg p-3 bg-card shadow-sm">
                  <StepPartPreview kind={p.kind} text={p.text} url={p.url} />
                </div>
              ))
            )}
          </div>
          <DialogFooter className="px-5 py-3 border-t border-border bg-card flex-col-reverse sm:flex-row gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setPreviewStep(null)} disabled={!!sendingId} className="w-full sm:w-auto">Cancelar</Button>
            <Button onClick={confirmSendFull} disabled={!!sendingId || previewParts.length === 0} className="gap-2 w-full sm:w-auto" aria-busy={!!sendingId}>
              {sendingId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {sendingId
                ? `Enviando ${previewParts.length} ${previewParts.length === 1 ? "parte" : "partes"}…`
                : `Confirmar e enviar ${previewParts.length > 0 ? `(${previewParts.length} ${previewParts.length === 1 ? "parte" : "partes"})` : "tudo"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview: Daqui em diante */}
      <Dialog open={confirmFrom !== null} onOpenChange={(o) => { if (!o) { setConfirmFrom(null); setFromParts({}); } }}>
        <DialogContent className="max-w-2xl p-0 gap-0 max-h-[90vh] grid grid-rows-[auto_minmax(0,1fr)_auto]">
          <DialogHeader className="px-5 py-4 border-b border-border bg-gradient-to-r from-primary/10 to-transparent space-y-1">
            <DialogTitle className="flex items-center gap-2 text-base">
              <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-primary/15 text-primary"><FastForward className="w-3.5 h-3.5" /></span>
              Enviar daqui em diante?
            </DialogTitle>
            <DialogDescription className="text-xs">
              <strong className="text-foreground">{confirmFrom !== null ? steps.length - confirmFrom : 0} passos</strong> em sequência para{" "}
              <strong className="text-foreground">{customerName || customerId}</strong>. Expanda cada passo para ouvir/ver antes.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto px-5 py-3 min-h-0">
          {confirmFrom !== null && (
            <Accordion type="multiple" className="w-full">
              {steps.slice(confirmFrom).map((s, i) => {
                const parts = fromParts[s.id];
                return (
                  <AccordionItem key={s.id} value={s.id} className="border-border/60 data-[state=open]:bg-muted/30 rounded-md px-2">
                    <AccordionTrigger className="text-sm py-2.5 hover:no-underline">
                      <span className="flex items-center gap-2 text-left flex-1 min-w-0">
                        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary/10 text-primary text-[11px] font-bold shrink-0">{confirmFrom + i + 1}</span>
                        <span className="truncate">{s.title || s.step_key || `Passo ${confirmFrom + i + 1}`}</span>
                        {parts && <Badge variant="secondary" className="text-[9px] ml-1 shrink-0">{parts.length} {parts.length === 1 ? "parte" : "partes"}</Badge>}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-2">
                        {!parts ? (
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        ) : parts.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Sem conteúdo.</p>
                        ) : (
                          parts.map((p, j) => (
                            <div key={j} className="border border-border/60 rounded-md p-2 bg-card shadow-sm">
                              <StepPartPreview kind={p.kind} text={p.text} url={p.url} compact />
                            </div>
                          ))
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
          </div>
          <DialogFooter className="px-5 py-3 border-t border-border bg-card flex-col-reverse sm:flex-row gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => { setConfirmFrom(null); setFromParts({}); }} className="w-full sm:w-auto">Cancelar</Button>
            <Button
              onClick={() => { const f = confirmFrom!; setConfirmFrom(null); setFromParts({}); runFromHere(f); }}
              className="gap-2 w-full sm:w-auto"
            >
              <FastForward className="w-4 h-4" /> Enviar sequência
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {oneByOneStepId && consultantId && customerId && (
        <ManualStepDialog
          open={!!oneByOneStepId}
          onOpenChange={(o) => { if (!o) setOneByOneStepId(null); }}
          consultantId={consultantId}
          customerId={customerId}
          customerName={customerName || null}
          initialStepId={oneByOneStepId}
        />
      )}
    </>
  );
}
