import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { buildPartnerWaRedirectUrl } from "@/lib/partnerShortLink";

/**
 * Compatibilidade com QR/links antigos `igreen.cloud/r/{ref}/{code}`.
 *
 * NÃO resolve no browser: manda na hora pra edge `qr-redirect`, que faz
 * HTTP 302 → wa.me (abre WhatsApp/Business no celular, sem site).
 * O `index.html` já redireciona antes do React; isto é fallback.
 */

export default function PartnerRedirectPage() {
  const { licenca, code } = useParams<{ licenca: string; code?: string }>();
  const [searchParams] = useSearchParams();
  const msg = searchParams.get("msg");
  const keyword = searchParams.get("k");

  useEffect(() => {
    const lic = (licenca ?? "").trim();
    if (!lic) {
      window.location.replace("/");
      return;
    }
    // 302 real na edge → wa.me (sem fetch JSON, sem página de escolha).
    window.location.replace(
      buildPartnerWaRedirectUrl(lic, code, msg, keyword),
    );
  }, [licenca, code, msg, keyword]);

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 flex items-center justify-center">
            <MessageCircle className="w-7 h-7 text-emerald-600" />
          </div>
          <div className="absolute inset-0 rounded-2xl bg-emerald-500/10 animate-ping" />
        </div>
        <p className="text-sm text-muted-foreground">Abrindo o WhatsApp…</p>
      </div>
    </div>
  );
}
