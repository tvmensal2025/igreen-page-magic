import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type State =
  | { kind: "loading" }
  | { kind: "success"; name: string; expiresAt: string | null }
  | { kind: "error"; message: string };

const IgreenConnect = () => {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = (params.get("code") || "").trim();
    const token = (params.get("t") || "").trim();

    if (!code || !token) {
      setState({ kind: "error", message: "Link incompleto. Use o botão 'Conectar iGreen' a partir do portal." });
      return;
    }

    fetch(`${SUPABASE_URL}/functions/v1/igreen-token-receive`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON,
      },
      body: JSON.stringify({ connect_code: code, access_token: token }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          setState({ kind: "error", message: data?.error || `Erro HTTP ${r.status}` });
        } else {
          setState({
            kind: "success",
            name: data?.consultant_name || "iGreen",
            expiresAt: data?.expires_at || null,
          });
        }
      })
      .catch((e) => setState({ kind: "error", message: e?.message || "Falha de rede" }));
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-card border rounded-2xl shadow-lg p-8 text-center">
        {state.kind === "loading" && (
          <>
            <Loader2 className="w-12 h-12 mx-auto animate-spin text-primary mb-4" />
            <h1 className="text-xl font-semibold mb-2">Conectando iGreen…</h1>
            <p className="text-sm text-muted-foreground">Enviando seu token com segurança.</p>
          </>
        )}
        {state.kind === "success" && (
          <>
            <CheckCircle2 className="w-12 h-12 mx-auto text-green-500 mb-4" />
            <h1 className="text-xl font-semibold mb-2">Conectado com sucesso!</h1>
            <p className="text-sm text-muted-foreground mb-2">
              Token iGreen salvo para <strong>{state.name}</strong>.
            </p>
            {state.expiresAt && (
              <p className="text-xs text-muted-foreground">
                Válido até {new Date(state.expiresAt).toLocaleString("pt-BR")}.
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-4">Você pode fechar esta aba.</p>
          </>
        )}
        {state.kind === "error" && (
          <>
            <XCircle className="w-12 h-12 mx-auto text-destructive mb-4" />
            <h1 className="text-xl font-semibold mb-2">Não foi possível conectar</h1>
            <p className="text-sm text-muted-foreground">{state.message}</p>
          </>
        )}
      </div>
    </div>
  );
};

export default IgreenConnect;
