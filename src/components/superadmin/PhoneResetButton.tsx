import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useUserRole } from "@/hooks/useUserRole";
import {
  adminHardResetPhone,
  adminHardResetPhoneTraceCounts,
} from "@/services/resetConversation";

/**
 * Botão compacto de manutenção (somente super admin).
 * Mostra o número de teste e permite zerar TODOS os rastros dele na base,
 * para que ele comece do zero como se fosse um número novo.
 */
const RESET_PHONE = "11971254913";

interface PhoneResetButtonProps {
  /** Usuário logado; usado para checar se é super admin. */
  userId: string;
}

export function PhoneResetButton({ userId }: PhoneResetButtonProps) {
  const { isSuperAdmin } = useUserRole(userId);
  const { toast } = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [resetting, setResetting] = useState(false);

  // Só super admin enxerga o botão.
  if (!isSuperAdmin) return null;

  const handleReset = async () => {
    const ok = await confirm({
      title: `Resetar o número ${RESET_PHONE}?`,
      description:
        "Apaga customer (inclui soft-delete com sufixo), conversas, deals, fluxo, IA, CRM, logs, opt-out e DNC. Volta a ser número novo para teste. NÃO pode ser desfeito.",
      confirmText: "Resetar do zero",
      tone: "danger",
    });
    if (!ok) return;

    setResetting(true);
    try {
      const res = await adminHardResetPhone(RESET_PHONE);
      if (res.ok !== true) {
        toast({ title: "Erro no reset", description: res.error, variant: "destructive" });
        return;
      }
      const trace = await adminHardResetPhoneTraceCounts(RESET_PHONE);
      if (trace.ok && trace.totalRemaining > 0) {
        const remaining = Object.entries(trace.counts)
          .filter(([, n]) => Number(n) > 0)
          .map(([k, n]) => `${k}: ${n}`)
          .join(" · ");
        toast({
          title: "Reset incompleto",
          description: `Ainda restam ${trace.totalRemaining} rastros: ${remaining}`,
          variant: "destructive",
        });
        queryClient.invalidateQueries();
        return;
      }
      toast({
        title: "✅ Número zerado",
        description: `${trace.ok ? trace.phoneNormalized : res.phoneNormalized} pronto para começar do zero.`,
      });
      queryClient.invalidateQueries();
    } catch (err: unknown) {
      toast({
        title: "Erro no reset",
        description: err instanceof Error ? err.message : "Erro",
        variant: "destructive",
      });
    } finally {
      setResetting(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleReset}
      disabled={resetting}
      title={`Apaga todos os rastros de ${RESET_PHONE} e reinicia do zero`}
      className="h-7 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
    >
      {resetting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
      <span className="text-[11px] font-medium">
        {resetting ? "Resetando..." : (
          <>
            <span className="sm:hidden">Resetar</span>
            <span className="hidden sm:inline">Resetar {RESET_PHONE}</span>
          </>
        )}
      </span>
    </Button>
  );
}
