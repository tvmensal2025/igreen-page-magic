// Toggle para ativar/desativar o bloqueio de DevTools (F12 / inspecionar).
// Camada DISSUASÓRIA — afasta curioso leigo. Segurança real está no backend.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ShieldCheck, ShieldOff, Loader2, ShieldAlert } from "lucide-react";

export function DevToolsBlockToggle() {
  const { toast } = useToast();
  const [blocked, setBlocked] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("app_settings")
      .select("devtools_blocked")
      .eq("id", "global")
      .maybeSingle();
    setBlocked(data ? !!(data as any).devtools_blocked : true);
  };

  useEffect(() => { void load(); }, []);

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("app_settings")
        .update({
          devtools_blocked: next,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq("id", "global");
      if (error) throw error;
      setBlocked(next);
      toast({
        title: next ? "Bloqueio de inspecionar ativado" : "Bloqueio de inspecionar desativado",
        description: next
          ? "F12, clique direito e atalhos de inspecionar bloqueados. Gravação de tela continua liberada."
          : "DevTools liberado. Útil para debug temporário.",
      });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (blocked === null) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando estado do bloqueio…
      </div>
    );
  }

  const off = !blocked;

  return (
    <div className={`rounded-xl border p-4 transition-colors ${off ? "border-warning/60 bg-warning/10" : "border-border bg-card"}`}>
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${off ? "bg-warning/20 text-warning" : "bg-primary/15 text-primary"}`}>
          {off ? <ShieldOff className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm">Bloqueio DevTools / F12</h3>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${off ? "bg-warning text-warning-foreground" : "bg-primary/20 text-primary"}`}>
              {off ? "DESATIVADO" : "ATIVO"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Quando ativo, impede F12, clique direito e atalhos de inspecionar (anti-curioso).
            Não bloqueia gravação de tela nem PrintScreen. Desative se precisar debugar no navegador.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant={off ? "default" : "outline"} disabled={saving} className="shrink-0">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : off ? "Ativar" : "Desativar"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-warning" />
                {off ? "Ativar bloqueio de DevTools?" : "Desativar bloqueio de DevTools?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {off
                  ? "Usuários não conseguirão abrir o inspecionar (F12, clique direito, atalhos). Gravação de tela e PrintScreen continuam liberados. Efeito no próximo carregamento da página."
                  : "O DevTools ficará acessível para qualquer um até você reativar o bloqueio."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => void toggle(off)}>Confirmar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
