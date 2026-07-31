import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Camera, Loader2, RefreshCw, FileImage, Paperclip } from "lucide-react";
import { fireRandomCelebration } from "@/lib/captureGame";
import { resolveStorageDisplayUrl } from "@/lib/captacao/storageDisplayUrl";
import { useCaptureAttach, type CaptureDocKey } from "@/hooks/useCaptureAttach";

type DocKey =
  | "document_front_url"
  | "document_back_url"
  | "electricity_bill_photo_url"
  | "electricity_boleto_photo_url";

interface DocSlot {
  key: DocKey;
  label: string;
  hint: string;
}

const BASE_SLOTS: DocSlot[] = [
  { key: "document_front_url", label: "RG/CNH Frente", hint: "Foto nítida da frente" },
  { key: "document_back_url", label: "RG/CNH Verso", hint: "Foto nítida do verso" },
  { key: "electricity_bill_photo_url", label: "Conta de Energia", hint: "Foto ou PDF da fatura" },
];

// Slot extra obrigatório quando o cliente marcou "boleto único" no bot/ficha
// (contaunica=true). O portal iGreen valida esse anexo esperando comprovante
// bancário, não a fatura da distribuidora.
const BOLETO_SLOT: DocSlot = {
  key: "electricity_boleto_photo_url",
  label: "Boleto Bancário",
  hint: "Comprovante do boleto único",
};

interface Props {
  customerId: string;
  customer: Record<string, any>;
  onUploaded: (key: DocKey, url: string) => Promise<void> | void;
  /** Chamado após OCR gravar campos — para refrescar a ficha. */
  onOcrDone?: () => void;
  compact?: boolean;
}

