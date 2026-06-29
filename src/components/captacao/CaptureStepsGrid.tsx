import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Send, Loader2, Check, MessageCircle, Mic, ImageIcon, Video, Edit3, Eye } from "lucide-react";
import { normalizeSendStepError } from "@/lib/whatsapp/send";
import { CaptureStepPreview } from "./CaptureStepPreview";

interface Props {
  consultantId: string;
  customerId: string;
  /** Variante A/B/C do lead — filtra o fluxo certo */
  variant?: "A" | "B" | "C" | "D" | "E";
  /** Map stepId -> "sent" | "responded" status */
  sentSteps: Set<string>;
  onSent: (stepId: string) => void;
  onEditTemplate?: (stepKey: string, text: string) => void;
}

interface StepRow {
  id: string;
  title: string | null;
  step_key: string | null;
  position: number;
  message_text: string | null;
  step_type?: string | null;
  media_order?: unknown;
  has_audio?: boolean;
  has_image?: boolean;
  has_video?: boolean;
  /** quando true, este é um tile sintético (não existe em bot_flow_steps) */
  __synthetic?: boolean;
}

const SYNTHETIC_EMAIL: StepRow = {
  id: "__synth_ask_email",
  title: "E-mail do cliente",
  step_key: "ask_email",
  position: 98,
  message_text: "📧 Qual o seu melhor e-mail?\n\n_Para liberar o acesso ao app iGreen Club 📱_",
  step_type: "capture_email",
  __synthetic: true,
};
const SYNTHETIC_CONFIRM_PHONE: StepRow = {
  id: "__synth_confirm_phone",
  title: "Confirmar telefone",
  step_key: "ask_phone_confirm",
  position: 99,
  message_text: "📞 Esse é o seu telefone de contato? [botões: Sim / Outro número]",
  step_type: "confirm_phone",
  __synthetic: true,
};

