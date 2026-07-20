// Kill switch global do bot — Fase 0 da auditoria.
// Permite ao super admin pausar TODO o bot/crons com 1 clique.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Power, PowerOff, Loader2, ShieldAlert } from "lucide-react";

export function BotGlobalKillSwitch() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("app_settings").select("bot_global_enabled").eq("id", "global").maybeSingle();
    setEnabled(data ? !!(data as any).bot_global_enabled : true);
  };

  useEffect(() => { void load(); }, []);

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("app_settings")
        .update({ bot_global_enabled: next, updated_at: new Date().toISOString(), updated_by: user?.id ?? null })
        .eq("id", "global");
      if (error) throw error;
      setEnabled(next);
      toast({
        title: next ? "Bot reativado globalmente" : "Bot pausado globalmente",
        description: next ? "Webhooks e crons voltaram a operar." : "Nenhuma resposta automática será enviada até reativar.",
      });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (enabled === null) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando kill switch…
      </div>
    );
  }

  const off = !enabled;

  return (
      <div className={`rounded-xl border p-4 transition-colors ${off ? "border-destructive/60 bg-destructive/10" : "border-border bg-card"}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className={`p-2 rounded-lg shrink-0 ${off ? "bg-destructive/20 text-destructive" : "bg-primary/15 text-primary"}`}>
          {off ? <PowerOff className="w-5 h-5" /> : <Power className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold text-sm">Assistente Global</h3>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${off ? "bg-destructive text-destructive-foreground" : "bg-primary/20 text-primary"}`}>
              {off ? "DESLIGADO" : "ATIVO"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Botão de emergência. Desligar interrompe as integrações automáticas e todos os envios programados (resgate, retorno, monitoramento, agendados).
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant={off ? "default" : "destructive"} disabled={saving} className="shrink-0">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : off ? "Reativar" : "Pausar"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-destructive" />
                {off ? "Reativar bot global?" : "Pausar bot global?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {off
                  ? "Todos os webhooks e crons voltarão a processar mensagens normalmente."
                  : "Nenhuma resposta automática será enviada por ninguém até você reativar. Use só em emergência."}
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
