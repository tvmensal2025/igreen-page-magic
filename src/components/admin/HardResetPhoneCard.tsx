import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import {
  adminHardResetPhone,
  adminHardResetPhoneTraceCounts,
} from "@/services/resetConversation";

interface HardResetPhoneCardProps {
  /** Optional override; defaults to current auth user. */
  userId?: string;
  className?: string;
}

/**
 * TEMPORÁRIO: card de manutenção para apagar TODOS os rastros de um telefone.
 * Para remover do app, basta deletar este arquivo e seus imports/usos.
 */
export function HardResetPhoneCard({ userId, className }: HardResetPhoneCardProps) {
  const [authUserId, setAuthUserId] = useState<string>(userId ?? "");
  useEffect(() => {
    if (userId) {
      setAuthUserId(userId);
      return;
    }
    supabase.auth.getUser().then(({ data }) => setAuthUserId(data.user?.id ?? ""));
  }, [userId]);
  const { isAdmin } = useUserRole(authUserId);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [resetPhone, setResetPhone] = useState("11971254913");
  const [resetting, setResetting] = useState(false);

  if (!isAdmin) return null;

  const handleHardResetPhone = async () => {
    const phone = resetPhone.trim();
    if (!phone) {
      toast({ title: "Informe um telefone", variant: "destructive" });
      return;
    }
    if (
      !confirm(
        `APAGAR TODOS os rastros do telefone ${phone}?\n\nIsto apaga customers, mensagens, fluxo, IA, CRM, logs e eventos relacionados. NÃO pode ser desfeito.`,
      )
    )
      return;
    setResetting(true);
    try {
      const res = await adminHardResetPhone(phone);
      if (res.ok !== true) {
        toast({ title: "Erro no reset", description: res.error, variant: "destructive" });
        return;
      }
      const totals = Object.entries(res.deleted)
        .filter(([, n]) => typeof n === "number" && n > 0)
        .map(([k, n]) => `${k}: ${n}`)
        .join(" · ");
      const trace = await adminHardResetPhoneTraceCounts(phone);
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
        title: "✅ Telefone zerado confirmado",
        description: `${trace.ok ? trace.phoneNormalized : res.phoneNormalized} — ${totals || "nada a apagar"}`,
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
    <div
      className={`rounded-xl border border-destructive/40 bg-destructive/5 p-3 sm:p-4 space-y-2 ${className ?? ""}`}
    >
      <div className="flex items-center gap-2 text-destructive">
        <Trash2 className="w-4 h-4" />
        <span className="text-sm font-semibold">Manutenção: reset geral por telefone</span>
        <span className="text-[10px] uppercase tracking-wide bg-destructive/20 text-destructive px-2 py-0.5 rounded-full">
          temporário
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Apaga TODOS os rastros do número (customers, mensagens, fluxo, IA, CRM, deals, logs, eventos). Não pode ser desfeito.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          value={resetPhone}
          onChange={(e) => setResetPhone(e.target.value)}
          placeholder="Ex.: 11971254913 ou 5511971254913"
          className="h-9 text-sm"
          disabled={resetting}
        />
        <Button
          variant="destructive"
          size="sm"
          onClick={handleHardResetPhone}
          disabled={resetting || !resetPhone.trim()}
          className="h-9 gap-2"
        >
          {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          {resetting ? "Resetando..." : "Resetar telefone"}
        </Button>
      </div>
    </div>
  );
}