export function CaptureStepsGrid({ consultantId, customerId, variant = "A", sentSteps, onSent, onEditTemplate }: Props) {
  const { toast } = useToast();
  const [sending, setSending] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [previewStep, setPreviewStep] = useState<StepRow | null>(null);
  const [customerFirstName, setCustomerFirstName] = useState<string>("amigo");
  const [billStr, setBillStr] = useState<string>("___");

  // Objeto estável p/ o Dialog — só muda quando o passo ou variante muda,
  // evitando que a CaptureStepPreview entre em loop de loading.
  const previewStepForDialog = useMemo(() => {
    if (!previewStep) return null;
    return {
      id: previewStep.id,
      title: previewStep.title,
      step_key: previewStep.step_key,
      message_text: previewStep.message_text,
      media_order: previewStep.media_order ?? null,
      variant,
    };
  }, [previewStep, variant]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: flows } = await supabase
        .from("bot_flows").select("id, variant")
        .eq("consultant_id", consultantId).eq("is_active", true)
        .order("variant", { ascending: true });
      const list = (flows as any[]) || [];
      const flow = list.find((f) => String(f.variant) === variant) || list[0];
      if (!flow) { if (mounted) setSteps([]); return; }
      const { data } = await supabase
        .from("bot_flow_steps")
        .select("id, title, step_key, position, message_text, step_type, media_order")
        .eq("flow_id", flow.id)
        .eq("is_active", true)
        .order("position", { ascending: true })
        .limit(20);
      const rows = ((data as StepRow[]) || []);

      // Check media library for each step's slot_key to light up icons
      const slotKeys = rows.map((r) => r.step_key).filter(Boolean) as string[];
      const mediaMap: Record<string, { audio: boolean; image: boolean; video: boolean }> = {};
      if (slotKeys.length) {
        const { data: medias } = await supabase
          .from("ai_media_library")
          .select("kind, slot_key")
          .eq("consultant_id", consultantId)
          .in("slot_key", slotKeys)
          .eq("active", true)
          .eq("is_draft", false);
        for (const m of (medias as any[]) || []) {
          const k = m.slot_key as string;
          if (!mediaMap[k]) mediaMap[k] = { audio: false, image: false, video: false };
          const kind = String(m.kind).toLowerCase();
          if (kind === "audio") mediaMap[k].audio = true;
          if (kind === "image") mediaMap[k].image = true;
          if (kind === "video") mediaMap[k].video = true;
        }
      }
      const enriched = rows.map((r) => ({
        ...r,
        has_audio: !!(r.step_key && mediaMap[r.step_key]?.audio && variant !== "B"),
        has_image: !!(r.step_key && mediaMap[r.step_key]?.image),
        has_video: !!(r.step_key && mediaMap[r.step_key]?.video),
      }));

      const hasEmail = enriched.some((r) => r.step_type === "capture_email" || r.step_key === "ask_email");
      const hasConfirm = enriched.some((r) => r.step_type === "confirm_phone" || r.step_key === "ask_phone_confirm");
      const merged: StepRow[] = [...enriched.slice(0, 10)];
      if (!hasEmail) merged.push(SYNTHETIC_EMAIL);
      if (!hasConfirm) merged.push(SYNTHETIC_CONFIRM_PHONE);
      if (mounted) setSteps(merged);
    })();
    return () => { mounted = false; };
  }, [consultantId, variant]);

  // Load customer name + bill for variable rendering in inline preview
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("customers")
        .select("name, electricity_bill_value")
        .eq("id", customerId)
        .maybeSingle();
      if (!mounted) return;
      const first = String((data as any)?.name || "").trim().split(/\s+/)[0] || "amigo";
      setCustomerFirstName(first);
      const bill = Number((data as any)?.electricity_bill_value || 0);
      setBillStr(bill > 0
        ? bill.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : "___");
    })();
    return () => { mounted = false; };
  }, [customerId]);

  const renderVars = useMemo(() => {
    return (s: string | null) => {
      if (!s) return "";
      const vars: Record<string, string> = {
        "{{nome}}": customerFirstName, "{nome}": customerFirstName,
        "{{valor}}": billStr, "{valor}": billStr,
        "{{valor_conta}}": billStr, "{valor_conta}": billStr,
        "{{conta}}": billStr, "{conta}": billStr,
      };
      return Object.entries(vars).reduce((acc, [k, v]) => acc.split(k).join(v), s);
    };
  }, [customerFirstName, billStr]);

  const display = steps;
  const nextUnsentIdx = display.findIndex((s) => !sentSteps.has(s.id));

  const doSend = async (step: StepRow, label: string, opts?: { continueFlow?: boolean }) => {
    if (sending) return;
    setSending(step.id);
    try {
      const payload: any = {
        consultantId,
        customerId,
        part: "all",
        continueFlow: opts?.continueFlow ?? false,
        variant,
      };
      if (step.__synthetic) payload.stepKey = step.step_key;
      else payload.stepId = step.id;
      const { data, error } = await supabase.functions.invoke("manual-step-send", { body: payload });
      if (error || (data as any)?.error || (data as any)?.ok === false) {
        const parsed = normalizeSendStepError(error, data);
        throw new Error(parsed.message);
      }
      onSent(step.id);
      setPreviewStep(null);
      toast({ title: "Passo enviado ✓", description: label });
    } catch (e: any) {
      toast({ title: "Erro ao enviar", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSending(null);
    }
  };

  const loadTemplate = async (stepId: string, stepKey: string | null) => {
    if (stepId.startsWith("__synth_")) { onEditTemplate?.(stepKey || "", ""); return; }
    const { data } = await supabase.from("bot_flow_steps").select("message_text").eq("id", stepId).maybeSingle();
    onEditTemplate?.(stepKey || stepId, (data as any)?.message_text || "");
  };

  if (display.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground border border-dashed border-border rounded-lg">
        Nenhum passo de fluxo configurado. Configure seu fluxo em <span className="font-semibold">/admin/fluxos</span> para usar como templates aqui.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="font-bold uppercase tracking-wide text-muted-foreground">Passos · clique para enviar</span>
          <span className="tabular-nums font-bold text-primary">{sentSteps.size}/{display.length}</span>
        </div>
        <div className="h-0.5 rounded-full bg-secondary overflow-hidden">
          <div className="h-full bg-gradient-to-r from-primary to-primary transition-all duration-500"
               style={{ width: `${Math.round((sentSteps.size / Math.max(display.length, 1)) * 100)}%` }} />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(84px,1fr))] 2xl:grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-1 capture-card-flip">
          {display.map((s: StepRow, i: number) => {
            const sent = sentSteps.has(s.id);
            const isSending = sending === s.id;
            const isNext = i === nextUnsentIdx;
            const inlinePreview = renderVars(s.message_text).trim();
            return (
              <div
                key={s.id}
                className={`group relative rounded-md border p-1 flex flex-col h-full min-h-[72px] ${
                  sent
                    ? "border-primary/60 bg-gradient-to-br from-primary/15 to-primary/5 shadow-[0_0_10px_hsl(var(--primary)/0.18)]"
                    : isNext
                        ? "border-primary bg-card hover:border-primary/80 hover:shadow-lg ring-1 ring-primary/30"
                        : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <div className="flex items-center gap-1 mb-1">
                  <span className={`text-[9px] font-black tabular-nums px-1 py-px rounded ${sent ? "bg-primary text-primary-foreground" : "bg-secondary text-primary"}`}>P{s.position}</span>
                  <div className="flex items-center gap-0.5 ml-auto">
                    <Mic className={`w-2.5 h-2.5 ${s.has_audio ? "text-primary" : "text-muted-foreground/25"}`} />
                    <ImageIcon className={`w-2.5 h-2.5 ${s.has_image ? "text-warning" : "text-muted-foreground/25"}`} />
                    <Video className={`w-2.5 h-2.5 ${s.has_video ? "text-info" : "text-muted-foreground/25"}`} />
                    {sent && <Check className="w-3 h-3 text-primary drop-shadow-[0_0_4px_hsl(var(--primary))] ml-0.5" />}
                  </div>
                </div>
                <p className="text-[10.5px] font-semibold leading-tight line-clamp-2 break-words">
                  {s.title || s.step_key || "Passo"}
                </p>
                {inlinePreview && (
                  <p
                    className="mt-0.5 text-[9px] leading-snug text-muted-foreground/70 line-clamp-1 italic break-words"
                    title={inlinePreview}
                  >
                    {inlinePreview}
                  </p>
                )}
                <div className="mt-auto pt-1 flex items-center gap-0.5">
                  <Button
                    size="sm"
                    variant={sent ? "outline" : "default"}
                    className="h-6 px-1.5 text-[9px] flex-1 min-w-0"
                    onClick={() => setPreviewStep(s)}
                    disabled={isSending}
                    aria-busy={isSending}
                    title={sent ? "Reenviar" : "Ver e enviar"}
                  >
                    {isSending ? (
                      <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                    ) : (
                      <>
                        <Eye className="w-3 h-3 xl:mr-1 shrink-0" />
                        <span className="hidden xl:inline truncate">{sent ? "Reenviar" : "Ver e enviar"}</span>
                      </>
                    )}
                  </Button>
                  {onEditTemplate && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 shrink-0"
                      onClick={() => void loadTemplate(s.id, s.step_key)}
                      title="Editar antes de enviar"
                    >
                      <Edit3 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

      </div>

      {previewStep && (
        <CaptureStepPreview
          open={!!previewStep}
          onOpenChange={(o) => { if (!o) setPreviewStep(null); }}
          consultantId={consultantId}
          customerId={customerId}
          step={previewStepForDialog}
          onSend={(opts) =>
            doSend(previewStep, previewStep.title || previewStep.step_key || `Passo ${previewStep.position}`, opts)
          }
          sending={sending === previewStep.id}
        />
      )}
    </>
  );
}
