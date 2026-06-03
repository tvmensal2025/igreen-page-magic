import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, ArrowRight, Zap } from "lucide-react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import BrandLogo from "@/components/common/BrandLogo";

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

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [igreenId, setIgreenId] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const checkAdminAndNavigate = async (_userId: string) => {
    navigate("/admin");
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        checkAdminAndNavigate(session.user.id);
      }
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        checkAdminAndNavigate(session.user.id);
      }
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (!isLogin && password !== confirmPassword) {
        throw new Error("As senhas não coincidem.");
      }

      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast({ title: "Login realizado com sucesso!" });
      } else {
        if (!name.trim()) throw new Error("Informe seu nome completo.");
        if (!phone.trim()) throw new Error("Informe seu WhatsApp.");

        await supabase.auth.signOut();
        const { data: signUpData, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
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

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden bg-background">
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

      <div className="w-full max-w-md space-y-8 relative z-10">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div className="relative">
              <BrandLogo className="w-44 drop-shadow-lg" alt="iGreen Energy" />
              <div className="absolute -inset-4 bg-primary/10 rounded-3xl blur-2xl -z-10" />
            </div>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold font-heading text-foreground tracking-tight">
            {isLogin ? "Bem-vindo de volta" : "Crie sua conta"}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">Painel do Consultor iGreen Energy</p>
        </div>

        <div className="relative">
          <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-transparent to-accent/20 rounded-3xl blur-xl opacity-50" />
          <form onSubmit={handleSubmit} className="relative space-y-5 bg-card/80 backdrop-blur-xl p-7 sm:p-8 rounded-2xl border border-border shadow-xl">
            <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

            {!isLogin && (
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
                <div className="space-y-2">
                  <Label htmlFor="igreenId" className="text-sm font-medium text-foreground">ID iGreen (opcional)</Label>
                  <Input id="igreenId" type="text" value={igreenId} onChange={(e) => setIgreenId(e.target.value)}
                    placeholder="Seu código de consultor iGreen" maxLength={40}
                    className="h-12 rounded-xl bg-secondary/50 border-border text-base placeholder:text-muted-foreground/50" />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium text-foreground">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com" required
                className="h-12 rounded-xl bg-secondary/50 border-border text-base placeholder:text-muted-foreground/50" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium text-foreground">Senha</Label>
              <div className="relative">
                <Input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••" required minLength={6}
                  className="h-12 rounded-xl bg-secondary/50 border-border text-base pr-12 placeholder:text-muted-foreground/50" />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-sm font-medium text-foreground">Confirmar Senha</Label>
                <div className="relative">
                  <Input id="confirmPassword" type={showConfirmPassword ? "text" : "password"} value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" required minLength={6}
                    className="h-12 rounded-xl bg-secondary/50 border-border text-base pr-12 placeholder:text-muted-foreground/50" />
                  <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}
            <Button type="submit" className="w-full h-12 text-base font-bold rounded-xl gap-2 transition-all duration-300 hover:shadow-lg"
              style={{ background: "var(--gradient-green)" }} disabled={loading}>
              {loading ? <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" /> : (
                <>{isLogin ? "Entrar" : "Criar conta"}<ArrowRight className="w-4 h-4" /></>
              )}
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          {isLogin ? "Não tem conta?" : "Já tem conta?"}{" "}
          <button onClick={() => setIsLogin(!isLogin)} className="text-primary font-semibold hover:underline underline-offset-4">
            {isLogin ? "Criar conta" : "Fazer login"}
          </button>
        </p>

        <div className="flex items-center justify-center gap-4 pt-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
            <Zap className="w-3 h-3" /><span>Plataforma segura</span>
          </div>
          <div className="w-1 h-1 rounded-full bg-muted-foreground/20" />
          <div className="text-xs text-muted-foreground/60">256-bit SSL</div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
