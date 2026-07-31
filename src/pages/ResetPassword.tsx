// ResetPassword — página dedicada para criar uma nova senha.
//
// Por que existe: o link do e-mail de recuperação do Supabase volta para o app
// com um `?code=` (fluxo PKCE) ou com `#type=recovery` (fluxo implícito legado).
// Antes esse retorno caía em /auth, onde o listener de sessão mandava o usuário
// direto para /admin — ou seja, o consultor "logava" e nunca chegava a definir a
// senha nova. Aqui a rota é isolada: só troca de senha acontece.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import BrandLogo from "@/components/common/BrandLogo";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MailWarning,
  ShieldCheck,
} from "lucide-react";

type Phase = "checking" | "ready" | "invalid" | "done";

/** Traduz os erros que o Supabase devolve na URL para algo humano. */
function humanUrlError(code: string | null, description: string | null): string {
  if (code === "otp_expired") {
    return "Este link expirou. Os links de recuperação valem por pouco tempo e só podem ser usados uma vez.";
  }
  if (code === "access_denied") {
    return "Este link não é mais válido. Peça um novo link de recuperação.";
  }
  if (description) return decodeURIComponent(description.replace(/\+/g, " "));
  return "Não conseguimos validar o link de recuperação.";
}

/**
 * Snapshot da URL no carregamento do módulo. O supabase-js (detectSessionInUrl)
 * limpa o hash assim que a página monta, então precisamos guardar antes.
 */
const INITIAL_URL =
  typeof window !== "undefined" ? window.location.href : "http://localhost/";
const INITIAL_HASH =
  typeof window !== "undefined" ? window.location.hash : "";

