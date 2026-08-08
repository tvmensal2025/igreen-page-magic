import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, Zap, RefreshCw, MailCheck, Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthCard } from "@/components/auth/AuthCard";
import { PasswordField } from "@/components/auth/PasswordField";
import { hardReset } from "@/lib/hardReset";
import { sendPasswordResetEmail } from "@/lib/passwordReset";
import { toUserFacingError } from "@/lib/userFacingError";
import {
  getBrowserPassword,
  readRememberedEmail,
  readSavePasswordPref,
  storeBrowserPassword,
  writeRememberedEmail,
  writeSavePasswordPref,
} from "@/lib/authRemember";

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

/** Máscara leve de WhatsApp BR enquanto digita: (11) 99999-9999 */
function maskWhatsAppInput(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
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
  const [email, setEmail] = useState(() => readRememberedEmail());
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const igreenId = "";
  const [savePassword, setSavePassword] = useState(() => readSavePasswordPref());
  const [loading, setLoading] = useState(false);
  /** Enquanto valida sessão / tenta entrar automático — não mostra o form vazio. */
  const [sessionChecking, setSessionChecking] = useState(true);
  // Recuperação de senha self-service: "forgot" envia o e-mail; "recovery"
  // aparece quando o usuário volta pelo link do e-mail (evento PASSWORD_RECOVERY).
  const [forgotMode, setForgotMode] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [forgotSentTo, setForgotSentTo] = useState<string | null>(null);
  const [resettingApp, setResettingApp] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const recoveryRef = useRef(false);
  // Evita navegar p/ /admin no meio do signUp — senão o useAdminAuth cria
  // stub sem telefone e o insert daqui falha com duplicate (toast vermelho falso).
  const signupInProgressRef = useRef(false);
  const autoLoginTriedRef = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const reduceMotion = useReducedMotion();

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
        description: toUserFacingError(error, "Tente novamente ou abra /reset."),
        variant: "destructive",
      });
    }
  };

  // Volta para a página que o usuário tentou abrir antes do login (guardada pelo
  // ProtectedRoute em location.state.from). Sem isso, todo login caía em /admin.
  const checkAdminAndNavigate = async (_userId: string) => {
    const from = (location.state as { from?: string } | null)?.from;
    const safeFrom = typeof from === "string" && from.startsWith("/") && !from.startsWith("//") && from !== "/auth"
      ? from
      : "/admin";
    navigate(safeFrom, { replace: true });
  };

  const persistLoginPrefs = async (loginEmail: string, loginPassword: string) => {
    writeSavePasswordPref(savePassword);
    if (savePassword) {
      writeRememberedEmail(loginEmail);
      await storeBrowserPassword(loginEmail, loginPassword);
    } else {
      writeRememberedEmail(null);
    }
  };

  const signInWithSavedCreds = async (loginEmail: string, loginPassword: string) => {
    setLoading(true);
    try {
      const { error } = await withAuthTimeout(
        supabase.auth.signInWithPassword({ email: loginEmail, password: loginPassword }),
        "O login demorou demais. Verifique sua conexão e tente novamente."
      );
      if (error) throw error;
      await persistLoginPrefs(loginEmail, loginPassword);
      toast({ title: "Login realizado com sucesso!" });
    } catch (error: unknown) {
      toast({
        title: "Não foi possível entrar",
        description: toUserFacingError(error),
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // No fluxo de recuperação NÃO navegamos: deixamos o usuário definir a nova senha.
      if (event === "PASSWORD_RECOVERY") {
        recoveryRef.current = true;
        setRecoveryMode(true);
        setSessionChecking(false);
        return;
      }
      if (session && !recoveryRef.current && !signupInProgressRef.current) {
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

    (async () => {
      let revealForm = true;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const isRecoveryUrl = window.location.hash.includes("type=recovery");
        if (isRecoveryUrl) {
          recoveryRef.current = true;
          setRecoveryMode(true);
          return;
        }
        if (session && !signupInProgressRef.current) {
          revealForm = false;
          checkAdminAndNavigate(session.user.id);
          return;
        }

        // Sem sessão: tenta gerenciador de senhas do navegador (entrar automático).
        if (!autoLoginTriedRef.current && readSavePasswordPref()) {
          autoLoginTriedRef.current = true;
          const cred = await getBrowserPassword();
          if (cred?.id && cred.password) {
            setEmail(cred.id);
            setPassword(cred.password);
            revealForm = false;
            setSessionChecking(false);
            await signInWithSavedCreds(cred.id, cred.password);
            return;
          }
        }
      } finally {
        if (revealForm) setSessionChecking(false);
      }
    })();

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (!email.trim()) throw new Error("Informe seu e-mail.");
      await withAuthTimeout(
        sendPasswordResetEmail(email.trim()),
        "O envio do link demorou demais. Tente novamente."
      );
      setForgotSentTo(email.trim());
    } catch (error: unknown) {
      toast({
        title: "Não foi possível enviar o link",
        description: toUserFacingError(error, "Tente novamente em instantes."),
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
      window.history.replaceState(null, "", "/auth");
      const { data } = await supabase.auth.getSession();
      if (data.session) checkAdminAndNavigate(data.session.user.id);
    } catch (error: unknown) {
      toast({
        title: "Não foi possível alterar a senha",
        description: toUserFacingError(error, "Tente novamente."),
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
        await persistLoginPrefs(email.trim(), password);
        toast({ title: "Login realizado com sucesso!" });
      } else {
        if (!name.trim() || name.trim().split(/\s+/).length < 2) {
          throw new Error("Informe seu nome completo (nome e sobrenome).");
        }
        if (!phone.trim()) throw new Error("Informe seu WhatsApp.");

        const phoneClean = phone.replace(/\D/g, "");
        // BR: 10–11 (DDD+número) ou 12–13 com 55.
        if (phoneClean.length < 10 || phoneClean.length > 13) {
          throw new Error("WhatsApp inválido. Use DDD + número (ex.: 11999999999).");
        }
        const fullName = name.trim();

        signupInProgressRef.current = true;
        try {
          await withAuthTimeout(supabase.auth.signOut(), "A preparação do cadastro demorou demais. Tente novamente.");
          const { data: signUpData, error } = await withAuthTimeout(
            supabase.auth.signUp({
              email,
              password,
              options: {
                emailRedirectTo: window.location.origin,
                data: { full_name: fullName, phone: phoneClean },
              },
            }),
            "O cadastro demorou demais. Tente novamente."
          );
          if (error) throw error;

          const userId = signUpData.user?.id;
          if (userId) {
            const baseSlug = slugify(fullName) || "consultor";
            const license = `${baseSlug}-${userId.slice(0, 6)}`;
            const payload = {
              id: userId,
              name: fullName,
              license,
              phone: phoneClean,
              cadastro_url: license,
              igreen_id: igreenId.trim() || null,
              approved: false,
            };

            const { error: upsertErr } = await supabase
              .from("consultants")
              .upsert(payload as any, { onConflict: "id" });

            if (upsertErr) {
              console.error("[auth] falha ao criar consultor:", upsertErr);
              toast({
                title: "Não foi possível concluir o cadastro",
                description: toUserFacingError(upsertErr),
                variant: "destructive",
              });
            } else {
              toast({
                title: "Cadastro realizado!",
                description: "Conta criada. Aguarde a aprovação do Super Admin para acessar o painel.",
              });
              checkAdminAndNavigate(userId);
            }
          } else {
            toast({
              title: "Cadastro enviado!",
              description: "Verifique seu email para confirmar e depois complete seu cadastro.",
            });
          }
        } finally {
          signupInProgressRef.current = false;
        }
      }
    } catch (error: unknown) {
      const title = isLogin
        ? "Não foi possível entrar"
        : "Não foi possível criar a conta";
      toast({
        title,
        description: toUserFacingError(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const pageTitle = sessionChecking
    ? "Entrando…"
    : recoveryMode
    ? "Definir nova senha"
    : forgotMode && forgotSentTo
      ? "Verifique seu e-mail"
      : forgotMode
        ? "Recuperar senha"
        : isLogin
          ? "Bem-vindo de volta"
          : "Crie sua conta";

  const motionKey = recoveryMode
    ? "recovery"
    : forgotMode && forgotSentTo
      ? "sent"
      : forgotMode
        ? "forgot"
        : isLogin
          ? "login"
          : "signup";

  const inputClass =
    "h-12 rounded-xl bg-secondary/50 border-border text-base placeholder:text-muted-foreground/50";

  const updateAppButton = (
    <button
      type="button"
      onClick={handleHardResetApp}
      disabled={resettingApp}
      aria-label={updateAvailable ? "Nova versão disponível — clique para atualizar" : "Atualizar app"}
      className={[
        "mx-auto flex items-center justify-center gap-1.5 rounded-lg px-3 min-h-11 text-xs font-medium transition-colors disabled:opacity-70",
        updateAvailable
          ? "text-primary hover:bg-primary/10 ring-1 ring-primary/30"
          : "text-muted-foreground hover:text-foreground hover:bg-secondary/80",
      ].join(" ")}
    >
      <RefreshCw
        className={`h-3.5 w-3.5 shrink-0 ${
          resettingApp
            ? "animate-spin"
            : updateAvailable
              ? "animate-spin [animation-duration:2.2s]"
              : ""
        }`}
      />
      {resettingApp
        ? "Atualizando…"
        : updateAvailable
          ? "Nova versão — atualizar"
          : "Atualizar app"}
    </button>
  );

  return (
    <AuthShell title={pageTitle}>
      {sessionChecking ? (
        <AuthCard shine={false}>
          <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm">Entrando automaticamente…</p>
          </div>
        </AuthCard>
      ) : (
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={motionKey}
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
          transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-5"
        >
          {forgotMode && forgotSentTo ? (
            <AuthCard>
              <div className="space-y-4 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
                  <MailCheck className="h-7 w-7 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Enviamos um link de recuperação para{" "}
                  <span className="font-semibold text-foreground">{forgotSentTo}</span>.
                  Abra o link <span className="font-semibold text-foreground">neste mesmo aparelho</span>{" "}
                  para criar sua nova senha.
                </p>
                <p className="text-xs text-muted-foreground">
                  Não chegou em alguns minutos? Confira a caixa de spam ou envie novamente.
                </p>
                <div className="grid gap-2 pt-2">
                  <Button
                    type="button"
                    onClick={() => setForgotSentTo(null)}
                    variant="outline"
                    className="h-12 min-h-11 rounded-xl font-semibold"
                  >
                    Enviar novamente
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      setForgotSentTo(null);
                      setForgotMode(false);
                    }}
                    className="h-12 min-h-11 rounded-xl font-bold"
                    style={{ background: "var(--gradient-green)" }}
                  >
                    Voltar ao login
                  </Button>
                </div>
              </div>
            </AuthCard>
          ) : (
            <AuthCard>
              {!forgotMode && !recoveryMode && (
                <Tabs
                  value={isLogin ? "login" : "signup"}
                  onValueChange={(v) => setIsLogin(v === "login")}
                  className="mb-5"
                >
                  <TabsList className="grid w-full h-12 grid-cols-2 rounded-xl bg-secondary/70 p-1">
                    <TabsTrigger
                      value="login"
                      className="h-10 min-h-10 rounded-lg text-sm font-semibold data-[state=active]:bg-background data-[state=active]:shadow-sm"
                    >
                      Entrar
                    </TabsTrigger>
                    <TabsTrigger
                      value="signup"
                      className="h-10 min-h-10 rounded-lg text-sm font-semibold data-[state=active]:bg-background data-[state=active]:shadow-sm"
                    >
                      Criar conta
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              )}

              <form
                id={isLogin && !forgotMode && !recoveryMode ? "auth-login-form" : "auth-form"}
                method="post"
                onSubmit={recoveryMode ? handleSetNewPassword : forgotMode ? handleForgotPassword : handleSubmit}
                className="space-y-5"
                autoComplete={isLogin && !forgotMode ? (savePassword ? "on" : "off") : "on"}
              >
                {!isLogin && !forgotMode && !recoveryMode && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="name" className="text-sm font-medium text-foreground">
                        Nome completo
                      </Label>
                      <Input
                        id="name"
                        name="name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ex.: Maria Silva"
                        required
                        maxLength={120}
                        autoComplete="name"
                        className={inputClass}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone" className="text-sm font-medium text-foreground">
                        WhatsApp
                      </Label>
                      <Input
                        id="phone"
                        name="tel"
                        type="tel"
                        inputMode="numeric"
                        value={phone}
                        onChange={(e) => setPhone(maskWhatsAppInput(e.target.value))}
                        placeholder="(11) 99999-9999"
                        required
                        maxLength={16}
                        autoComplete="tel"
                        className={inputClass}
                      />
                    </div>
                  </>
                )}

                {!recoveryMode && (
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-sm font-medium text-foreground">
                      Email
                    </Label>
                    <Input
                      id="email"
                      name="username"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seu@email.com"
                      required
                      autoComplete={isLogin && !forgotMode ? "username" : "email"}
                      className={inputClass}
                    />
                  </div>
                )}

                {forgotMode && (
                  <p className="text-xs text-muted-foreground">
                    Enviaremos um link para você criar uma nova senha.
                  </p>
                )}

                {!forgotMode && (
                  <PasswordField
                    id={recoveryMode || !isLogin ? "new-password" : "password"}
                    name="password"
                    label={recoveryMode ? "Nova senha" : "Senha"}
                    value={password}
                    onChange={setPassword}
                    autoComplete={recoveryMode || !isLogin ? "new-password" : "current-password"}
                  />
                )}

                {isLogin && !forgotMode && !recoveryMode && (
                  <div className="flex items-center justify-between gap-3 -mt-1">
                    <label
                      htmlFor="save-password"
                      className="flex items-center gap-2.5 min-h-11 cursor-pointer select-none"
                    >
                      <Checkbox
                        id="save-password"
                        checked={savePassword}
                        onCheckedChange={(v) => {
                          const on = v === true;
                          setSavePassword(on);
                          writeSavePasswordPref(on);
                          if (!on) writeRememberedEmail(null);
                        }}
                        className="h-5 w-5"
                      />
                      <span className="text-sm text-foreground">Salvar senha</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setForgotSentTo(null);
                        setForgotMode(true);
                      }}
                      className="text-sm text-primary font-medium hover:underline underline-offset-4 min-h-11 px-2 -mr-2 inline-flex items-center shrink-0"
                    >
                      Esqueci a senha
                    </button>
                  </div>
                )}

                {((!isLogin && !forgotMode) || recoveryMode) && (
                  <PasswordField
                    id="confirmPassword"
                    name="confirmPassword"
                    label="Confirmar senha"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    autoComplete="new-password"
                  />
                )}

                {!isLogin && !forgotMode && !recoveryMode && (
                  <p className="text-xs text-muted-foreground leading-relaxed -mt-1">
                    Após criar a conta, aguarde a aprovação do Super Admin para acessar o painel.
                  </p>
                )}

                <Button
                  type="submit"
                  className="w-full h-12 min-h-11 text-base font-bold rounded-xl gap-2 transition-all duration-300 hover:shadow-lg"
                  style={{ background: "var(--gradient-green)" }}
                  disabled={loading}
                >
                  {loading ? (
                    <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
                  ) : (
                    <>
                      {recoveryMode
                        ? "Salvar nova senha"
                        : forgotMode
                          ? "Enviar link de recuperação"
                          : isLogin
                            ? "Entrar"
                            : "Criar conta"}
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </Button>

                {!forgotMode && !recoveryMode ? (
                  <div className="pt-0.5">{updateAppButton}</div>
                ) : null}
              </form>
            </AuthCard>
          )}

          {forgotMode && !forgotSentTo ? (
            <p className="text-center text-sm text-muted-foreground">
              Lembrou a senha?{" "}
              <button
                type="button"
                onClick={() => {
                  setForgotSentTo(null);
                  setForgotMode(false);
                }}
                className="text-primary font-semibold hover:underline underline-offset-4 min-h-11 px-2 inline-flex items-center"
              >
                Voltar ao login
              </button>
            </p>
          ) : null}

          {!forgotMode && !recoveryMode && !forgotSentTo ? (
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-1">
              <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-muted-foreground/60">
                <Zap className="w-3 h-3 shrink-0" />
                <span>PLATAFORMA PARA O CONSULTOR</span>
              </div>
              <div className="w-1 h-1 rounded-full bg-muted-foreground/20 hidden sm:block" />
              <div className="text-[10px] sm:text-xs text-muted-foreground/60">SUPORTE-IGREEN</div>
            </div>
          ) : null}
        </motion.div>
      </AnimatePresence>
      )}
    </AuthShell>
  );
};
export default Auth;
