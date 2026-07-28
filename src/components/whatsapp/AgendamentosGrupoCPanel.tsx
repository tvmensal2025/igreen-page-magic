import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CADENCE_CALENDAR } from "@/lib/cadenceCalendarMap";
import { ExternalLink, Loader2, Megaphone, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const RECALL_TOGGLES = [
  { key: "facebook_retarget_sync", label: "Enviar para Meta (público)", hint: "Após dia 10 — hash telefone/e-mail" },
  { key: "cadence_retarget_ads_15d", label: "Anúncio Meta ~15 dias", hint: "Remarketing — criativo no Ads Manager" },
  { key: "cadence_recall_60d", label: "Retorno ~30 dias", hint: "WhatsApp → SMS → ligação" },
  { key: "cadence_recall_90d", label: "Retorno ~90 dias", hint: "" },
  { key: "cadence_recall_5m", label: "Retorno ~5 meses", hint: "" },
  { key: "cadence_recall_8m", label: "Retorno ~8 meses", hint: "" },
  { key: "cadence_recall_12m", label: "Retorno ~12 meses", hint: "" },
  { key: "cadence_recall_yearly", label: "Retorno anual (loop)", hint: "" },
] as const;

/** Grupo C — longo prazo, linguagem simples */
export function AgendamentosGrupoCPanel() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toggleMap, setToggleMap] = useState<Record<string, boolean>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const keys = RECALL_TOGGLES.map((t) => t.key);
    const { data } = await supabase.from("automation_toggles").select("key, enabled").in("key", keys);
    const tm: Record<string, boolean> = {};
    for (const t of data || []) tm[t.key] = !!t.enabled;
    setToggleMap(tm);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function setToggle(key: string, v: boolean) {
    setBusy(true);
    const { data, error } = await supabase
      .from("automation_toggles")
      .update({ enabled: v, updated_at: new Date().toISOString() })
      .eq("key", key)
      .select("key")
      .maybeSingle();
    setBusy(false);
    setPendingKey(null);
    if (error || !data) {
      toast.error(error?.message || "Sem permissão");
      return;
    }
    setToggleMap((m) => ({ ...m, [key]: v }));
    toast.success(v ? "Ligado" : "Desligado");
  }

  const grupoCDays = CADENCE_CALENDAR.filter((d) => d.group === "C");

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-3 text-[12px]">
        <p className="font-semibold text-foreground">Quando usar quem sumiu?</p>
        <p className="text-muted-foreground mt-1">
          Só depois que <strong className="text-foreground">quem esfriou</strong> (10 dias) estiver validado.
          Aqui entram Meta e retornos de meses depois. Deixe tudo <strong>desligado</strong> no começo.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline" className="text-xs rounded-xl gap-1">
          <Link to="/admin?tab=voz&sub=textos&cadenceGroup=C">
            Editar textos <ExternalLink className="w-3 h-3" />
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost" className="text-xs rounded-xl gap-1">
          <Link to="/admin/meta-ads">Meta Ads <ExternalLink className="w-3 h-3" /></Link>
        </Button>
        <Button size="sm" variant="ghost" className="text-xs rounded-xl gap-1 ml-auto" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-bold">Interruptores (um por marco)</p>
        {RECALL_TOGGLES.map(({ key, label, hint }) => (
          <div key={key} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-xs font-medium flex items-center gap-2">
                {key.includes("meta") || key.includes("retarget") ? (
                  <Megaphone className="w-3.5 h-3.5 text-violet-600 shrink-0" />
                ) : null}
                {label}
              </div>
              {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
            </div>
            <Switch
              checked={!!toggleMap[key]}
              disabled={busy}
              onCheckedChange={(v) => {
                if (v) setPendingKey(key);
                else void setToggle(key, false);
              }}
            />
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border/50 p-3 space-y-2">
        <p className="text-xs font-bold">Calendário (o que acontece em cada marco)</p>
        {grupoCDays.map((day) => (
          <div key={day.id} className="text-[11px] border-b border-border/40 pb-2 last:border-0">
            <p className="font-semibold">{day.label}</p>
            <p className="text-muted-foreground">{day.subtitle}</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {day.steps.map((s) => (
                <Badge key={s.stage} variant="outline" className="text-[9px]">
                  {s.channel === "whatsapp" ? "WA" : s.channel === "sms" ? "SMS" : s.channel === "voice" ? "Ligação" : "Meta"}
                  {" · "}{s.title.split("—")[0]?.trim() || s.stage}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>

      <AlertDialog open={!!pendingKey} onOpenChange={(o) => !busy && !o && setPendingKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ligar este retorno longo?</AlertDialogTitle>
            <AlertDialogDescription>
              Leads neste marco podem receber WhatsApp, SMS ou ligação automática.
              Confirme que quem esfriou já foi validado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (pendingKey) void setToggle(pendingKey, true);
              }}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Ligar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
