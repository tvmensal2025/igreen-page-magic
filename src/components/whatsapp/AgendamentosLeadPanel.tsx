import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { labelCadenceStage } from "@/lib/cadenceStageLabels";
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
import { Loader2, RefreshCw, Users, ShieldAlert } from "lucide-react";
import { toast } from "@/components/ui/sonner";

type LeadRow = {
  id: string;
  stage: string;
  next_action_at: string | null;
  paused_until: string | null;
  paused_reason: string | null;
  name: string | null;
  phone: string;
  digits: string;
  ddd: string;
};

function digitsOnly(phone: string): string {
  return (phone || "").replace(/\D/g, "");
}

function extractDdd(digits: string): string {
  if (digits.startsWith("55") && digits.length >= 4) return digits.slice(2, 4);
  if (digits.length >= 2) return digits.slice(0, 2);
  return "??";
}

const LEAD_DDD_DEFAULT = "34";

/**
 * Aba Lead — separar o que é lead (DDD alvo) do que não é,
 * sem apagar registros. Não-leads ficam pausados no motor.
 */
export function AgendamentosLeadPanel() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [leadDdd, setLeadDdd] = useState(LEAD_DDD_DEFAULT);
  const [showOnlyLeadDdd, setShowOnlyLeadDdd] = useState(false);
  const [confirmPause, setConfirmPause] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: states, error } = await supabase
      .from("lead_cadence_state")
      .select("id, stage, next_action_at, paused_until, paused_reason, customer_id")
      .not("stage", "in", "(WON,PAUSED,RETARGET_META)")
      .order("next_action_at", { ascending: true })
      .limit(500);
    if (error) {
      toast.error("Falha ao carregar leads do motor");
      setRows([]);
      setLoading(false);
      return;
    }
    const list = states || [];
    const custIds = [...new Set(list.map((r) => r.customer_id).filter(Boolean))];
    const { data: custs } = custIds.length
      ? await supabase.from("customers").select("id, name, phone_whatsapp").in("id", custIds)
      : { data: [] as { id: string; name: string | null; phone_whatsapp: string | null }[] };
    const cmap = new Map((custs || []).map((c) => [c.id, c]));
    setRows(
      list.map((r) => {
        const c = cmap.get(r.customer_id);
        const phone = c?.phone_whatsapp || "";
        const digits = digitsOnly(phone);
        return {
          id: r.id,
          stage: r.stage,
          next_action_at: r.next_action_at,
          paused_until: r.paused_until,
          paused_reason: r.paused_reason,
          name: c?.name ?? null,
          phone,
          digits,
          ddd: extractDdd(digits),
        };
      }),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byDdd = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.ddd, (m.get(r.ddd) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const leadRows = useMemo(() => rows.filter((r) => r.ddd === leadDdd), [rows, leadDdd]);
  const nonLeadRows = useMemo(() => rows.filter((r) => r.ddd !== leadDdd), [rows, leadDdd]);
  const visible = showOnlyLeadDdd ? leadRows : rows;

  async function pauseNonLeads() {
    if (nonLeadRows.length === 0) {
      toast.message("Nenhum contato fora do DDD lead");
      setConfirmPause(false);
      return;
    }
    setBusy(true);
    const until = new Date(Date.now() + 3650 * 24 * 3600_000).toISOString(); // ~10 anos
    const ids = nonLeadRows.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 80) {
      const chunk = ids.slice(i, i + 80);
      const { error } = await supabase
        .from("lead_cadence_state")
        .update({
          paused_until: until,
          paused_reason: `not_lead_outside_ddd${leadDdd}`,
          next_action_at: until,
        })
        .in("id", chunk);
      if (error) {
        toast.error("Falha ao pausar não-leads: " + error.message);
        setBusy(false);
        setConfirmPause(false);
        return;
      }
    }
    toast.success(`${nonLeadRows.length} não-leads pausados (DDD ≠ ${leadDdd})`);
    setBusy(false);
    setConfirmPause(false);
    await load();
  }

  async function releaseLeadDdd() {
    if (leadRows.length === 0) {
      toast.message(`Nenhum lead DDD ${leadDdd} no motor`);
      setConfirmRelease(false);
      return;
    }
    setBusy(true);
    const now = new Date().toISOString();
    const ids = leadRows.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 80) {
      const chunk = ids.slice(i, i + 80);
      const { error } = await supabase
        .from("lead_cadence_state")
        .update({
          paused_until: null,
          paused_reason: null,
          next_action_at: now,
        })
        .in("id", chunk);
      if (error) {
        toast.error("Falha ao liberar leads: " + error.message);
        setBusy(false);
        setConfirmRelease(false);
        return;
      }
    }
    toast.success(`${leadRows.length} leads DDD ${leadDdd} liberados (motor ainda precisa estar ON)`);
    setBusy(false);
    setConfirmRelease(false);
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 flex gap-2">
        <Users className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div className="text-[11px] text-foreground space-y-1">
          <p className="font-semibold">Separar lead × não-lead por DDD</p>
          <p className="text-muted-foreground">
            Padrão: DDD <strong className="text-foreground">{leadDdd}</strong> = lead.
            Demais DDDs (ex.: 11) pausam no motor — <strong className="text-foreground">nada é apagado</strong>.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground flex items-center gap-1.5">
          DDD lead
          <select
            className="h-8 rounded-md border bg-background px-2 text-xs"
            value={leadDdd}
            onChange={(e) => setLeadDdd(e.target.value)}
          >
            {byDdd.length === 0 ? (
              <option value={LEAD_DDD_DEFAULT}>{LEAD_DDD_DEFAULT}</option>
            ) : (
              byDdd.map(([ddd, n]) => (
                <option key={ddd} value={ddd}>
                  {ddd} ({n})
                </option>
              ))
            )}
            {!byDdd.some(([d]) => d === "34") && <option value="34">34</option>}
          </select>
        </label>
        <Badge variant="default" className="text-[10px]">
          Lead DDD {leadDdd}: {leadRows.length}
        </Badge>
        <Badge variant="secondary" className="text-[10px]">
          Fora: {nonLeadRows.length}
        </Badge>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground ml-auto">
          <Switch checked={showOnlyLeadDdd} onCheckedChange={setShowOnlyLeadDdd} />
          Só DDD lead
        </div>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => void load()} disabled={loading || busy}>
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {byDdd.map(([ddd, n]) => (
          <button
            key={ddd}
            type="button"
            onClick={() => setLeadDdd(ddd)}
            className={`text-[11px] px-2.5 py-1 rounded-full border font-medium transition-colors ${
              ddd === leadDdd
                ? "bg-primary/15 border-primary/40 text-primary"
                : "bg-transparent border-border/50 text-muted-foreground hover:border-border"
            }`}
          >
            {ddd} · {n}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="destructive" className="text-xs gap-1.5" disabled={busy || nonLeadRows.length === 0} onClick={() => setConfirmPause(true)}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />}
          Pausar não-leads (≠ DDD {leadDdd})
        </Button>
        <Button size="sm" className="text-xs gap-1.5" disabled={busy || leadRows.length === 0} onClick={() => setConfirmRelease(true)}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Users className="w-3.5 h-3.5" />}
          Liberar leads DDD {leadDdd}
        </Button>
      </div>

      <AlertDialog open={confirmPause} onOpenChange={(o) => !busy && setConfirmPause(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pausar {nonLeadRows.length} não-leads?</AlertDialogTitle>
            <AlertDialogDescription>
              Contatos com DDD diferente de {leadDdd} ficam no banco, mas o motor não envia.
              DDD {leadDdd} ({leadRows.length}) permanece.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void pauseNonLeads(); }}>
              Pausar não-leads
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmRelease} onOpenChange={(o) => !busy && setConfirmRelease(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Liberar {leadRows.length} leads DDD {leadDdd}?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove a pausa e agenda próxima ação para agora.
              Ainda precisa do motor LIGADO (aba Motor) para enviar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void releaseLeadDdd(); }}>
              Liberar leads
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
        </div>
      ) : visible.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-8">Nenhum contato no motor com esse filtro.</p>
      ) : (
        <ScrollArea className="max-h-[360px]">
          <div className="space-y-1.5">
            {visible.map((r) => {
              const isLead = r.ddd === leadDdd;
              const paused = r.paused_until && new Date(r.paused_until).getTime() > Date.now();
              return (
                <div
                  key={r.id}
                  className={`rounded-xl border px-3 py-2 text-xs flex items-center gap-2 ${
                    isLead ? "border-primary/25 bg-primary/5" : "border-border/50 bg-muted/20"
                  }`}
                >
                  <Badge variant={isLead ? "default" : "secondary"} className="text-[9px] min-w-12 justify-center">
                    {r.ddd}
                  </Badge>
                  <Badge variant="outline" className="text-[9px]" title={r.stage}>
                    {labelCadenceStage(r.stage)}
                  </Badge>
                  {paused && <Badge variant="destructive" className="text-[9px]">pausado</Badge>}
                  <span className="flex-1 truncate">
                    <b>{r.name || "sem nome"}</b>
                    <span className="text-muted-foreground"> · {r.phone || "-"}</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {isLead ? "LEAD" : "não-lead"}
                  </span>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
