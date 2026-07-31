import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import { ExternalLink, Loader2, Play, RefreshCw, Zap, ZapOff } from "lucide-react";
import { toast } from "sonner";

const GRUPO_B_TOGGLES = [
  ["cadence_cold_1", "COLD_1"],
  ["cadence_sms_1", "SMS_1"],
  ["cadence_call_1", "CALL_1"],
  ["cadence_cold_2", "COLD_2"],
  ["cadence_sms_tema_2", "SMS_TEMA_2"],
  ["cadence_sms_2", "SMS_2"],
  ["cadence_call_2", "CALL_2"],
  ["cadence_cold_3", "COLD_3"],
  ["cadence_sms_tema_7", "SMS_TEMA_7"],
  ["cadence_cold_4", "COLD_4"],
  ["cadence_call_3", "CALL_3"],
] as const;

const RECALL_TOGGLES = [
  "cadence_recall_60d",
  "cadence_recall_90d",
  "cadence_recall_5m",
  "cadence_recall_8m",
  "cadence_recall_12m",
  "cadence_recall_yearly",
] as const;

/**
 * Aba Motor — liga/desliga motor + estágios Grupo B.
 * Recalls (Grupo C) têm toggle próprio; status real aparece nos badges abaixo.
 */
export function AgendamentosMotorPanel() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [engineOn, setEngineOn] = useState(false);
  const [toggleMap, setToggleMap] = useState<Record<string, boolean>>({});
  const [slaCount, setSlaCount] = useState(0);
  const [dueCount, setDueCount] = useState(0);
  const [confirmEngine, setConfirmEngine] = useState(false);
  const [confirmGrupoB, setConfirmGrupoB] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const keys = [
      "cadence_engine",
      ...GRUPO_B_TOGGLES.map(([k]) => k),
      ...RECALL_TOGGLES,
      "cadence_retarget_ads_15d",
      "facebook_retarget_sync",
    ];
    const [{ data: settings }, { data: toggles }, dueRes] = await Promise.all([
      supabase.from("app_settings").select("cadence_engine_enabled").eq("id", "global").maybeSingle(),
      supabase.from("automation_toggles").select("key, enabled").in("key", keys),
      supabase
        .from("lead_cadence_state")
        .select("id, next_action_at")
        .lte("next_action_at", new Date(Date.now() + 3600_000).toISOString())
        .not("stage", "in", "(WON,PAUSED,RETARGET_META)")
        .limit(200),
    ]);
    setEngineOn(!!settings?.cadence_engine_enabled);
    const tm: Record<string, boolean> = {};
    for (const t of toggles || []) tm[t.key] = !!t.enabled;
    setToggleMap(tm);
    const due = dueRes.data || [];
    setDueCount(due.length);
    const now = Date.now();
    setSlaCount(due.filter((l) => l.next_action_at && new Date(l.next_action_at).getTime() < now - 30 * 60_000).length);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setToggle(key: string, v: boolean) {
    const { data, error } = await supabase
      .from("automation_toggles")
      .update({ enabled: v, updated_at: new Date().toISOString() })
      .eq("key", key)
      .select("key")
      .maybeSingle();
    if (error || !data) {
      toast.error(error?.message || `Sem permissão para ${key}`);
      return false;
    }
    setToggleMap((m) => ({ ...m, [key]: v }));
    return true;
  }

  async function applyEngine(v: boolean) {
    setBusy(true);
    const now = new Date().toISOString();
    const { data: sRow, error: e1 } = await supabase
      .from("app_settings")
      .update({ cadence_engine_enabled: v })
      .eq("id", "global")
      .select("id")
      .maybeSingle();
    const { data: tRow, error: e2 } = await supabase
      .from("automation_toggles")
      .update({ enabled: v, updated_at: now })
      .eq("key", "cadence_engine")
      .select("key")
      .maybeSingle();
    setBusy(false);
    setConfirmEngine(false);
    if (e1 || e2 || !sRow || !tRow) {
      toast.error(e1?.message || e2?.message || "Falha ao alternar motor");
      return;
    }
    setEngineOn(v);
    toast.success(v ? "Motor LIGADO" : "Motor DESLIGADO");
  }

  async function enableGrupoB() {
    setBusy(true);
    let ok = await setToggle("cadence_engine", true);
    if (!ok) {
      setBusy(false);
      setConfirmGrupoB(false);
      return;
    }
    const { data: sRow, error: e1 } = await supabase
      .from("app_settings")
      .update({ cadence_engine_enabled: true })
      .eq("id", "global")
      .select("id")
      .maybeSingle();
    if (e1 || !sRow) {
      toast.error(e1?.message || "Sem permissão para ligar o motor (precisa super_admin).");
      setBusy(false);
      setConfirmGrupoB(false);
      return;
    }
    for (const [key] of GRUPO_B_TOGGLES) {
      ok = await setToggle(key, true);
      if (!ok) break;
    }
    setEngineOn(true);
    setBusy(false);
    setConfirmGrupoB(false);
    toast.success("Quem esfriou + envios automáticos ligados. Retornos longos continuam desligados.");
    await load();
  }

  async function runTick() {
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("cadence-tick-manual");
      if (error) throw error;
      toast.success("Tick executado");
      await load();
    } catch (e: any) {
      toast.error("Falha no tick: " + (e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  const grupoBOn = GRUPO_B_TOGGLES.every(([k]) => toggleMap[k]);
  const recallsOn = RECALL_TOGGLES.some((k) => toggleMap[k]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/60 p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {engineOn ? <Zap className="w-4 h-4 text-green-500 shrink-0" /> : <ZapOff className="w-4 h-4 text-muted-foreground shrink-0" />}
          <div>
            <p className="text-sm font-semibold">Motor Zero Lead Perdido</p>
            <p className="text-[11px] text-muted-foreground">
              {engineOn ? "Ligado" : "Desligado"} · Quem esfriou {grupoBOn ? "ligado" : "parcial/off"} · Retornos {recallsOn ? "ligados" : "off"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs">{engineOn ? "Ligado" : "Desligado"}</Label>
          <Switch
            checked={engineOn}
            disabled={busy || loading}
            onCheckedChange={(v) => {
              if (v) setConfirmEngine(true);
              else void applyEngine(false);
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-[11px]">
        <Badge variant={slaCount > 0 ? "destructive" : "secondary"}>{slaCount} SLA</Badge>
        <Badge variant="outline">{dueCount} due ~1h</Badge>
        <Badge variant={toggleMap.cadence_retarget_ads_15d ? "default" : "secondary"}>
          Meta ads: {toggleMap.cadence_retarget_ads_15d ? "ON" : "OFF"}
        </Badge>
      </div>

      <div className="rounded-xl border border-border/50 p-3 space-y-2">
        <p className="text-xs font-semibold">Etapas de quem esfriou (onda curta)</p>
        <div className="grid sm:grid-cols-2 gap-1.5">
          {GRUPO_B_TOGGLES.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5">
              <span className="text-[11px] font-mono truncate">{label}</span>
              <Switch
                checked={!!toggleMap[key]}
                disabled={busy}
                onCheckedChange={(v) => void setToggle(key, v).then((ok) => ok && toast.success(`${label} ${v ? "ON" : "OFF"}`))}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-violet-500/20 p-3 space-y-2">
        <p className="text-xs font-semibold">Quem sumiu — retornos (status real nos badges)</p>
        <div className="flex flex-wrap gap-1.5">
          {RECALL_TOGGLES.map((key) => (
            <Badge key={key} variant={toggleMap[key] ? "default" : "secondary"} className="text-[10px] font-mono">
              {key.replace("cadence_", "")}: {toggleMap[key] ? "ON" : "OFF"}
            </Badge>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">Status dos recalls; ajuste fino na página completa do Motor.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="text-xs gap-1.5" disabled={busy} onClick={() => setConfirmGrupoB(true)}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          Ligar envios + quem esfriou
        </Button>
        <Button size="sm" variant="outline" className="text-xs gap-1.5" disabled={busy || !engineOn} onClick={() => void runTick()}>
          <Play className="w-3.5 h-3.5" /> Executar tick
        </Button>
        <Button size="sm" variant="ghost" className="text-xs gap-1.5" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
        <Button asChild size="sm" variant="outline" className="text-xs gap-1.5 ml-auto">
          <Link to="/admin/motor">
            Painel completo <ExternalLink className="w-3 h-3" />
          </Link>
        </Button>
      </div>

      <AlertDialog open={confirmEngine} onOpenChange={(o) => !busy && setConfirmEngine(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ligar o motor?</AlertDialogTitle>
            <AlertDialogDescription>
              Pode disparar WhatsApp/SMS/ligação nos estágios que estiverem ON.
              Separe leads na aba <strong>Lead</strong> antes (DDD 34).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void applyEngine(true); }}>
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmGrupoB} onOpenChange={(o) => !busy && setConfirmGrupoB(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ligar envios + todas as etapas de quem esfriou?</AlertDialogTitle>
            <AlertDialogDescription>
              Liga cold/sms/call da onda curta. Recalls e Meta permanecem OFF.
              Confirme que na aba Lead só os DDD corretos estão liberados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void enableGrupoB(); }}>
              Ligar quem esfriou
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
