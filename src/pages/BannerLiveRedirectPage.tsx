import { useEffect } from "react";
import { useParams, Navigate } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { QR_REDIRECT_BASE } from "@/lib/partnerShortLink";
import { BANNER_INITIALS_RESERVED } from "@/lib/consultantBannerLink";

/**
 * Fallback SPA do banner vivo: /{iniciais}/{igreenId}/{spot?}
 * O index.html já redireciona antes do React; isto cobre cache antigo / bot.
 */
export default function BannerLiveRedirectPage() {
  const { initials, igreenId, spot } = useParams<{
    initials: string;
    igreenId: string;
    spot?: string;
  }>();

  const ini = String(initials || "").toLowerCase();
  const id = String(igreenId || "").replace(/\D/g, "");
  const validIni =
    /^[a-z]{2,8}$/.test(ini) && !BANNER_INITIALS_RESERVED.has(ini);
  const validId = id.length >= 3 && id === String(igreenId || "").trim();
  const spotOk =
    !spot || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(spot).toLowerCase());

  useEffect(() => {
    if (!validIni || !validId || !spotOk) return;
    const u = new URL(QR_REDIRECT_BASE);
    u.searchParams.set("ig", id);
    const s = String(spot || "").trim().toLowerCase();
    if (s) u.searchParams.set("s", s);
    window.location.replace(u.toString());
  }, [id, spot, validIni, validId, spotOk]);

  if (!validIni || !validId || !spotOk) {
    return <Navigate to="/" replace />;
  }

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
