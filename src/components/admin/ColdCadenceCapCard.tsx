/**
 * Cap Outreach A/B/C — Zero Lead Perdido v6.
 * A = lead novo (ilimitado, não conta e não alerta).
 * B = reengajamento (COLD_*, CALL_1-3, SMS_1/2, SMS_TEMA_*) — cap_b default 150/dia.
 * C = reciclagem (RECALL_*) — cap_c default 50/dia.
 * Global outreach (B+C): cap_global_outreach default 200/dia (anti-ban WhatsApp).
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Snowflake } from "lucide-react";
import { toast } from "sonner";

const B_STAGES = [
  "COLD_1","COLD_2","COLD_3","COLD_4",
  "CALL_1","CALL_2","CALL_3",
  "SMS_1","SMS_2","SMS_TEMA_2","SMS_TEMA_7",
] as const;
const C_STAGES = [
  "RECALL_60D","RECALL_60D_SMS","RECALL_60D_CALL",
  "RECALL_90D","RECALL_90D_SMS","RECALL_90D_CALL",
  "RECALL_5M","RECALL_5M_SMS","RECALL_5M_CALL",
  "RECALL_8M","RECALL_8M_SMS","RECALL_8M_CALL",
  "RECALL_12M","RECALL_12M_SMS","RECALL_12M_CALL",
  "RECALL_YEARLY","RECALL_YEARLY_SMS","RECALL_YEARLY_CALL",
] as const;

function todayStartBRT(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const day = fmt.format(new Date());
  return new Date(`${day}T00:00:00-03:00`).toISOString();
}

const clampInt = (v: number, min: number, max: number, def: number) => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
};

function Bar({ label, used, cap, tone }: { label: string; used: number; cap: number; tone: "b" | "c" | "g" }) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const warn = pct >= 85 ? "bg-red-500" : pct >= 60 ? "bg-amber-500" : tone === "g" ? "bg-primary" : tone === "b" ? "bg-emerald-600" : "bg-sky-600";
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          <strong className="text-foreground">{used}</strong> / {cap} · {pct}%
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full transition-all ${warn}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ColdCadenceCapCard({ canEdit = true }: { canEdit?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [capB, setCapB] = useState(150);
  const [capC, setCapC] = useState(50);
  const [capG, setCapG] = useState(200);
  const [usedB, setUsedB] = useState(0);
  const [usedC, setUsedC] = useState(0);

  const reload = useCallback(async () => {
    setLoading(true);
    const [{ data: settings }, { data: logs }] = await Promise.all([
      supabase.from("daily_reheat_settings")
        .select("cap_b, cap_c, cap_global_outreach")
        .limit(1).maybeSingle(),
      supabase
        .from("cadence_action_log")
        .select("customer_id, stage")
        .eq("status", "sent")
        .gte("created_at", todayStartBRT())
        .in("stage", [...B_STAGES, ...C_STAGES]),
    ]);
    const s = settings as { cap_b?: number; cap_c?: number; cap_global_outreach?: number } | null;
    setCapB(clampInt(Number(s?.cap_b), 1, 5000, 150));
    setCapC(clampInt(Number(s?.cap_c), 1, 5000, 50));
    setCapG(clampInt(Number(s?.cap_global_outreach), 1, 5000, 200));
    const b = new Set<string>(); const c = new Set<string>();
    for (const r of ((logs || []) as { customer_id: string; stage: string }[])) {
      if (r.stage.startsWith("RECALL_")) c.add(r.customer_id);
      else b.add(r.customer_id);
    }
    setUsedB(b.size); setUsedC(c.size);
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  async function save() {
    if (!canEdit) return;
    setSaving(true);
    const patch = {
      cap_b: clampInt(capB, 1, 5000, 150),
      cap_c: clampInt(capC, 1, 5000, 50),
      cap_global_outreach: clampInt(capG, 1, 5000, 200),
    };
    const { data: row } = await supabase.from("daily_reheat_settings").select("id").limit(1).maybeSingle();
    const id = (row as { id?: string } | null)?.id;
    const { error } = id
      ? await supabase.from("daily_reheat_settings").update(patch).eq("id", id)
      : await supabase.from("daily_reheat_settings").insert(patch);
    setSaving(false);
    if (error) { toast.error("Não foi possível salvar", { description: error.message }); return; }
    toast.success(`Caps salvos — B:${patch.cap_b} · C:${patch.cap_c} · Global:${patch.cap_global_outreach}`);
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando cap outreach…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Snowflake className="h-4 w-4" />
          Outreach — teto diário por grupo
        </CardTitle>
        <Button type="button" variant="ghost" size="icon" onClick={() => void reload()} aria-label="Atualizar">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          <strong>Grupo A</strong> (lead novo / inbound) é <strong>ilimitado</strong> — não conta e não alerta.
          <br />Alertas automáticos disparam ao atingir 60% / 85% / 100% em B, C e Global.
        </p>

        <div className="space-y-3">
          <Bar label="Grupo B — Reengajamento" used={usedB} cap={capB} tone="b" />
          <Bar label="Grupo C — Reciclagem (RECALL_*)" used={usedC} cap={capC} tone="c" />
          <Bar label="Global outreach (B + C, anti-ban)" used={usedB + usedC} cap={capG} tone="g" />
        </div>

        {canEdit && (
          <div className="grid grid-cols-3 gap-2 pt-2">
            <div className="space-y-1">
              <Label htmlFor="cap-b">Cap B</Label>
              <Input id="cap-b" type="number" min={1} max={5000} value={capB}
                onChange={(e) => setCapB(Number(e.target.value) || 150)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cap-c">Cap C</Label>
              <Input id="cap-c" type="number" min={1} max={5000} value={capC}
                onChange={(e) => setCapC(Number(e.target.value) || 50)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cap-g">Cap Global (B+C)</Label>
              <Input id="cap-g" type="number" min={1} max={5000} value={capG}
                onChange={(e) => setCapG(Number(e.target.value) || 200)} />
            </div>
            <div className="col-span-3 flex justify-end">
              <Button type="button" onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar caps"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
