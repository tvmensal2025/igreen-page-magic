import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Pause, Play, RefreshCw, ChevronDown, RotateCcw, Send, PowerOff, Power } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { resetLeadConversation } from "@/services/resetConversation";
import { ManualStepDialog } from "./ManualStepDialog";
import WinningConversationButton from "@/components/admin/WinningConversationButton";

type Variant = "A" | "B" | "C" | "D" | "E";

type Row = {
  id: string;
  name: string | null;
  phone_whatsapp: string;
  conversation_step: string | null;
  bot_paused: boolean;
  bot_paused_reason: string | null;
  assigned_human_id: string | null;
  last_bot_reply_at: string | null;
  updated_at: string;
  flow_variant: Variant | null;
};

type FlowStep = {
  id: string;
  step_key: string | null;
  step_type: string;
  title: string | null;
  position: number;
};

type FlowBundle = { name: string | null; steps: FlowStep[] };

export function LiveConversationsPanel({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [flowsByVariant, setFlowsByVariant] = useState<Record<Variant, FlowBundle>>({
    A: { name: null, steps: [] },
    B: { name: null, steps: [] },
    C: { name: null, steps: [] },
    D: { name: null, steps: [] },
    E: { name: null, steps: [] },
  });
  const [confirmReset, setConfirmReset] = useState<Row | null>(null);
  const [manualStepFor, setManualStepFor] = useState<Row | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("customers")
      .select("id, name, phone_whatsapp, conversation_step, bot_paused, bot_paused_reason, assigned_human_id, last_bot_reply_at, updated_at, flow_variant")
      .eq("consultant_id", userId)
      .order("updated_at", { ascending: false })
      .limit(80);
    setRows((data as any) || []);
    setLoading(false);
  }

  async function loadFlowSteps() {
    const { data: flows } = await supabase
      .from("bot_flows")
      .select("id, name, variant")
      .eq("consultant_id", userId)
      .eq("is_active", true);

    const next: Record<Variant, FlowBundle> = {
      A: { name: null, steps: [] },
      B: { name: null, steps: [] },
      C: { name: null, steps: [] },
    D: { name: null, steps: [] },
    E: { name: null, steps: [] },
    };

    if (flows?.length) {
      await Promise.all(
        flows.map(async (f: any) => {
          const variant = (f.variant || "A") as Variant;
          const { data: steps } = await supabase
            .from("bot_flow_steps")
            .select("id, step_key, step_type, title, position")
            .eq("flow_id", f.id)
            .eq("is_active", true)
            .order("position", { ascending: true });
          next[variant] = { name: f.name || null, steps: (steps as any) || [] };
        })
      );
    }

    setFlowsByVariant(next);
  }

  useEffect(() => { load(); loadFlowSteps(); }, [userId]);

  useEffect(() => {
    const ch = supabase
      .channel("ai-live-customers")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "customers", filter: `consultant_id=eq.${userId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  async function setPaused(id: string, paused: boolean) {
    // 1) tenta update direto (rápido, sob RLS do dono)
    const { error } = await supabase.from("customers").update({
      bot_paused: paused,
      bot_paused_reason: paused ? "humano_assumiu" : null,
      bot_paused_at: paused ? new Date().toISOString() : null,
      bot_paused_until: null,
      assigned_human_id: paused ? userId : null,
    }).eq("id", id);

    if (error) {
      console.warn("[setPaused] update direto falhou, tentando edge customer-takeover:", error);
      // 2) fallback via edge (cobre super admin agindo em customer de outro consultor)
      const { data, error: invErr } = await supabase.functions.invoke("customer-takeover", {
        body: { customerId: id, paused },
      });
      if (invErr || (data as any)?.error) {
        const msg = (data as any)?.message || (data as any)?.error || invErr?.message || error.message;
        toast({
          title: "Erro ao alterar atendimento",
          description: `${msg}${error.code ? ` (code=${error.code})` : ""}`,
          variant: "destructive",
        });
        return;
      }
    }
    toast({ title: paused ? "🤝 Você assumiu — a IA não vai mais mandar nada" : "🤖 IA reativada" });
    load();
  }

  function stepsForRow(row: Row): { variant: Variant; bundle: FlowBundle } {
    const variant: Variant = (row.flow_variant as Variant) || "A";
    const bundle = flowsByVariant[variant]?.steps.length
      ? flowsByVariant[variant]
      : flowsByVariant.A;
    return { variant, bundle };
  }

  function isLeadWithoutWhatsApp(row: Row): boolean {
    const p = String(row.phone_whatsapp || "");
    return p.startsWith("sem_celular_") || p.replace(/\D/g, "").length < 10;
  }

  async function returnToStep(row: Row, stepValue: string | null, label: string) {
    const update: any = {
      bot_paused: false,
      bot_paused_reason: null,
      bot_paused_at: null,
      bot_paused_until: null,
      assigned_human_id: null,
      last_custom_prompt_at: null,
      updated_at: new Date().toISOString(),
    };
    if (stepValue !== null) update.conversation_step = stepValue;
    const { error } = await supabase.from("customers").update(update).eq("id", row.id);
    if (error) {
      // fallback via edge para casos de RLS
      const { data, error: invErr } = await supabase.functions.invoke("customer-takeover", {
        body: { customerId: row.id, paused: false },
      });
      if (invErr || (data as any)?.error) {
        toast({
          title: "Erro ao devolver",
          description: (data as any)?.message || error.message,
          variant: "destructive",
        });
        return;
      }
      if (stepValue) {
        await supabase.from("customers").update({ conversation_step: stepValue }).eq("id", row.id);
      }
    }

    if (stepValue) {
      if (isLeadWithoutWhatsApp(row)) {
        toast({
          title: `↩️ Devolvido para: ${label}`,
          description: "Lead sem WhatsApp — passo gravado, mas nada foi enviado.",
        });
        load();
        return;
      }
      try {
        const { data, error: invErr } = await supabase.functions.invoke("manual-step-send", {
          body: { consultantId: userId, customerId: row.id, stepId: stepValue, part: "all", continueFlow: true },
        });
        if (invErr || (data as any)?.error || (data as any)?.ok === false) {
          const errMsg = (data as any)?.message || (data as any)?.error || invErr?.message || "falha ao disparar";
          throw new Error(errMsg);
        }
        toast({ title: `↩️ Devolvido e fluxo retomado: ${label}` });
      } catch (e: any) {
        toast({
          title: "Devolvido, mas falhou ao disparar passo",
          description: e?.message,
          variant: "destructive",
        });
      }
    } else {
      toast({ title: `↩️ Devolvido para: ${label}` });
    }
    load();
  }

  async function doReset(row: Row) {
    const res = await resetLeadConversation({ consultantId: userId, customerId: row.id });
    if (!res.ok) toast({ title: "Erro ao resetar", description: (res as any).error, variant: "destructive" });
    else { toast({ title: "🔄 Conversa reiniciada" }); load(); }
    setConfirmReset(null);
  }

  const [confirmStopAll, setConfirmStopAll] = useState(false);
  const [stopAllBusy, setStopAllBusy] = useState(false);
  async function stopAll() {
    setStopAllBusy(true);
    try {
      const { error, count } = await supabase
        .from("customers")
        .update(
          {
            bot_paused: true,
            bot_paused_reason: "manual_global_pause",
            bot_paused_at: new Date().toISOString(),
            bot_paused_until: null,
            assigned_human_id: userId,
            updated_at: new Date().toISOString(),
          },
          { count: "exact" },
        )
        .eq("consultant_id", userId);
      if (error) throw error;
      toast({ title: `🛑 IA pausada em ${count ?? 0} lead(s)` });
      await load();
    } catch (e: any) {
      toast({ title: "Erro ao pausar", description: e?.message, variant: "destructive" });
    } finally {
      setStopAllBusy(false);
      setConfirmStopAll(false);
    }
  }

  async function resumeAll() {
    setStopAllBusy(true);
    try {
      const { error, count } = await supabase
        .from("customers")
        .update(
          {
            bot_paused: false,
            bot_paused_reason: null,
            bot_paused_at: null,
            bot_paused_until: null,
            assigned_human_id: null,
            updated_at: new Date().toISOString(),
          },
          { count: "exact" },
        )
        .eq("consultant_id", userId)
        .eq("bot_paused", true)
        .eq("bot_paused_reason", "manual_global_pause");
      if (error) throw error;
      toast({ title: `🤖 IA religada em ${count ?? 0} lead(s)` });
      await load();
    } catch (e: any) {
      toast({ title: "Erro ao religar", description: e?.message, variant: "destructive" });
    } finally {
      setStopAllBusy(false);
    }
  }


  if (loading) return <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  const active = rows.filter((r) => !r.bot_paused);
  const human = rows.filter((r) => r.bot_paused);

  const renderReturnMenu = (r: Row) => {
    const { variant, bundle } = stepsForRow(r);
    const steps = bundle.steps;
    return (
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => setManualStepFor(r)} className="gap-1.5">
          <Send className="w-4 h-4" /> Enviar passo
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="default" className="gap-1.5">
              <Play className="w-4 h-4" /> Devolver para… <ChevronDown className="w-3.5 h-3.5 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 max-h-[420px] overflow-y-auto">
            <DropdownMenuLabel className="text-xs">
              <Badge variant="outline" className="mr-1.5">Variante {variant}</Badge>
              <span className="text-muted-foreground">{bundle.name || "Fluxo do consultor"}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => returnToStep(r, null, "Continuar de onde parou")}>
              <Play className="w-4 h-4 mr-2 text-primary" /> Continuar de onde parou
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
              Passos do fluxo
            </DropdownMenuLabel>
            {steps.length === 0 ? (
              <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                Nenhum passo configurado para este fluxo.
              </DropdownMenuItem>
            ) : (
              steps.map((s, i) => (
                <DropdownMenuItem key={s.id} onClick={() => returnToStep(r, s.id, s.title || s.step_key || `Passo ${i + 1}`)}>
                  <span className="text-xs font-mono text-muted-foreground mr-2 w-6">{String(i + 1).padStart(2, "0")}</span>
                  <span className="truncate">{s.title || s.step_key || `Passo ${i + 1}`}</span>
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setConfirmReset(r)}
              className="text-rose-500 focus:text-rose-500"
            >
              <RotateCcw className="w-4 h-4 mr-2" /> Reiniciar conversa do zero
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  const globalPausedCount = rows.filter((r) => r.bot_paused_reason === "manual_global_pause").length;

  return (
    <div className="space-y-6">
      <Card className="p-4 border-destructive/40 bg-destructive/5 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <p className="font-semibold text-foreground text-sm">🛑 Parar IA de todos os meus leads</p>
          <p className="text-xs text-muted-foreground">
            Pausa a IA em TODAS as suas conversas ativas. Use quando quiser assumir tudo de uma vez.
            {globalPausedCount > 0 && <> Atualmente <strong>{globalPausedCount}</strong> lead(s) com pausa global.</>}
          </p>
        </div>
        {globalPausedCount > 0 && (
          <Button size="sm" variant="outline" onClick={resumeAll} disabled={stopAllBusy} className="gap-2">
            <Power className="w-4 h-4" /> Religar IA
          </Button>
        )}
        <Button
          size="sm"
          variant="destructive"
          onClick={() => setConfirmStopAll(true)}
          disabled={stopAllBusy || active.length === 0}
          className="gap-2"
        >
          {stopAllBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PowerOff className="w-4 h-4" />}
          Parar IA em {active.length} lead(s)
        </Button>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{active.length} com IA · {human.length} com humano</p>
        <Button size="sm" variant="ghost" onClick={load} className="gap-2"><RefreshCw className="w-4 h-4" /> Atualizar</Button>
      </div>


      <Section title="🤖 IA atendendo" rows={active} action={(r) => (
        <Button size="sm" variant="outline" onClick={() => setPaused(r.id, true)} className="gap-2">
          <Pause className="w-4 h-4" /> Assumir
        </Button>
      )} />

      <Section title="👤 Você está atendendo" rows={human} action={renderReturnMenu} />

      <AlertDialog open={!!confirmReset} onOpenChange={(o) => !o && setConfirmReset(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reiniciar conversa?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso apaga o histórico, memória e decisões da IA para <strong>{confirmReset?.name || confirmReset?.phone_whatsapp}</strong>. O lead volta para o início do fluxo. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmReset && doReset(confirmReset)}>
              Reiniciar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmStopAll} onOpenChange={setConfirmStopAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Parar IA em todos os {active.length} lead(s) ativos?</AlertDialogTitle>
            <AlertDialogDescription>
              A IA não vai responder a nenhuma das suas conversas até você clicar em <strong>Religar IA</strong> ou <strong>Devolver para…</strong> em cada lead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={stopAll} className="bg-destructive hover:bg-destructive/90">
              Sim, parar tudo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {manualStepFor && (
        <ManualStepDialog
          open={!!manualStepFor}
          onOpenChange={(o) => !o && setManualStepFor(null)}
          consultantId={userId}
          customerId={manualStepFor.id}
          customerName={manualStepFor.name}
        />
      )}
    </div>
  );
}

function Section({ title, rows, action }: { title: string; rows: Row[]; action: (r: Row) => React.ReactNode }) {
  if (!rows.length) return (
    <div>
      <h3 className="font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">Nenhum no momento.</p>
    </div>
  );
  return (
    <div>
      <h3 className="font-semibold text-foreground mb-2">{title} ({rows.length})</h3>
      <div className="grid gap-2">
        {rows.map((r) => (
          <Card key={r.id} className="p-3 flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <p className="font-medium text-foreground text-sm">{r.name || r.phone_whatsapp}</p>
              <p className="text-xs text-muted-foreground">{r.phone_whatsapp}</p>
            </div>
            <Badge variant="secondary" className="text-xs">{r.conversation_step || "—"}</Badge>
            {r.flow_variant && <Badge variant="outline" className="text-xs">Var {r.flow_variant}</Badge>}
            {r.bot_paused_reason && <Badge variant="outline" className="text-xs">{r.bot_paused_reason}</Badge>}
            <span className="text-xs text-muted-foreground">
              {r.last_bot_reply_at ? formatDistanceToNow(new Date(r.last_bot_reply_at), { addSuffix: true, locale: ptBR }) : "—"}
            </span>
            <WinningConversationButton customerId={r.id} compact />
            {action(r)}
          </Card>
        ))}
      </div>
    </div>
  );
}
