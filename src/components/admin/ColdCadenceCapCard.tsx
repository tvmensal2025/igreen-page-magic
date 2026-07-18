/**
 * Contador frios tocados hoje (BRT) vs cap 60 — Zero Lead Perdido v5.
 * Cap vem de daily_reheat_settings.daily_whapi_cap (mesmo número da pizza).
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Snowflake } from "lucide-react";
import { toast } from "sonner";

const COLD_STAGES = [
  "COLD_1", "COLD_2", "COLD_3", "COLD_4",
  "CALL_1", "CALL_2", "CALL_3",
  "SMS_1", "SMS_2", "SMS_TEMA_2", "SMS_TEMA_7",
  "RECALL_60D", "RECALL_60D_SMS", "RECALL_60D_CALL",
  "RECALL_90D", "RECALL_90D_SMS", "RECALL_90D_CALL",
  "RECALL_5M", "RECALL_5M_SMS", "RECALL_5M_CALL",
  "RECALL_8M", "RECALL_8M_SMS", "RECALL_8M_CALL",
  "RECALL_12M", "RECALL_12M_SMS", "RECALL_12M_CALL",
  "RECALL_YEARLY", "RECALL_YEARLY_SMS", "RECALL_YEARLY_CALL",
] as const;

function todayStartBRT(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const day = fmt.format(new Date());
  return new Date(`${day}T00:00:00-03:00`).toISOString();
}

export function ColdCadenceCapCard({ canEdit = true }: { canEdit?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cap, setCap] = useState(60);
  const [touched, setTouched] = useState(0);

  const reload = useCallback(async () => {
    setLoading(true);
    const [{ data: settings }, { data: logs }] = await Promise.all([
      supabase.from("daily_reheat_settings").select("daily_whapi_cap").limit(1).maybeSingle(),
      supabase
        .from("cadence_action_log")
        .select("customer_id")
        .eq("status", "sent")
        .gte("created_at", todayStartBRT())
        .in("stage", COLD_STAGES),
    ]);
    const n = Number((settings as { daily_whapi_cap?: number } | null)?.daily_whapi_cap);
    if (Number.isFinite(n) && n >= 1) setCap(Math.min(200, Math.max(10, Math.floor(n))));
    const ids = new Set((logs || []).map((r: { customer_id: string }) => r.customer_id));
    setTouched(ids.size);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function saveCap() {
    if (!canEdit) return;
    setSaving(true);
    const value = Math.min(200, Math.max(10, Math.floor(cap) || 60));
    const { data: row } = await supabase
      .from("daily_reheat_settings")
      .select("id")
      .limit(1)
      .maybeSingle();
    const id = (row as { id?: string } | null)?.id;
    const { error } = id
      ? await supabase.from("daily_reheat_settings").update({ daily_whapi_cap: value }).eq("id", id)
      : await supabase.from("daily_reheat_settings").insert({ daily_whapi_cap: value });
    setSaving(false);
    if (error) {
      toast.error("Não foi possível salvar o cap", { description: error.message });
      return;
    }
    setCap(value);
    toast.success(`Cap frio: ${value} pessoas/dia`);
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando cap frio…
        </CardContent>
      </Card>
    );
  }

  const pct = cap > 0 ? Math.min(100, Math.round((touched / cap) * 100)) : 0;

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Snowflake className="h-4 w-4" />
          Lead frio — teto diário
        </CardTitle>
        <Button type="button" variant="ghost" size="icon" onClick={() => void reload()} aria-label="Atualizar">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Lead <strong>novo</strong> (Grupo A / inbound) é ilimitado. Só o outreach frio
          (COLD / SMS / ligação / recall) conta aqui.
        </p>
        <div className="flex items-end gap-3">
          <div className="text-3xl font-semibold tabular-nums">
            {touched}
            <span className="text-lg text-muted-foreground font-normal"> / {cap}</span>
          </div>
          <span className="text-muted-foreground pb-1">{pct}% do dia (BRT)</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        {canEdit && (
          <div className="flex items-end gap-2 pt-1">
            <div className="space-y-1 flex-1 max-w-[140px]">
              <Label htmlFor="cold-cap">Cap (pessoas/dia)</Label>
              <Input
                id="cold-cap"
                type="number"
                min={10}
                max={200}
                value={cap}
                onChange={(e) => setCap(Number(e.target.value) || 60)}
              />
            </div>
            <Button type="button" onClick={() => void saveCap()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
