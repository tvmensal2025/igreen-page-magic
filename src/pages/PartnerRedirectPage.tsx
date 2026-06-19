import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { MessageCircle, Briefcase } from "lucide-react";

/**
 * Redirect do link curto de parceiro: `igreen.cloud/r/{licenca}/{short_code}`.
 *
 * Resolve telefone+frase via edge function `qr-redirect?json=1` e mostra ao
 * cliente uma escolha entre WhatsApp e WhatsApp Business. Em dispositivos
 * que só têm um dos dois instalados, qualquer botão funciona (o sistema
 * direciona pro app instalado).
 */

const SUPABASE_URL = "https://zlzasfhcxcznaprrragl.supabase.co";

function buildJsonTarget(licenca: string | undefined, code: string | undefined): string {
  const lic = (licenca ?? "").trim();
  const params = new URLSearchParams({ l: lic, json: "1" });
  const c = (code ?? "").trim();
  if (c) params.set("c", c);
  return `${SUPABASE_URL}/functions/v1/qr-redirect?${params.toString()}`;
}

function fallbackRedirect(licenca: string | undefined, code: string | undefined) {
  const lic = (licenca ?? "").trim();
  const params = new URLSearchParams({ l: lic });
  const c = (code ?? "").trim();
  if (c) params.set("c", c);
  window.location.replace(`${SUPABASE_URL}/functions/v1/qr-redirect?${params.toString()}`);
}

interface Resolved {
  phone: string;
  message: string;
}

export default function PartnerRedirectPage() {
  const { licenca, code } = useParams<{ licenca: string; code?: string }>();
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(buildJsonTarget(licenca, code), { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (data?.phone && data?.message) {
          const phone = String(data.phone);
          const message = String(data.message);
          setResolved({ phone, message });
          // Redireciona direto pro WhatsApp — wa.me abre o app instalado (normal ou Business)
          // sem mostrar a tela de escolha. Usuário cai direto na conversa.
          window.location.replace(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`);
        } else {
          fallbackRedirect(licenca, code);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
          fallbackRedirect(licenca, code);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [licenca, code]);

  const openWhatsApp = (kind: "default" | "business") => {
    if (!resolved) return;
    const { phone, message } = resolved;
    const text = encodeURIComponent(message);
    if (kind === "business") {
      // Tenta abrir Business; se não tiver, cai pro wa.me.
      const businessUrl = `whatsapp-business://send?phone=${phone}&text=${text}`;
      const fallback = `https://wa.me/${phone}?text=${text}`;
      // Truque: dispara o scheme e seta um timer pra cair no wa.me caso o app não exista.
      const start = Date.now();
      window.location.href = businessUrl;
      window.setTimeout(() => {
        if (Date.now() - start < 2000 && document.visibilityState === "visible") {
          window.location.href = fallback;
        }
      }, 1200);
      return;
    }
    // WhatsApp normal — wa.me funciona em todo lugar.
    window.location.href = `https://wa.me/${phone}?text=${text}`;
  };

  if (!resolved && !failed) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <div className="animate-spin h-6 w-6 border-3 border-primary border-t-transparent rounded-full" />
            </div>
            <div className="absolute inset-0 rounded-2xl bg-primary/5 animate-ping" />
          </div>
          <p className="text-sm text-muted-foreground">Carregando…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-background to-background p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="space-y-2">
          <div className="w-16 h-16 rounded-3xl bg-emerald-500/15 flex items-center justify-center mx-auto">
            <MessageCircle className="w-8 h-8 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Abrir no WhatsApp</h1>
          <p className="text-sm text-muted-foreground">
            Escolha qual aplicativo você tem instalado para falar com o consultor.
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => openWhatsApp("default")}
            className="w-full h-14 rounded-2xl bg-[#25D366] hover:bg-[#1faa56] active:scale-[0.98] text-white font-semibold flex items-center justify-center gap-3 transition-all shadow-lg shadow-emerald-500/30"
          >
            <MessageCircle className="w-5 h-5" />
            WhatsApp
          </button>

          <button
            onClick={() => openWhatsApp("business")}
            className="w-full h-14 rounded-2xl bg-[#075E54] hover:bg-[#054c43] active:scale-[0.98] text-white font-semibold flex items-center justify-center gap-3 transition-all shadow-lg shadow-emerald-900/30"
          >
            <Briefcase className="w-5 h-5" />
            WhatsApp Business
          </button>
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          Não tem certeza? Toque em <strong>WhatsApp</strong> — funciona com o app padrão do seu celular.
        </p>
      </div>
    </div>
  );
}
