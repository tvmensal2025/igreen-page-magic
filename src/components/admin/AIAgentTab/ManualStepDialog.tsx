import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Send, Play, Zap } from "lucide-react";
import { StepPartPreview, type PartKind } from "@/components/whatsapp/StepPartPreview";
import { normalizeSendStepError } from "@/lib/whatsapp/send";

type Step = {
  id: string;
  step_key: string | null;
  title: string | null;
  slot_key: string | null;
  message_text: string | null;
  position: number;
  captures?: any;
};

function extractStepButtons(step: Step | undefined | null): { id: string; title: string }[] {
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

type Media = { id: string; kind: string; url: string; slot_key: string | null };

type Part = { kind: "text" | "audio" | "image" | "video" | "document"; text?: string; media?: Media };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consultantId: string;
  customerId: string;
  customerName: string | null;
  initialStepId?: string;
}



export function ManualStepDialog({ open, onOpenChange, consultantId, customerId, customerName, initialStepId }: Props) {
  const { toast } = useToast();
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedStep, setSelectedStep] = useState<Step | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [partIdx, setPartIdx] = useState(0);
  const [sending, setSending] = useState(false);
  const [variant, setVariant] = useState<"A" | "B" | "C" | "D" | "E" | "M">("A");
  const [variantsAvailable, setVariantsAvailable] = useState<Array<"A" | "B" | "C" | "D" | "E" | "M">>(["A"]);
  const [byVariant, setByVariant] = useState<Map<"A" | "B" | "C" | "D" | "E" | "M", string>>(new Map());

  // Efeito 1 — inicialização: define variante default a partir do cliente
  // sem reagir a mudanças posteriores em `variant` (clique manual não pode
  // ser revertido pela flow_variant do cliente).
  useEffect(() => {
    if (!open) { setSelectedStep(null); setParts([]); setPartIdx(0); return; }
    let mounted = true;
    (async () => {
      setLoading(true);

      const { data: cust } = await supabase
        .from("customers").select("flow_variant")
        .eq("id", customerId).maybeSingle();
      const custVariant = String((cust as { flow_variant?: string } | null)?.flow_variant || "A").toUpperCase() as "A" | "B" | "C" | "D" | "E" | "M";

      const { data: flowsAll } = await supabase
        .from("bot_flows").select("id, variant, created_at")
        .eq("consultant_id", consultantId).eq("is_active", true)
        .order("created_at", { ascending: false });
      const flowsList = ((flowsAll as Array<{ id: string; variant: string }> | null) || []);
      const byVariant = new Map<"A" | "B" | "C" | "D" | "E" | "M", string>();
      flowsList.forEach((f) => {
        const v = String(f.variant || "A").toUpperCase() as "A" | "B" | "C" | "D" | "E" | "M";
        if (["A", "B", "C", "D", "E", "M"].includes(v) && !byVariant.has(v)) byVariant.set(v, f.id);
      });
      const available = (["A", "B", "C", "D", "E", "M"] as const).filter((v) => byVariant.has(v));
      if (!mounted) return;
      setByVariant(byVariant);
      setVariantsAvailable(available.length > 0 ? available : ["A"]);

      const selected: "A" | "B" | "C" | "D" | "E" | "M" = byVariant.has(custVariant) ? custVariant : (available[0] || "A");
      setVariant(selected);
      // IMPORTANTE: não desligar `loading` aqui quando há fluxos. O Efeito 2
      // assume o carregamento dos passos e só então desliga o loading. Se a
      // gente desligasse aqui, o dialog mostraria a lista, o Efeito 2 ligaria
      // o loading de novo e a tela "piscaria" (spinner -> lista -> spinner).
      if (byVariant.size === 0) {
        setSteps([]);
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [open, consultantId, customerId]);

  // Efeito 2 — troca manual: recarrega só os passos da variante escolhida,
  // sem mexer em `variant` nem reler flow_variant. Depende de `byVariant`
  // (estado) para garantir que os passos carreguem mesmo quando a variante
  // selecionada já é a inicial (ex.: "A"), em que `setVariant` não muda nada.
  useEffect(() => {
    if (!open) return;
    if (byVariant.size === 0) return;
    const flowId = byVariant.get(variant);
    if (!flowId) { setSteps([]); setLoading(false); return; }
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("bot_flow_steps")
        .select("id, step_key, title, slot_key, message_text, position, captures")
        .eq("flow_id", flowId).eq("is_active", true)
        .order("position", { ascending: true });
      if (!mounted) return;
      const list = ((data as Step[]) || []);
      setSteps(list);
      setSelectedStep(null);
      setParts([]);
      setPartIdx(0);
      setLoading(false);
      if (initialStepId) {
        const pre = list.find((s) => s.id === initialStepId);
        if (pre) loadStepParts(pre);
      }
    })();
    return () => { mounted = false; };
  }, [open, variant, byVariant, initialStepId]);



  async function loadStepParts(step: Step) {
    setSelectedStep(step);
    setPartIdx(0);
    const slot = step.slot_key || step.step_key;
    const { data: medias } = await supabase
      .from("ai_media_library")
      .select("id, kind, url, slot_key, send_order")
      .eq("consultant_id", consultantId)
      .eq("slot_key", slot || "")
      .eq("active", true).eq("is_draft", false)
      .order("send_order", { ascending: true });
    const items: Part[] = [];
    ((medias as any[]) || []).forEach((m) => {
      if (m.url) items.push({ kind: String(m.kind || "document").toLowerCase() as any, media: m });
    });
    if (step.message_text && step.message_text.trim()) {
      items.push({ kind: "text", text: step.message_text });
    }
    setParts(items);
  }

  async function sendPart(part: Part, indexLabel: string) {
    setSending(true);
    try {
      const payload: any = {
        consultantId, customerId,
        stepId: selectedStep!.id,
        part: part.kind,
        variant,
      };
      if (part.media?.id) payload.mediaId = part.media.id;
      const { data, error } = await supabase.functions.invoke("manual-step-send", { body: payload });
      if (error || (data as any)?.error || (data as any)?.ok === false) {
        throw new Error(normalizeSendStepError(error, data).message);
      }
      toast({ title: `✅ Enviado: ${indexLabel}` });
    } catch (e: any) {
      toast({ title: "Erro ao enviar", description: e?.message, variant: "destructive" });
    } finally { setSending(false); }
  }

  async function sendAll() {
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("manual-step-send", {
        body: { consultantId, customerId, stepId: selectedStep!.id, part: "all", variant },
      });
      if (error || (data as any)?.error || (data as any)?.ok === false) {
        throw new Error(normalizeSendStepError(error, data).message);
      }
      toast({ title: "✅ Passo completo enviado" });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message, variant: "destructive" });
    } finally { setSending(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={[
          "w-[calc(100%-1rem)] max-w-2xl p-0 gap-0 overflow-hidden flex flex-col",
          "max-h-[min(92dvh,860px)] h-[min(92dvh,860px)] sm:h-auto sm:max-h-[min(90dvh,820px)]",
        ].join(" ")}
      >
        <DialogHeader className="shrink-0 px-4 sm:px-6 pt-5 pb-3 pr-12 border-b text-left space-y-2">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            Enviar passo do fluxo
            <Badge variant="outline" className="text-[10px]">Fluxo {variant}</Badge>
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Para <strong>{customerName || customerId}</strong>. Envio manual ignora pausa do bot.
          </DialogDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Fluxo:</span>
            {(["A", "B", "C", "D", "E", "M"] as const).map((v) => {
              const enabled = variantsAvailable.includes(v);
              const active = variant === v;
              return (
                <Button
                  key={v}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  className="h-7 min-w-8 px-2 text-[11px] font-bold"
                  disabled={!enabled || sending}
                  onClick={() => { setVariant(v); setSelectedStep(null); setParts([]); }}
                  title={enabled ? `Usar fluxo ${v}` : `Fluxo ${v} não configurado`}
                >
                  {v}
                </Button>
              );
            })}
            <span className="text-[10px] text-muted-foreground w-full sm:w-auto sm:ml-1">
              {variant === "A" ? "com áudio" : variant === "B" ? "só texto" : variant === "C" ? "com vídeo" : variant === "D" ? "botões/auto" : "custom"}
            </span>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 py-3">
          {!selectedStep ? (
            <div className="space-y-2">
              {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> :
                steps.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum passo configurado.</p> :
                variant === "D" ? (() => {
                  const first = steps[0];
                  const btns = extractStepButtons(first);
                  const preview = (first?.message_text || "").trim();
                  return (
                    <div className="space-y-3 p-1">
                      <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 space-y-3">
                        <div className="flex items-center gap-2.5">
                          <span className="inline-flex items-center justify-center h-9 w-9 rounded-full bg-primary/20 text-primary shrink-0">
                            <Zap className="w-4 h-4" />
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground leading-tight">Fluxo D — automático por botões</p>
                            <p className="text-[11px] text-muted-foreground leading-tight">O cliente clica, o bot conduz sozinho</p>
                          </div>
                        </div>

                        {preview && (
                          <div className="rounded-md bg-background/60 border border-border/50 p-3">
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Prévia da 1ª mensagem</p>
                            <p className="text-xs text-foreground/90 leading-relaxed line-clamp-5 whitespace-pre-wrap">{preview}</p>
                          </div>
                        )}

                        {btns.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Botões que o cliente verá</p>
                            <div className="flex flex-wrap gap-1.5">
                              {btns.map((b) => (
                                <span key={b.id} className="inline-flex items-center px-2.5 py-1 rounded-md border border-primary/40 bg-primary/5 text-xs font-medium text-primary">
                                  {b.title}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <Button
                        className="w-full gap-2 h-11 font-semibold shadow-md shadow-primary/20"
                        disabled={sending || !first}
                        onClick={async () => {
                          if (!first) return;
                          setSending(true);
                          try {
                            const { data, error } = await supabase.functions.invoke("manual-step-send", {
                              body: { consultantId, customerId, stepId: first.id, part: "all", variant },
                            });
                            if (error || (data as any)?.error || (data as any)?.ok === false) {
                              throw new Error(normalizeSendStepError(error, data).message);
                            }
                            toast({ title: "▶️ Fluxo D iniciado", description: "Bot continua sozinho conforme o cliente responder." });
                            onOpenChange(false);
                          } catch (e: any) {
                            toast({ title: "Erro", description: e?.message, variant: "destructive" });
                          } finally { setSending(false); }
                        }}
                      >
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        Iniciar Fluxo D
                      </Button>
                      <p className="text-[11px] text-muted-foreground text-center">
                        Depois disso o bot continua sozinho ✨
                      </p>
                    </div>
                  );
                })() :
                steps.map((s, i) => (
                  <Card key={s.id} className="p-3 flex items-center gap-3 hover:bg-secondary/30 cursor-pointer"
                        onClick={() => loadStepParts(s)}>
                    <span className="text-xs font-mono text-muted-foreground w-6 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{s.title || s.step_key || `Passo ${i + 1}`}</p>
                      {s.message_text && <p className="text-xs text-muted-foreground truncate">{s.message_text}</p>}
                    </div>
                    <Play className="w-4 h-4 opacity-50 shrink-0" />
                  </Card>
                ))}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Passo selecionado</p>
                  <p className="text-sm font-semibold truncate">{selectedStep.title || selectedStep.step_key}</p>
                </div>
                <Button size="sm" variant="ghost" className="shrink-0" onClick={() => { setSelectedStep(null); setParts([]); }}>
                  Trocar
                </Button>
              </div>

              {parts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Este passo não tem texto nem mídia configurada.</p>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={sendAll} disabled={sending} className="gap-2 w-full sm:w-auto">
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Enviar tudo (sequencial)
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Enviar 1 a 1</p>
                    {parts.map((p, i) => {
                      const isNext = i === partIdx;
                      const wasSent = i < partIdx;
                      return (
                        <Card key={i} className={`p-3 flex flex-col sm:flex-row sm:items-start gap-3 ${wasSent ? "opacity-50" : ""}`}>
                          <div className="flex-1 min-w-0">
                            <StepPartPreview
                              kind={p.kind as PartKind}
                              text={p.text}
                              url={p.media?.url}
                            />
                          </div>
                          <Button
                            size="sm"
                            variant={isNext ? "default" : "outline"}
                            disabled={sending}
                            className="shrink-0 w-full sm:w-auto"
                            onClick={async () => {
                              await sendPart(p, `${p.kind} (${i + 1}/${parts.length})`);
                              setPartIdx(i + 1);
                            }}
                          >
                            {sending && isNext ? <Loader2 className="w-3 h-3 animate-spin" /> : "Enviar"}
                          </Button>
                        </Card>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
