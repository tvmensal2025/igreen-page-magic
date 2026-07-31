import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, ArrowRight, Zap, RefreshCw, MailCheck } from "lucide-react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import BrandLogo from "@/components/common/BrandLogo";
import { hardReset } from "@/lib/hardReset";

function slugify(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const AUTH_OPERATION_TIMEOUT_MS = 18000;

async function withAuthTimeout<T>(promise: PromiseLike<T>, message = "A autenticação demorou demais. Tente novamente.") {
  let timeoutId: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), AUTH_OPERATION_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const igreenId = "";
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  // Recuperação de senha self-service: "forgot" envia o e-mail; "recovery"
  // aparece quando o usuário volta pelo link do e-mail (evento PASSWORD_RECOVERY).
  const [forgotMode, setForgotMode] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [forgotSentTo, setForgotSentTo] = useState<string | null>(null);
  const [resettingApp, setResettingApp] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const recoveryRef = useRef(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  // Escuta o evento global disparado pelo version gate em src/main.tsx.
  // Quando dispara, o botão "Atualizar app" começa a piscar para chamar atenção.
  useEffect(() => {
    const onUpdate = () => setUpdateAvailable(true);
    window.addEventListener("igreen:update-available", onUpdate);
    return () => window.removeEventListener("igreen:update-available", onUpdate);
  }, []);

  const handleHardResetApp = async () => {
    if (resettingApp) return;
    setResettingApp(true);
    try {
      await hardReset("auth-page-update-button");
    } catch (error: unknown) {
      setResettingApp(false);
      toast({
        title: "Não foi possível atualizar",
        description: error instanceof Error ? error.message : "Tente novamente ou abra /reset.",
        variant: "destructive",
      });
    }
  };

  const checkAdminAndNavigate = async (_userId: string) => {
    navigate("/admin");
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // No fluxo de recuperação NÃO navegamos: deixamos o usuário definir a nova senha.
      if (event === "PASSWORD_RECOVERY") {
        recoveryRef.current = true;
        setRecoveryMode(true);
        return;
      }
      if (session && !recoveryRef.current) {
        checkAdminAndNavigate(session.user.id);
      }
    });
    // Se o link do e-mail cair em /auth (fallback do Site URL do Supabase),
    // levamos o usuário para a tela dedicada preservando code/hash.
    const search = window.location.search;
    const rawHash = window.location.hash;
    if (
      new URLSearchParams(search).get("code") ||
      rawHash.includes("type=recovery") ||
      rawHash.includes("access_token") ||
      new URLSearchParams(search).get("error_code")
    ) {
      recoveryRef.current = true;
      window.location.replace(`/reset-password${search}${rawHash}`);
      return () => subscription.unsubscribe();
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      const isRecoveryUrl = window.location.hash.includes("type=recovery");
      if (isRecoveryUrl) {
        recoveryRef.current = true;
        setRecoveryMode(true);
        return;
      }
      if (session) {
        checkAdminAndNavigate(session.user.id);
      }
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (!email.trim()) throw new Error("Informe seu e-mail.");
      const { error } = await withAuthTimeout(
        supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset-password`,
        }),
        "O envio do link demorou demais. Tente novamente."
      );
      if (error) throw error;
      setForgotSentTo(email.trim());
    } catch (error: unknown) {
      toast({
        title: "Não foi possível enviar",
        description: error instanceof Error ? error.message : "Tente novamente em instantes.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSetNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (password.length < 6) throw new Error("A senha deve ter pelo menos 6 caracteres.");
      if (password !== confirmPassword) throw new Error("As senhas não coincidem.");
      const { error } = await withAuthTimeout(
        supabase.auth.updateUser({ password }),
        "A alteração de senha demorou demais. Tente novamente."
      );
      if (error) throw error;
      toast({ title: "Senha alterada!", description: "Você já pode acessar com a nova senha." });
      recoveryRef.current = false;
      setRecoveryMode(false);
      // Limpa o hash de recuperação da URL.
      window.history.replaceState(null, "", "/auth");
      const { data } = await supabase.auth.getSession();
      if (data.session) checkAdminAndNavigate(data.session.user.id);
    } catch (error: unknown) {
      toast({
        title: "Erro ao alterar senha",
        description: error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (!isLogin && password !== confirmPassword) {
        throw new Error("As senhas não coincidem.");
      }

      if (isLogin) {
        const { error } = await withAuthTimeout(
          supabase.auth.signInWithPassword({ email, password }),
          "O login demorou demais. Verifique sua conexão e tente novamente."
        );
        if (error) throw error;
        toast({ title: "Login realizado com sucesso!" });
      } else {
        if (!name.trim()) throw new Error("Informe seu nome completo.");
        if (!phone.trim()) throw new Error("Informe seu WhatsApp.");

        await withAuthTimeout(supabase.auth.signOut(), "A preparação do cadastro demorou demais. Tente novamente.");
        const { data: signUpData, error } = await withAuthTimeout(
          supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin },
          }),
          "O cadastro demorou demais. Tente novamente."
        );
        if (error) throw error;

        const userId = signUpData.user?.id;
        if (userId) {
          // Gera license única a partir do nome + sufixo curto do id
          const baseSlug = slugify(name) || "consultor";
          const license = `${baseSlug}-${userId.slice(0, 6)}`;
          const phoneClean = phone.replace(/\D/g, "");

          const { error: insErr } = await supabase.from("consultants").insert({
            id: userId,
            name: name.trim(),
            license,
            phone: phoneClean,
            cadastro_url: license,
            igreen_id: igreenId.trim() || null,
            approved: false,
          } as any);

          if (insErr) {
            console.error("[auth] falha ao criar consultor:", insErr);
            toast({
              title: "Conta criada, mas faltou registrar consultor",
              description: insErr.message,
              variant: "destructive",
            });
          } else {
            toast({
              title: "Cadastro realizado!",
              description: "Conta criada. Aguarde a aprovação do Super Admin para acessar o painel.",
            });
          }
        } else {
          toast({
            title: "Cadastro enviado!",
            description: "Verifique seu email para confirmar e depois complete seu cadastro.",
          });
        }
      }
    } catch (error: unknown) {
      toast({
        title: "Erro",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Tela de confirmação após enviar o link de recuperação.
  if (forgotMode && forgotSentTo) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-10 relative overflow-hidden bg-background public-page-safe-bottom">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/4 -left-32 w-96 h-96 rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute bottom-1/4 -right-32 w-96 h-96 rounded-full bg-accent/5 blur-3xl" />
        </div>
        <div className="w-full max-w-md relative z-10 space-y-7 text-center">
          <div className="flex justify-center">
            <BrandLogo className="w-40 drop-shadow-lg" alt="iGreen Energy" />
          </div>
          <div className="relative">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-transparent to-accent/20 rounded-3xl blur-xl opacity-50" />
            <div className="relative bg-card/80 backdrop-blur-xl p-8 rounded-2xl border border-border shadow-xl space-y-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
                <MailCheck className="h-7 w-7 text-primary" />
              </div>
              <h1 className="text-xl font-bold font-heading text-foreground">Verifique seu e-mail</h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Enviamos um link de recuperação para{" "}
                <span className="font-semibold text-foreground">{forgotSentTo}</span>.
                Abra o link <span className="font-semibold text-foreground">neste mesmo aparelho</span> para criar sua nova senha.
              </p>
              <p className="text-xs text-muted-foreground">
                Não chegou em alguns minutos? Confira a caixa de spam ou envie novamente.
              </p>
              <div className="grid gap-2 pt-2">
                <Button
                  type="button"
                  onClick={() => setForgotSentTo(null)}
                  variant="outline"
                  className="h-12 rounded-xl font-semibold"
                >
                  Enviar novamente
                </Button>
                <Button
                  type="button"
                  onClick={() => { setForgotSentTo(null); setForgotMode(false); }}
                  className="h-12 rounded-xl font-bold"
                  style={{ background: "var(--gradient-green)" }}
                >
                  Voltar ao login
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 relative overflow-x-hidden bg-background public-page-safe-bottom">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-32 w-96 h-96 rounded-full bg-primary/5 blur-3xl animate-float" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 rounded-full bg-accent/5 blur-3xl animate-float" style={{ animationDelay: "1.5s" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/[0.03] blur-[100px]" />
        <div className="absolute inset-0 opacity-[0.015] dark:opacity-[0.03]" style={{
          backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
          backgroundSize: "32px 32px"
        }} />
      </div>

      {/* Theme toggle */}
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-5xl relative z-10 flex flex-col lg:flex-row lg:items-start lg:justify-center gap-5 lg:gap-6">
        {/* Coluna principal — login */}
        <div className="w-full max-w-md mx-auto lg:mx-0 space-y-8">
          <div className="text-center">
            <div className="flex justify-center mb-6">
              <div className="relative">
                <BrandLogo className="w-44 drop-shadow-lg" alt="iGreen Energy" />
                <div className="absolute -inset-4 bg-primary/10 rounded-3xl blur-2xl -z-10" />
              </div>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold font-heading text-foreground tracking-tight">
              {recoveryMode ? "Definir nova senha" : forgotMode ? "Recuperar senha" : isLogin ? "Bem-vindo de volta" : "Crie sua conta"}
            </h1>
            <p className="text-muted-foreground mt-2 text-sm">Painel do Consultor iGreen Energy</p>
          </div>

          <div className="relative">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-transparent to-accent/20 rounded-3xl blur-xl opacity-50" />
            <form onSubmit={recoveryMode ? handleSetNewPassword : forgotMode ? handleForgotPassword : handleSubmit} className="relative space-y-5 bg-card/80 backdrop-blur-xl p-5 sm:p-8 rounded-2xl border border-border shadow-xl w-full">
              <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

              {!isLogin && !forgotMode && !recoveryMode && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-sm font-medium text-foreground">Nome completo</Label>
                    <Input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)}
                      placeholder="Ex.: Maria Silva" required maxLength={120}
                      className="h-12 rounded-xl bg-secondary/50 border-border text-base placeholder:text-muted-foreground/50" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone" className="text-sm font-medium text-foreground">WhatsApp</Label>
                    <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                      placeholder="(11) 99999-9999" required maxLength={20}
                      className="h-12 rounded-xl bg-secondary/50 border-border text-base placeholder:text-muted-foreground/50" />
                  </div>
                </>
              )}

              {!recoveryMode && (
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium text-foreground">Email</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="seu@email.com" required
                    className="h-12 rounded-xl bg-secondary/50 border-border text-base placeholder:text-muted-foreground/50" />
                </div>
              )}
              {forgotMode && (
                <p className="text-xs text-muted-foreground">
                  Enviaremos um link para você criar uma nova senha.
                </p>
              )}
              {!forgotMode && (
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-medium text-foreground">{recoveryMode ? "Nova senha" : "Senha"}</Label>
                  <div className="relative">
                    <Input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••" required minLength={6}
                      className="h-12 rounded-xl bg-secondary/50 border-border text-base pr-12 placeholder:text-muted-foreground/50" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors min-h-11 min-w-11 flex items-center justify-center rounded-md">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {isLogin && !recoveryMode && (
                    <div className="text-right">
                      <button type="button" onClick={() => { setForgotSentTo(null); setForgotMode(true); }}
                        className="text-sm text-primary font-medium hover:underline underline-offset-4 min-h-11 px-2 -mr-2 inline-flex items-center">
                        Esqueci minha senha
                      </button>
                    </div>
                  )}
                </div>
              )}
              {((!isLogin && !forgotMode) || recoveryMode) && (
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-sm font-medium text-foreground">Confirmar Senha</Label>
                  <div className="relative">
                    <Input id="confirmPassword" type={showConfirmPassword ? "text" : "password"} value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" required minLength={6}
                      className="h-12 rounded-xl bg-secondary/50 border-border text-base pr-12 placeholder:text-muted-foreground/50" />
                    <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} aria-label={showConfirmPassword ? "Ocultar senha" : "Mostrar senha"}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors min-h-11 min-w-11 flex items-center justify-center rounded-md">
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              )}
              <Button type="submit" className="w-full h-12 text-base font-bold rounded-xl gap-2 transition-all duration-300 hover:shadow-lg"
                style={{ background: "var(--gradient-green)" }} disabled={loading}>
                {loading ? <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" /> : (
                  <>{recoveryMode ? "Salvar nova senha" : forgotMode ? "Enviar link de recuperação" : isLogin ? "Entrar" : "Criar conta"}<ArrowRight className="w-4 h-4" /></>
                )}
              </Button>
            </form>
          </div>

          {forgotMode ? (
            <p className="text-center text-sm text-muted-foreground">
              Lembrou a senha?{" "}
              <button onClick={() => { setForgotSentTo(null); setForgotMode(false); }} className="text-primary font-semibold hover:underline underline-offset-4 min-h-11 px-2 inline-flex items-center">
                Voltar ao login
              </button>
            </p>
          ) : !recoveryMode ? (
            <p className="text-center text-sm text-muted-foreground">
              {isLogin ? "Não tem conta?" : "Já tem conta?"}{" "}
              <button onClick={() => setIsLogin(!isLogin)} className="text-primary font-semibold hover:underline underline-offset-4 min-h-11 px-2 inline-flex items-center">
                {isLogin ? "Criar conta" : "Fazer login"}
              </button>
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-1">
            <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-muted-foreground/60">
              <Zap className="w-3 h-3 shrink-0" /><span>PLATAFORMA PARA O CONSULTOR</span>
            </div>
            <div className="w-1 h-1 rounded-full bg-muted-foreground/20 hidden sm:block" />
            <div className="text-[10px] sm:text-xs text-muted-foreground/60">SUPORTE-IGREEN</div>
          </div>
        </div>

        {/* Coluna lateral — atualizar app (desktop ao lado; mobile embaixo) */}
        <aside className="w-full max-w-md mx-auto lg:mx-0 lg:w-[280px] lg:flex-shrink-0 lg:sticky lg:top-10 lg:pt-[7.5rem]">
          <button
            type="button"
            onClick={handleHardResetApp}
            disabled={resettingApp}
            aria-label={updateAvailable ? "Nova versão disponível — clique para atualizar" : "Atualizar app"}
            className={[
              "group relative w-full overflow-hidden rounded-2xl border text-left transition-all duration-300 disabled:opacity-70",
              "lg:min-h-[280px] lg:flex lg:flex-col",
              updateAvailable
                ? "border-primary/45 bg-gradient-to-b from-primary/18 via-card to-card shadow-xl shadow-primary/15 ring-1 ring-primary/25"
                : "border-border/70 bg-card/75 backdrop-blur-xl shadow-lg hover:border-primary/35 hover:shadow-xl",
            ].join(" ")}
          >
            <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/10 blur-3xl transition-opacity group-hover:bg-primary/15" aria-hidden />
            {updateAvailable && (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-primary/20 to-transparent" aria-hidden />
            )}

            <div className="relative flex flex-col gap-4 p-5 sm:p-6 lg:flex-1 lg:justify-between">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={[
                      "inline-flex h-12 w-12 items-center justify-center rounded-2xl transition-all",
                      updateAvailable
                        ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30"
                        : "bg-primary/10 text-primary group-hover:bg-primary/15 group-hover:scale-105",
                    ].join(" ")}
                  >
                    <RefreshCw
                      className={`h-5 w-5 ${
                        resettingApp
                          ? "animate-spin"
                          : updateAvailable
                            ? "animate-spin [animation-duration:2.2s]"
                            : "transition-transform duration-300 group-hover:rotate-45"
                      }`}
                    />
                  </span>
                  {updateAvailable ? (
                    <span className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground shadow-sm">
                      Nova
                    </span>
                  ) : (
                    <span className="rounded-full border border-border/80 bg-secondary/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      !
                    </span>
                  )}
                </div>

                <div className="space-y-2">
                  <p className={`font-heading text-base font-bold tracking-tight ${updateAvailable ? "text-primary" : "text-foreground"}`}>
                    {resettingApp
                      ? "Atualizando…"
                      : updateAvailable
                        ? "Versão nova pronta"
                        : "Atualizar o app"}
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {updateAvailable
                      ? "Clique para limpar o cache e carregar a versão mais recente. Depois é só entrar de novo."
                      : "Nova versâo."}
                  </p>
                </div>

                <ul className="hidden space-y-1.5 text-[11px] text-muted-foreground lg:block">
                  <li className="flex items-start gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary/70" />
                    Ajustes semanais.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary/70" />
                    Apenas para a equipe.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary/70" />
                    Não apaga clientes nem conversas
                  </li>
                </ul>
              </div>

              <span
                className={[
                  "inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-all",
                  updateAvailable
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/25 group-hover:brightness-110"
                    : "bg-secondary text-foreground group-hover:bg-primary group-hover:text-primary-foreground",
                ].join(" ")}
              >
                {resettingApp ? "Aguarde…" : updateAvailable ? "Atualizar agora" : "Atualizar app"}
                {!resettingApp && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />}
              </span>
            </div>
          </button>
        </aside>
      </div>
    </div>
  );
};

export default Auth;
