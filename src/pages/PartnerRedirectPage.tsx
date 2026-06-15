import { useEffect } from "react";
import { useParams } from "react-router-dom";

/**
 * Redirect do link curto de parceiro: `igreen.cloud/r/{licenca}/{short_code}`.
 *
 * O SPA redireciona pra edge function `qr-redirect`, que resolve telefone do
 * consultor + parceiro pelo código numérico e monta a frase do WhatsApp.
 */

const SUPABASE_URL = "https://zlzasfhcxcznaprrragl.supabase.co";

function buildRedirectTarget(
  licenca: string | undefined,
  code: string | undefined,
): string {
  const lic = (licenca ?? "").trim();
  if (!lic) return "/";
  const params = new URLSearchParams({ l: lic });
  const c = (code ?? "").trim();
  if (c) params.set("c", c);
  return `${SUPABASE_URL}/functions/v1/qr-redirect?${params.toString()}`;
}

export default function PartnerRedirectPage() {
  const { licenca, code } = useParams<{ licenca: string; code?: string }>();

  useEffect(() => {
    window.location.replace(buildRedirectTarget(licenca, code));
  }, [licenca, code]);

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <div className="animate-spin h-6 w-6 border-3 border-primary border-t-transparent rounded-full" />
          </div>
          <div className="absolute inset-0 rounded-2xl bg-primary/5 animate-ping" />
        </div>
        <p className="text-sm text-muted-foreground">Abrindo o WhatsApp…</p>
      </div>
    </div>
  );
}
