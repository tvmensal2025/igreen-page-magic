import { useState } from "react";
import { KeyRound, Loader2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { toUserFacingError } from "@/lib/userFacingError";

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

/**
 * Card para o usuário trocar a própria senha dentro das Configurações.
 *
 * O fluxo digita a senha atual e a nova senha (sem link por e-mail).
 * Como o Supabase não confere a senha atual no `updateUser`, primeiro
 * revalidamos a senha atual com `signInWithPassword` e só então aplicamos
 * a nova senha.
 */
export function ChangePasswordCard() {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const reset = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (!currentPassword) {
      toast({ title: "Informe sua senha atual.", variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: "A nova senha deve ter pelo menos 6 caracteres.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "As senhas não coincidem.", variant: "destructive" });
      return;
    }
    if (newPassword === currentPassword) {
      toast({ title: "A nova senha deve ser diferente da atual.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      // Descobre o e-mail do usuário logado para revalidar a senha atual.
      const { data: userData } = await withAuthTimeout(
        supabase.auth.getUser(),
        "Não foi possível validar seu usuário agora. Tente novamente."
      );
      const email = userData.user?.email;
      if (!email) throw new Error("Não foi possível identificar seu usuário. Entre novamente.");

      // 1) Revalida a senha atual.
      const { error: signInError } = await withAuthTimeout(
        supabase.auth.signInWithPassword({
          email,
          password: currentPassword,
        }),
        "A validação da senha atual demorou demais. Tente novamente."
      );
      if (signInError) {
        throw new Error("Senha atual incorreta.");
      }

      // 2) Aplica a nova senha.
      const { error: updateError } = await withAuthTimeout(
        supabase.auth.updateUser({ password: newPassword }),
        "A alteração de senha demorou demais. Tente novamente."
      );
      if (updateError) throw updateError;

      toast({ title: "Senha alterada!", description: "Use a nova senha no próximo acesso." });
      reset();
    } catch (error: unknown) {
      toast({
        title: "Não foi possível alterar a senha",
        description: toUserFacingError(error, "Tente novamente."),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div>
        <h3 className="font-semibold flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> Trocar senha
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Digite sua senha atual e a nova senha. A troca é feita aqui mesmo, sem link por e-mail.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="current-password" className="text-xs">Senha atual</Label>
          <div className="relative">
            <Input
              id="current-password"
              type={showCurrent ? "text" : "password"}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              className="pr-9"
            />
            <button
              type="button"
              onClick={() => setShowCurrent((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showCurrent ? "Ocultar senha" : "Mostrar senha"}
            >
              {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="new-password" className="text-xs">Nova senha</Label>
          <div className="relative">
            <Input
              id="new-password"
              type={showNew ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className="pr-9"
            />
            <button
              type="button"
              onClick={() => setShowNew((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showNew ? "Ocultar senha" : "Mostrar senha"}
            >
              {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm-password" className="text-xs">Confirmar nova senha</Label>
          <Input
            id="confirm-password"
            type={showNew ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        <Button type="submit" disabled={saving} size="sm">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <KeyRound className="h-4 w-4 mr-2" />}
          Salvar nova senha
        </Button>
      </form>
    </div>
  );
}
