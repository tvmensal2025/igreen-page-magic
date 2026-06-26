import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { MessageCircle } from "lucide-react";

/**
 * Redirect curto: `igreen.cloud/r/{licenca}/{short_code?}` (e `…?msg=…`).
 *
 * Resolve telefone + frase via edge function `qr-redirect?json=1` e abre o
 * WhatsApp DIRETO via `wa.me` (sem tela intermediária de escolha de app).
 *
 * Garantias:
 *  - Nunca abre WhatsApp sem destinatário (a home do app).
 *  - Se a resolução falhar, manda o cliente pra landing pública do consultor
 *    `/{licenca}` — que já tem botões de WhatsApp configurados como fallback
 *    visível, em vez de uma tela de erro.
 */

const SUPABASE_URL = "https://zlzasfhcxcznaprrragl.supabase.co";
const RESOLVE_TIMEOUT_MS = 4000;

function buildJsonUrl(licenca: string, code: string | undefined, msg: string | null): string {
  const params = new URLSearchParams({ l: licenca, json: "1" });
  if (code) params.set("c", code);
  if (msg) params.set("msg", msg);
  return `${SUPABASE_URL}/functions/v1/qr-redirect?${params.toString()}`;
}

function goToConsultantLanding(licenca: string) {
  // Fallback que NUNCA leva o usuário pra home do WhatsApp.
  // A landing pública do consultor tem botões de contato visíveis.
  window.location.replace(`/${encodeURIComponent(licenca)}`);
}

export default function PartnerRedirectPage() {
  const { licenca, code } = useParams<{ licenca: string; code?: string }>();
  const [searchParams] = useSearchParams();
  const msg = searchParams.get("msg");

  useEffect(() => {
    const lic = (licenca ?? "").trim();
    if (!lic) {
      window.location.replace("/");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);

    (async () => {
      try {
        const res = await fetch(buildJsonUrl(lic, code, msg), {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (cancelled) return;

        const phone = typeof data?.phone === "string" ? data.phone.replace(/\D/g, "") : "";
        const message = typeof data?.message === "string" ? data.message : msg ?? "";

        if (phone && /^\d{10,13}$/.test(phone)) {
          const text = message ? `?text=${encodeURIComponent(message)}` : "";
          window.location.replace(`https://wa.me/${phone}${text}`);
          return;
        }
        // Sem telefone válido → landing do consultor (jamais wa.me sem número).
        goToConsultantLanding(lic);
      } catch {
        if (!cancelled) goToConsultantLanding(lic);
      } finally {
        window.clearTimeout(timeout);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [licenca, code, msg]);

  // Tela mínima enquanto resolve (sub-segundo na maioria dos casos).
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