export default function ResetPassword() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>("checking");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reenvio do link direto desta tela (quando o link chegou expirado).
  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      const url = new URL(INITIAL_URL);
      const hash = new URLSearchParams(
        (INITIAL_HASH || window.location.hash).replace(/^#/, ""),
      );

      // 1) O link já veio com erro embutido (expirado / já usado).
      const errCode = url.searchParams.get("error_code") ?? hash.get("error_code");
      const errDesc =
        url.searchParams.get("error_description") ?? hash.get("error_description");
      if (errCode || url.searchParams.get("error") || hash.get("error")) {
        if (!alive) return;
        setErrorMsg(humanUrlError(errCode, errDesc));
        setPhase("invalid");
        return;
      }

      // 2) Fluxo PKCE: `?code=`. O cliente costuma trocar sozinho
      //    (detectSessionInUrl), então tentamos e ignoramos "já usado".
      const code = url.searchParams.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          const { data } = await supabase.auth.getSession();
          if (!data.session) {
            if (!alive) return;
            setErrorMsg(
              "Este link precisa ser aberto no mesmo aparelho e navegador em que você pediu a recuperação. Peça um novo link e abra direto no celular/computador onde fez o pedido.",
            );
            setPhase("invalid");
            return;
          }
        }
        window.history.replaceState(null, "", "/reset-password");
      }

      // 3) Fluxo implícito: tokens no hash. O supabase-js resolve sozinho;
      //    damos um pequeno respiro antes de checar a sessão.
      if (hash.get("access_token")) {
        await new Promise((r) => setTimeout(r, 350));
        window.history.replaceState(null, "", "/reset-password");
      }

      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      if (data.session) {
        setPhase("ready");
      } else {
        setErrorMsg(
          "Não encontramos um link de recuperação válido. Peça um novo link para continuar.",
        );
        setPhase("invalid");
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const rules = [
    { ok: password.length >= 8, label: "Pelo menos 8 caracteres" },
    { ok: /[A-Za-z]/.test(password) && /\d/.test(password), label: "Letras e números" },
    { ok: password.length > 0 && password === confirmPassword, label: "As duas senhas são iguais" },
  ];
  const allOk = rules.every((r) => r.ok);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allOk || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPhase("done");
      toast({ title: "Senha alterada!", description: "Entrando no painel..." });
      setTimeout(() => navigate("/admin", { replace: true }), 1400);
    } catch (error: unknown) {
      toast({
        title: "Não foi possível alterar a senha",
        description: error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resendEmail.trim() || resending) return;
    setResending(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resendEmail.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast({
        title: "Link enviado",
        description: "Se este e-mail estiver cadastrado, o link chega em instantes. Olhe também o spam.",
      });
    } catch (error: unknown) {
      toast({
        title: "Não foi possível enviar",
        description: error instanceof Error ? error.message : "Tente novamente em instantes.",
        variant: "destructive",
      });
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 relative overflow-hidden bg-background">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 -left-32 w-96 h-96 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 rounded-full bg-accent/5 blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10 space-y-7">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <BrandLogo className="w-40 drop-shadow-lg" alt="iGreen Energy" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold font-heading tracking-tight text-foreground">
            {phase === "done" ? "Senha atualizada" : "Criar nova senha"}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Painel do Consultor iGreen Energy
          </p>
        </div>

        <div className="relative">
          <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-transparent to-accent/20 rounded-3xl blur-xl opacity-50" />
          <div className="relative bg-card/80 backdrop-blur-xl p-6 sm:p-8 rounded-2xl border border-border shadow-xl">
            <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

            {phase === "checking" && (
              <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-sm">Validando seu link de recuperação...</p>
              </div>
            )}

            {phase === "invalid" && (
              <div className="space-y-5">
                <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4">
                  <MailWarning className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                  <p className="text-sm text-foreground leading-relaxed">{errorMsg}</p>
                </div>

                <form onSubmit={handleResend} className="space-y-3">
                  <Label htmlFor="resend-email" className="text-sm font-medium">
                    Receber um novo link
                  </Label>
                  <Input
                    id="resend-email"
                    type="email"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    placeholder="seu@email.com"
                    required
                    className="h-12 rounded-xl bg-secondary/50 text-base"
                  />
                  <Button
                    type="submit"
                    disabled={resending}
                    className="w-full h-12 rounded-xl text-base font-bold gap-2"
                    style={{ background: "var(--gradient-green)" }}
                  >
                    {resending ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>Enviar novo link <ArrowRight className="w-4 h-4" /></>
                    )}
                  </Button>
                </form>
              </div>
            )}

            {phase === "ready" && (
              <form onSubmit={handleSave} className="space-y-5">
                <div className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3">
                  <KeyRound className="h-5 w-5 text-primary shrink-0" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Link confirmado. Defina uma senha nova para acessar o painel.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-password" className="text-sm font-medium">Nova senha</Label>
                  <div className="relative">
                    <Input
                      id="new-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      autoFocus
                      className="h-12 rounded-xl bg-secondary/50 text-base pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors h-9 w-9 flex items-center justify-center rounded-md"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-password" className="text-sm font-medium">Confirmar nova senha</Label>
                  <Input
                    id="confirm-password"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="h-12 rounded-xl bg-secondary/50 text-base"
                  />
                </div>

                <ul className="space-y-1.5">
                  {rules.map((r) => (
                    <li
                      key={r.label}
                      className={`flex items-center gap-2 text-xs transition-colors ${r.ok ? "text-primary" : "text-muted-foreground"}`}
                    >
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded-full border ${r.ok ? "border-primary bg-primary/15" : "border-border"}`}
                      >
                        {r.ok && <Check className="h-3 w-3" />}
                      </span>
                      {r.label}
                    </li>
                  ))}
                </ul>

                <Button
                  type="submit"
                  disabled={!allOk || saving}
                  className="w-full h-12 rounded-xl text-base font-bold gap-2 disabled:opacity-60"
                  style={{ background: "var(--gradient-green)" }}
                >
                  {saving ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>Salvar nova senha <ArrowRight className="w-4 h-4" /></>
                  )}
                </Button>
              </form>
            )}

            {phase === "done" && (
              <div className="flex flex-col items-center gap-4 py-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
                  <ShieldCheck className="h-7 w-7 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground max-w-xs">
                  Sua senha foi alterada com sucesso. Estamos abrindo o seu painel...
                </p>
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              </div>
            )}
          </div>
        </div>

        <p className="text-center">
          <Link
            to="/auth"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar ao login
          </Link>
        </p>
      </div>
    </div>
  );
}
