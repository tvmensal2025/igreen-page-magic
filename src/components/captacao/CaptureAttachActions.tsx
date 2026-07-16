import { useState } from "react";
import { IdCard, Loader2, Zap, Receipt } from "lucide-react";
import type { CaptureDocKey } from "@/hooks/useCaptureAttach";

const ACTIONS: { key: CaptureDocKey; label: string; icon: "zap" | "id" | "receipt"; short: string }[] = [
  { key: "electricity_bill_photo_url", label: "Conta de Energia", short: "Conta", icon: "zap" },
  { key: "document_front_url", label: "RG/CNH Frente", short: "Frente", icon: "id" },
  { key: "document_back_url", label: "RG/CNH Verso", short: "Verso", icon: "id" },
  { key: "electricity_boleto_photo_url", label: "Boleto Bancário", short: "Boleto", icon: "receipt" },
];

interface Props {
  onAttach: (key: CaptureDocKey) => Promise<void> | void;
  /** dark = bolha WhatsApp-dark da Captação; light = bolha do chat WhatsApp */
  tone?: "dark" | "light";
  compact?: boolean;
  /** Se false, esconde o atalho de boleto */
  showBoleto?: boolean;
}

export function CaptureAttachActions({
  onAttach,
  tone = "light",
  compact = false,
  showBoleto = true,
}: Props) {
  const [busy, setBusy] = useState<CaptureDocKey | null>(null);

  const handle = async (key: CaptureDocKey) => {
    if (busy) return;
    setBusy(key);
    try {
      await onAttach(key);
    } finally {
      setBusy(null);
    }
  };

  const items = ACTIONS.filter((a) => showBoleto || a.key !== "electricity_boleto_photo_url");
  const dark = tone === "dark";

  return (
    <div className={`flex flex-wrap gap-1 ${compact ? "mt-1" : "mt-1.5"}`}>
      {items.map((a) => {
        const Icon = a.icon === "zap" ? Zap : a.icon === "receipt" ? Receipt : IdCard;
        const isBusy = busy === a.key;
        return (
          <button
            key={a.key}
            type="button"
            disabled={!!busy}
            title={`Usar como ${a.label}`}
            onClick={() => void handle(a.key)}
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition disabled:opacity-50 ${
              dark
                ? "bg-white/10 hover:bg-emerald-500/30 text-white/90 border border-white/10"
                : "bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20"
            }`}
          >
            {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icon className="w-3 h-3" />}
            {compact ? a.short : a.label}
          </button>
        );
      })}
    </div>
  );
}