export function CaptureDocumentTiles({
  customerId,
  customer,
  onUploaded,
  onOcrDone,
  compact = false,
}: Props) {
  const { toast } = useToast();
  const { attachMediaToCapture } = useCaptureAttach();
  const [busy, setBusy] = useState<DocKey | null>(null);
  const [ocrBusy, setOcrBusy] = useState<DocKey | null>(null);
  const [displayUrls, setDisplayUrls] = useState<Partial<Record<DocKey, string>>>({});
  const [lastInboundUrl, setLastInboundUrl] = useState<string | null>(null);
  const [lastInboundKind, setLastInboundKind] = useState<string | null>(null);
  const inputs = useRef<Record<DocKey, HTMLInputElement | null>>({
    document_front_url: null,
    document_back_url: null,
    electricity_bill_photo_url: null,
    electricity_boleto_photo_url: null,
  });

  const wantsBoletoUnico = customer?.contaunica_answered === true && customer?.contaunica === true;
  const slots = wantsBoletoUnico ? [...BASE_SLOTS, BOLETO_SLOT] : BASE_SLOTS;
  const gridCols = slots.length === 4 ? "grid-cols-4" : "grid-cols-3";

  // Última mídia recebida no chat — atalho "usar do WhatsApp"
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const fromCustomer = customer?.last_inbound_media_url as string | null | undefined;
      if (fromCustomer) {
        if (!cancelled) {
          setLastInboundUrl(fromCustomer);
          setLastInboundKind((customer?.last_inbound_media_kind as string | null) || null);
        }
        return;
      }
      const { data } = await supabase
        .from("customers")
        .select("last_inbound_media_url, last_inbound_media_kind")
        .eq("id", customerId)
        .maybeSingle();
      if (cancelled || !data) return;
      setLastInboundUrl((data as any).last_inbound_media_url || null);
      setLastInboundKind((data as any).last_inbound_media_kind || null);
    };
    void run();
    return () => { cancelled = true; };
  }, [customerId, customer?.last_inbound_media_url, customer?.last_inbound_media_kind]);

  // Bucket privado: assina URLs para thumbnail na ficha.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const next: Partial<Record<DocKey, string>> = {};
      await Promise.all(
        slots.map(async (s) => {
          const raw = customer?.[s.key] as string | null;
          if (!raw) return;
          next[s.key] = (await resolveStorageDisplayUrl(raw)) || raw;
        }),
      );
      if (!cancelled) setDisplayUrls(next);
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slots deriva de contaunica
  }, [
    customer?.document_front_url,
    customer?.document_back_url,
    customer?.electricity_bill_photo_url,
    customer?.electricity_boleto_photo_url,
    wantsBoletoUnico,
  ]);

  const triggerOcr = async (key: DocKey) => {
    // Boleto bancário não tem OCR de conta/doc — só anexa.
    if (key === "electricity_boleto_photo_url") return;
    const kind = key === "electricity_bill_photo_url" ? "bill" : "doc";
    // Verso sozinho: OCR de doc precisa da frente já salva.
    if (key === "document_back_url" && !customer?.document_front_url) {
      toast({
        title: "Anexe a frente primeiro",
        description: "O OCR do documento usa frente + verso",
        duration: 2500,
      });
      return;
    }
    setOcrBusy(key);
    try {
      const { data, error } = await supabase.functions.invoke("reprocess-capture", {
        body: { customerId, kind },
      });
      if (error) throw error;
      if (data && data.ok === false) {
        const detail = data.detail || data.error || "falha";
        toast({
          title: "Não consegui ler o documento",
          description: String(detail).slice(0, 120),
          variant: "destructive",
          duration: 3500,
        });
        return;
      }
      toast({ title: "🤖 Dados preenchidos na ficha", duration: 2200 });
      onOcrDone?.();
    } catch (e: any) {
      console.warn("[reprocess-capture] falhou:", e?.message || e);
      toast({
        title: "OCR falhou",
        description: e?.message || "Tente anexar de novo",
        variant: "destructive",
        duration: 3000,
      });
    } finally {
      setOcrBusy(null);
    }
  };

  const handleFile = async (key: DocKey, file: File) => {
    setBusy(key);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const { url: storedUrl } = await uploadCaptureDoc({
        customerId,
        slot: key,
        file,
        fileName: file.name,
        ext,
      });
      await onUploaded(key, storedUrl);
      // Preview imediato (signed URL quando for bucket privado do Supabase).
      const signed = await resolveStorageDisplayUrl(storedUrl);
      if (signed) setDisplayUrls((prev) => ({ ...prev, [key]: signed }));

      fireRandomCelebration();
      toast({ title: "📎 Documento anexado", description: "Extraindo dados…", duration: 1800 });
      // OCR automático — preenche valor/CEP/endereço/nome/CPF na ficha.
      await triggerOcr(key);
    } catch (e: any) {
      toast({ title: "Erro no upload", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const attachLastFromChat = async (key: DocKey) => {
    if (!lastInboundUrl) {
      toast({ title: "Nenhuma mídia recente no chat", variant: "destructive", duration: 2500 });
      return;
    }
    if (lastInboundKind === "audio" || lastInboundKind === "video") {
      toast({
        title: "Última mídia não é foto/PDF",
        description: "Peça uma imagem ou documento da conta/RG",
        variant: "destructive",
        duration: 3000,
      });
      return;
    }
    setBusy(key);
    try {
      const url = await attachMediaToCapture({
        customerId,
        key: key as CaptureDocKey,
        sourceUrl: lastInboundUrl,
      });
      if (url) {
        await onUploaded(key, url);
        const signed = await resolveStorageDisplayUrl(url);
        if (signed) setDisplayUrls((prev) => ({ ...prev, [key]: signed }));
        fireRandomCelebration();
        onOcrDone?.();
      }
    } catch {
      // toast já veio do hook
    } finally {
      setBusy(null);
    }
  };

  const canUseLastChat = !!lastInboundUrl && lastInboundKind !== "audio" && lastInboundKind !== "video";

  return (
    <section className={compact ? "px-1.5 pt-1 pb-1.5" : "px-2 pb-2 pt-1.5"}>
      <h4 className={`font-bold uppercase tracking-wider text-muted-foreground ${compact ? "text-[8px] mb-0.5" : "text-[9px] mb-1"}`}>
        Documentos
        {ocrBusy && (
          <span className="ml-1.5 normal-case tracking-normal font-medium text-primary animate-pulse">
            lendo…
          </span>
        )}
        {canUseLastChat && (
          <span className="ml-1.5 normal-case tracking-normal font-medium text-emerald-600">
            · mídia no chat
          </span>
        )}
      </h4>
      <div className={`grid ${gridCols} gap-1`}>
        {slots.map((s) => {
          const url = customer?.[s.key] as string | null;
          const display = displayUrls[s.key] || url;
          const isBusy = busy === s.key || ocrBusy === s.key;
          return (
            <div
              key={s.key}
              className={`rounded-md border flex flex-col gap-0.5 transition-all p-1 ${
                url ? "border-primary/40 bg-primary/5" : "border-dashed border-border bg-card/50"
              }`}
            >
              <input
                ref={(el) => (inputs.current[s.key] = el)}
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(s.key, f);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={isBusy}
                onClick={() => inputs.current[s.key]?.click()}
                className={`relative w-full rounded-md overflow-hidden bg-secondary/40 border border-border/50 flex items-center justify-center active:scale-95 transition ${
                  compact ? "h-9" : "h-11"
                }`}
              >
                {isBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                ) : display ? (
                  display.toLowerCase().includes(".pdf") || display.toLowerCase().includes("application/pdf") ? (
                    <FileImage className="w-4 h-4 text-primary" />
                  ) : (
                    <img src={display} alt={s.label} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  )
                ) : (
                  <Camera className="w-4 h-4 text-muted-foreground/60" />
                )}
                {url && !isBusy && s.key !== "electricity_boleto_photo_url" && (
                  <span
                    role="button"
                    title="Reextrair dados (OCR)"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void triggerOcr(s.key);
                    }}
                    className="absolute bottom-0.5 right-0.5 bg-background/80 backdrop-blur rounded-full p-0.5 hover:bg-primary/20"
                  >
                    <RefreshCw className="w-2 h-2 text-primary" />
                  </span>
                )}
              </button>
              <p className={`font-semibold text-center leading-tight truncate ${compact ? "text-[7px]" : "text-[9px]"}`}>{s.label}</p>
              {canUseLastChat && (
                <button
                  type="button"
                  disabled={isBusy}
                  title="Usar última foto/PDF recebida no WhatsApp"
                  onClick={() => void attachLastFromChat(s.key)}
                  className="inline-flex items-center justify-center gap-0.5 rounded text-[8px] font-semibold text-primary hover:bg-primary/10 py-0.5 disabled:opacity-50"
                >
                  <Paperclip className="w-2.5 h-2.5" />
                  Do chat
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
