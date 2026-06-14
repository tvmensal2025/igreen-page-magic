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
      const isWaba = msg.includes("WHATSAPP_BUSINESS_REQUIRED") || msg.includes("conta pessoal") || msg.includes("2446885");
      if (isWaba) {
        toast.error("WhatsApp Business (WABA) obrigatório", {
          id: toastId,
          duration: 12000,
          description:
            "O número precisa estar oficialmente conectado à sua Página no Meta Business Suite → WhatsApp Manager. Sem WABA, o anúncio CTWA oficial não publica. Acesse business.facebook.com/wa/manage/phone-numbers/ para conectar.",
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
