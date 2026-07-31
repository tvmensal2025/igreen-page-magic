// Kill switch global do bot — Fase 0 da auditoria.
// Permite ao super admin pausar TODO o bot/crons com 1 clique.
// Ao reativar: mostra leads com inbound sem 1ª resposta e permite catch-up opcional
// (só se o operador marcar — não dispara envio em massa automático).
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Power, PowerOff, Loader2, ShieldAlert } from "lucide-react";

const CATCHUP_LOOKBACK_HOURS = 48;
const CATCHUP_MAX = 15;

type PendingLead = { id: string; consultant_id: string | null; name: string | null };

async function listUnrepliedInboundLeads(): Promise<PendingLead[]> {
  const since = new Date(Date.now() - CATCHUP_LOOKBACK_HOURS * 3600_000).toISOString();
  const { data: customers, error } = await supabase
    .from("customers")
    .select("id, name, consultant_id, welcome_sent_at, bot_paused, do_not_contact")
    .is("welcome_sent_at", null)
    .eq("bot_paused", false)
    .eq("do_not_contact", false)
    .gte("created_at", since)
    .limit(80);

  if (error || !customers?.length) return [];

  const pending: PendingLead[] = [];
  for (const c of customers as Array<{
    id: string;
    name: string | null;
    consultant_id: string | null;
  }>) {
    if (pending.length >= CATCHUP_MAX) break;
    const { count: inCount } = await supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", c.id)
      .eq("message_direction", "inbound");
    if ((inCount ?? 0) === 0) continue;

    const { count: outCount } = await supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", c.id)
      .eq("message_direction", "outbound");
    if ((outCount ?? 0) > 0) continue;

    pending.push({ id: c.id, consultant_id: c.consultant_id, name: c.name });
  }
  return pending;
}

export function BotGlobalKillSwitch() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingLeads, setPendingLeads] = useState<PendingLead[]>([]);
  const [catchUp, setCatchUp] = useState(false);
  const [loadingPending, setLoadingPending] = useState(false);

  const load = async () => {
    const { data, error } = await supabase.from("app_settings").select("bot_global_enabled").eq("id", "global").maybeSingle();
    // Sem leitura confiável (RLS/erro) NÃO assumimos "ATIVO": manter carregando evita
    // que o super admin veja "ATIVO" quando o bot pode estar desligado.
    if (error) return;
    setEnabled(data ? !!(data as any).bot_global_enabled : true);

  };

  useEffect(() => { void load(); }, []);

  const refreshPending = async () => {
    setLoadingPending(true);
    try {
      const list = await listUnrepliedInboundLeads();
      setPendingLeads(list);
      setPendingCount(list.length);
      setCatchUp(false);
    } finally {
      setLoadingPending(false);
    }
  };

  const runCatchUp = async (leads: PendingLead[]) => {
    let ok = 0;
    let fail = 0;
    for (const lead of leads) {
      if (!lead.consultant_id) {
        fail++;
        continue;
      }
      const { data, error } = await supabase.functions.invoke("start-customer-attendance", {
        body: { customerId: lead.id, consultantId: lead.consultant_id },
      });
      if (error || (data && (data as { ok?: boolean }).ok === false)) fail++;
      else ok++;
      await new Promise((r) => setTimeout(r, 600));
    }
    return { ok, fail };
  };

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

      let catchUpMsg = "";
      if (next && catchUp && pendingLeads.length > 0) {
        const result = await runCatchUp(pendingLeads);
        catchUpMsg = ` Catch-up: ${result.ok} ok, ${result.fail} falha.`;
      }

      toast({
        title: next ? "Bot reativado globalmente" : "Bot pausado globalmente",
        description: next
          ? `Novas mensagens voltam a ter resposta automática.${catchUpMsg}`
          : "Inbound continua gravando, mas nenhuma resposta automática será enviada até reativar.",
      });
      setCatchUp(false);
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
            Botão de emergência. Desligar interrompe respostas automáticas e envios programados.
            Mensagens do cliente continuam sendo gravadas — ao reativar, confira leads sem 1ª resposta.
          </p>
        </div>
        <AlertDialog
          onOpenChange={(open) => {
            if (open && off) void refreshPending();
          }}
        >
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
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm text-muted-foreground">
                  {off ? (
                    <>
                      <p>Webhooks e crons voltam a processar. Novos inbound passam a ter resposta automática.</p>
                      {loadingPending ? (
                        <p className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Verificando leads pendentes…</p>
                      ) : pendingCount > 0 ? (
                        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-foreground space-y-2">
                          <p className="font-medium text-sm">
                            {pendingCount} lead(s) com mensagem e sem 1ª resposta (últimas {CATCHUP_LOOKBACK_HOURS}h).
                          </p>
                          <label className="flex items-start gap-2 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={catchUp}
                              onChange={(e) => setCatchUp(e.target.checked)}
                            />
                            <span>
                              Também iniciar atendimento nesses leads agora (máx. {CATCHUP_MAX}).
                              Só marque se quiser enviar o welcome — não é automático.
                            </span>
                          </label>
                        </div>
                      ) : (
                        <p>Nenhum lead pendente de 1ª resposta nas últimas {CATCHUP_LOOKBACK_HOURS}h.</p>
                      )}
                    </>
                  ) : (
                    <p>
                      Nenhuma resposta automática será enviada até você reativar.
                      O WhatsApp continua recebendo e gravando mensagens. Use só em emergência.
                    </p>
                  )}
                </div>
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
