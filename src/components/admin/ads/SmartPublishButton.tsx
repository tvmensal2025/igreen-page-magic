import { useState } from "react";
import { AdsButton } from "./AdsButton";
import { Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import { smartPublish } from "@/services/smartPublish";
import { AdTemplate } from "@/services/adTemplates";

interface Props {
  template: AdTemplate;
  consultantId: string;
  onPublished?: () => void;
  onFallback?: (template: AdTemplate) => void;
}

export function SmartPublishButton({ template, consultantId, onPublished, onFallback }: Props) {
  const [loading, setLoading] = useState(false);
  const [stepLabel, setStepLabel] = useState("");

  async function handleClick() {
    setLoading(true);
    setStepLabel("");
    const toastId = toast.loading("Iniciando publicação inteligente...");
    try {
      const r = await smartPublish({
        template,
        consultantId,
        onProgress: (p) => {
          setStepLabel(p.label);
          toast.loading(p.label, { id: toastId });
        },
      });
      toast.success(
        `Campanha publicada em ${r.preset.nome} (${r.cities.map((c) => c.name).join(", ")})`,
        { id: toastId, description: "Em revisão pelo Facebook." }
      );
      onPublished?.();
    } catch (e: any) {
      const msg = String(e?.message || "");
      const nextSteps: string[] = Array.isArray(e?.next_steps) ? e.next_steps : [];
      const tried: string[] = Array.isArray(e?.detected_paths_tried) ? e.detected_paths_tried : [];
      const isTargeting = msg.includes("META_TARGETING_INVALID") || msg.includes("1487079") || /targeting_relaxation/i.test(msg);
      const isWaba = msg.includes("WHATSAPP_BUSINESS_REQUIRED") || msg.includes("conta pessoal") || msg.includes("2446885") || msg.includes("1487246") || /not linked to your account/i.test(msg);
      if (isTargeting) {
        toast.error("Configuração de público rejeitada pela Meta", {
          id: toastId,
          duration: 14000,
          description: "A plataforma removeu o campo de segmentação que a Meta recusou. Recarregue a página e publique novamente.",
        });
      } else if (isWaba) {
        const stepsTxt = nextSteps.length ? "\n\nPróximos passos:\n• " + nextSteps.join("\n• ") : "";
        const triedTxt = tried.length ? `\n\nCaminhos testados na Graph: ${tried.join(", ")}` : "";
        const baseMsg = msg.replace(/^\[[^\]]+\]\s*/, "") || "A Meta rejeitou o número WABA.";
        toast.error("WhatsApp Business não encontrado para esta Página", {
          id: toastId,
          duration: 20000,
          description: baseMsg + stepsTxt + triedTxt,
        });
      } else {
        toast.error("Não consegui publicar automaticamente", {
          id: toastId,
          description: `${msg || "Tente o modo personalizado."}`,
        });
      }
      onFallback?.(template);
    } finally {
      setLoading(false);
      setStepLabel("");
    }
  }

  return (
    <AdsButton
      variant="primary"
      size="sm"
      onClick={handleClick}
      disabled={loading}
      className="w-full"
    >
      {loading ? (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span className="truncate">{stepLabel || "Publicando..."}</span>
        </>
      ) : (
        <>
          <Zap className="w-3.5 h-3.5" /> Publicar inteligente
        </>
      )}
    </AdsButton>
  );
}
