import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Camera, Loader2, RefreshCw, FileImage } from "lucide-react";
import { fireRandomCelebration } from "@/lib/captureGame";

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
  compact?: boolean;
}

export function CaptureDocumentTiles({ customerId, customer, onUploaded, compact = false }: Props) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<DocKey | null>(null);
  const inputs = useRef<Record<DocKey, HTMLInputElement | null>>({
    document_front_url: null,
    document_back_url: null,
    electricity_bill_photo_url: null,
    electricity_boleto_photo_url: null,
  });

  const wantsBoletoUnico = customer?.contaunica_answered === true && customer?.contaunica === true;
  const slots = wantsBoletoUnico ? [...BASE_SLOTS, BOLETO_SLOT] : BASE_SLOTS;
  const gridCols = slots.length === 4 ? "grid-cols-4" : "grid-cols-3";

  const triggerOcr = async (key: DocKey) => {
    // bill OU doc — reprocessa OCR sobre a URL já salva e preenche campos do customer.
    const kind = key === "electricity_bill_photo_url" ? "bill" : "doc";
    try {
      const { error } = await supabase.functions.invoke("reprocess-capture", {
        body: { customerId, kind },
      });
      if (error) throw error;
      toast({ title: "🤖 Dados capturados", description: "Confira na lateral", duration: 2000 });
    } catch (e: any) {
      console.warn("[reprocess-capture] falhou:", e?.message || e);
      // silencioso — upload já foi salvo, OCR é best-effort.
    }
  };

  const handleFile = async (key: DocKey, file: File) => {
    setBusy(key);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `captacao/${customerId}/${key}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("whatsapp-media")
        .upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("whatsapp-media").getPublicUrl(path);
      await onUploaded(key, pub.publicUrl);
      fireRandomCelebration();
      toast({ title: "📎 Documento anexado", duration: 1500 });
      // Dispara OCR automático em background — preenche valor/CEP/endereço/nome.
      void triggerOcr(key);
    } catch (e: any) {
      toast({ title: "Erro no upload", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={compact ? "px-1.5 pt-1 pb-1.5" : "px-2 pb-2 pt-1.5"}>
      <h4 className={`font-bold uppercase tracking-wider text-muted-foreground ${compact ? "text-[8px] mb-0.5" : "text-[9px] mb-1"}`}>
        Documentos
      </h4>
      <div className={`grid ${gridCols} gap-1`}>
        {slots.map((s) => {
          const url = customer?.[s.key] as string | null;
          const isBusy = busy === s.key;
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
                ) : url ? (
                  url.toLowerCase().endsWith(".pdf") ? (
                    <FileImage className="w-4 h-4 text-primary" />
                  ) : (
                    <img src={url} alt={s.label} className="w-full h-full object-cover" />
                  )
                ) : (
                  <Camera className="w-4 h-4 text-muted-foreground/60" />
                )}
                {url && !isBusy && (
                  <span className="absolute bottom-0.5 right-0.5 bg-background/80 backdrop-blur rounded-full p-0.5">
                    <RefreshCw className="w-2 h-2 text-primary" />
                  </span>
                )}
              </button>
              <p className={`font-semibold text-center leading-tight truncate ${compact ? "text-[7px]" : "text-[9px]"}`}>{s.label}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
