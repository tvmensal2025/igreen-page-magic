import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Send, Mic, ImageIcon, Video, FileText } from "lucide-react";

interface StepLike {
  id: string;
  title: string | null;
  step_key: string | null;
  /** Slot de mídia (pode diferir do step_key, ex.: A2). */
  slot_key?: string | null;
  message_text: string | null;
  media_order: unknown;
  variant: string;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  consultantId: string;
  customerId: string;
  step: StepLike | null;
  /** Optional: all available variants for this step (A/B/C). If provided, chips appear in header to switch. */
  variants?: Record<string, StepLike>;
  /** Called when user changes the selected variant via chips. */
  onVariantChange?: (variant: string) => void;
  onSend: (opts?: { continueFlow?: boolean }) => void;
  sending?: boolean;
}

interface MediaItem {
  id: string;
  kind: string;
  url: string;
  duration_sec?: number | null;
  transcript?: string | null;
  label?: string | null;
  send_order?: number | null;
}

interface PreviewCacheEntry {
  medias: MediaItem[];
  renderedText: string;
  skippedAudios: number;
}

const PREVIEW_CACHE = new Map<string, PreviewCacheEntry>();

const VARIANT_HINT: Record<string, string> = {
  A: "com áudio",
  B: "só texto",
  C: "com vídeo",
};

