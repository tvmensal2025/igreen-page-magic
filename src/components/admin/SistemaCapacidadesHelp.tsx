import { useEffect, useState } from "react";
import { HelpCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { CentralAutomacoesControle } from "@/components/admin/CentralAutomacoesControle";

type Props = {
  label?: string;
  className?: string;
};

/**
 * Guia / atalho de controle — painel lateral amplo (não um dialog apertado).
 */
export function SistemaCapacidadesHelp({ label = "Guia", className }: Props) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const { isAdmin, loading: roleLoading } = useUserRole(userId);
  const canToggle = isAdmin && !roleLoading;

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setUserId(data.user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={`gap-1.5 rounded-full ${className ?? ""}`}
          title="Abrir guia e controle das automações"
        >
          <HelpCircle className="h-4 w-4" />
          <span className="hidden sm:inline">{label}</span>
          <span className="sm:hidden">?</span>
        </Button>
      </SheetTrigger>
                  <SheetContent
        side="right"
        className="w-full !max-w-none sm:!max-w-xl md:!max-w-2xl overflow-y-auto p-0"
      >
        <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur px-6 py-4 pr-12">
          <SheetHeader className="space-y-1 text-left">
            <SheetTitle className="text-xl">Guia e controle</SheetTitle>
            <SheetDescription className="text-sm leading-relaxed">
              Veja o que o sistema faz e ligue só o que autorizar.
              {!canToggle && !roleLoading
                ? " Você pode ver o estado; só o admin altera."
                : " Desligado = não manda mensagem sozinho."}
            </SheetDescription>
          </SheetHeader>
        </div>
        <div className="px-6 py-5">
          {open && <CentralAutomacoesControle canToggle={canToggle} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