export function CaptureStepPreview({ open, onOpenChange, consultantId, customerId, step, variants, onVariantChange, onSend, sending }: Props) {
  const [medias, setMedias] = useState<MediaItem[]>([]);
  const [renderedText, setRenderedText] = useState("");
  const [loading, setLoading] = useState(false);
  const [skippedAudios, setSkippedAudios] = useState(0);

  const lastLoadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !step) return;
    // Chave do que já carregamos: evita re-fetch e flicker quando o pai
    // recria o objeto `step` a cada render mas o conteúdo é o mesmo.
    const loadKey = `${step.id}|${step.variant}|${customerId}|${consultantId}`;
    if (lastLoadedKeyRef.current === loadKey) return;
    const cached = PREVIEW_CACHE.get(loadKey);
    if (cached) {
      setMedias(cached.medias);
      setRenderedText(cached.renderedText);
      setSkippedAudios(cached.skippedAudios);
      setLoading(false);
      lastLoadedKeyRef.current = loadKey;
      return;
    }
    let mounted = true;
    setLoading(true);
    (async () => {
      const { data: cust } = await supabase
        .from("customers")
        .select("name, electricity_bill_value")
        .eq("id", customerId).maybeSingle();
      const firstName = String(cust?.name || "").trim().split(/\s+/)[0] || "amigo";
      const bill = Number(cust?.electricity_bill_value || 0);
      const fmt = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const billStr = bill > 0 ? fmt(bill) : "___";
      const vars: Record<string, string> = {
        "{{nome}}": firstName, "{nome}": firstName,
        "{{nome_completo}}": String(cust?.name || ""), "{nome_completo}": String(cust?.name || ""),
        "{{valor}}": billStr, "{valor}": billStr,
        "{{valor_conta}}": billStr, "{valor_conta}": billStr,
        "{{conta}}": billStr, "{conta}": billStr,
        "{{economia_mensal}}": fmt(bill * 0.2), "{economia_mensal}": fmt(bill * 0.2),
        "{{economia_anual}}": fmt(bill * 0.2 * 12), "{economia_anual}": fmt(bill * 0.2 * 12),
      };
      const apply = (s: string) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(k).join(v), s);
      const txt = step.message_text ? apply(String(step.message_text)) : "";

      // Preferência: slot_key do passo (A2 = a2_audio_activate_name) → step_key.
      const mediaSlot = String(step.slot_key || step.step_key || "").trim();
      let rows: MediaItem[] = [];
      if (mediaSlot) {
        const { data: mediaRows } = await supabase
          .from("ai_media_library")
          .select("id, kind, url, slot_key, send_order, duration_sec, transcript, label")
          .eq("consultant_id", consultantId)
          .eq("slot_key", mediaSlot)
          .eq("active", true)
          .eq("is_draft", false)
          .order("send_order", { ascending: true });
        rows = ((mediaRows as any[]) || []).filter((m) => !!m?.url);

        // Sofia A2/A3/A5: áudio fica em __body* — preview mostra o corpo.
        if (rows.filter((m) => String(m.kind).toLowerCase() === "audio").length === 0) {
          const { data: bodyRows } = await supabase
            .from("ai_media_library")
            .select("id, kind, url, slot_key, send_order, duration_sec, transcript, label")
            .eq("consultant_id", consultantId)
            .like("slot_key", `${mediaSlot}__body%`)
            .eq("active", true)
            .eq("is_draft", false)
            .order("send_order", { ascending: true });
          const extras = ((bodyRows as any[]) || []).filter((m) => !!m?.url);
          if (extras.length) rows = [...rows, ...extras];
        }
      }

      let skipped = 0;
      if (step.variant === "B") {
        const before = rows.length;
        rows = rows.filter((m) => String(m.kind).toLowerCase() !== "audio");
        skipped = before - rows.length;
      }

      if (!mounted) return;
      PREVIEW_CACHE.set(loadKey, { medias: rows, renderedText: txt, skippedAudios: skipped });
      setMedias(rows);
      setRenderedText(txt);
      setSkippedAudios(skipped);
      setLoading(false);
      lastLoadedKeyRef.current = loadKey;
    })();
    return () => { mounted = false; };
  }, [open, step?.id, step?.variant, step?.step_key, step?.slot_key, step?.message_text, customerId, consultantId]);

  // Reset cache key quando o dialog fecha, pra recarregar na próxima abertura.
  useEffect(() => {
    if (!open) lastLoadedKeyRef.current = null;
  }, [open]);


  if (!step) return null;

  const orderedMedias = (() => {
    const order = Array.isArray(step.media_order) && (step.media_order as string[]).length
      ? (step.media_order as string[]).map((k) => String(k).toLowerCase())
      : ["audio", "image", "video", "text", "document"];
    return [...medias].sort((a, b) => {
      const ia = order.indexOf(a.kind); const ib = order.indexOf(b.kind);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  })();

  const variantKeys = variants ? Object.keys(variants).sort() : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(calc(100vw-2rem),26rem)] max-w-none h-[min(72dvh,620px)] min-h-[420px] overflow-hidden p-0 flex flex-col">
        <DialogHeader className="shrink-0 p-2.5 pb-1.5 border-b border-border space-y-1.5">
          <DialogTitle className="text-xs flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-bold shrink-0">
              V{step.variant}
            </span>
            <span className="truncate">{step.title || step.step_key}</span>
          </DialogTitle>
          {variantKeys.length > 1 && onVariantChange && (
            <div className="flex items-center gap-1">
              {variantKeys.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onVariantChange(v)}
                  className={`px-1.5 h-5 rounded-full text-[10px] font-bold border transition-colors ${
                    v === step.variant
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-foreground border-border hover:border-primary/50"
                  }`}
                  title={VARIANT_HINT[v] || ""}
                >
                  {v}
                </button>
              ))}
              <span className="text-[9px] text-muted-foreground ml-1">{VARIANT_HINT[step.variant]}</span>
            </div>
          )}
        </DialogHeader>

        <div className="relative flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2 bg-muted/20">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 text-muted-foreground gap-2 text-xs">
              <Loader2 className="w-3 h-3 animate-spin" /> Carregando…
            </div>
          )}

          {skippedAudios > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[10px] text-warning">
              ℹ️ Variante B: {skippedAudios} áudio ignorado.
            </div>
          )}

          {orderedMedias.length === 0 && !renderedText && !loading && (
            <p className="text-[11px] text-muted-foreground italic text-center py-4">
              Nenhuma mídia ou texto.
            </p>
          )}

          {orderedMedias.map((m) => {
            const kind = String(m.kind).toLowerCase();
            return (
              <div key={m.id} className="rounded-md bg-card border border-border p-2 space-y-1.5">
                <div className="flex items-center gap-1 text-[9px] text-muted-foreground uppercase font-semibold">
                  {kind === "audio" && <Mic className="w-2.5 h-2.5 text-primary" />}
                  {kind === "image" && <ImageIcon className="w-2.5 h-2.5 text-warning" />}
                  {kind === "video" && <Video className="w-2.5 h-2.5 text-info" />}
                  {kind === "text" && <FileText className="w-2.5 h-2.5" />}
                  {kind}
                </div>
                {kind === "audio" && m.url && (
                  <audio src={m.url} controls className="w-full h-8" />
                )}
                {kind === "image" && m.url && (
                  <img src={m.url} alt={m.label || "preview"} className="w-full rounded-md max-h-40 object-contain bg-muted" loading="lazy" decoding="async" />
                )}
                {kind === "video" && m.url && (
                  <video src={m.url} controls className="w-full rounded-md max-h-40 bg-muted" preload="metadata" />
                )}
              </div>
            );
          })}

          {renderedText && (
            <div className="rounded-md bg-primary text-primary-foreground p-2 ml-4 shadow-sm">
              <p className="text-[12px] whitespace-pre-wrap leading-snug">{renderedText}</p>
            </div>
          )}
        </div>

        <div className="shrink-0 p-2 border-t border-border bg-card space-y-1.5">
          <Button
            className="w-full h-9 gap-1.5 font-bold text-xs"
            onClick={() => onSend({ continueFlow: false })}
            disabled={sending}
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Enviar este passo ({step.variant})
          </Button>
          <p className="text-[9px] text-center text-muted-foreground leading-tight">
            Envia apenas este passo. O próximo só vai quando você clicar de novo.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
