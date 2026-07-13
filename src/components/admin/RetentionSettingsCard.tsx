import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

type RetentionSettings = {
  speed_to_lead_minutes: number;
  orchestrator_cooldown_hours: number;
  portal_abandon_hours: number;
  call_answered_pause_hours: number;
};

const DEFAULTS: RetentionSettings = {
  speed_to_lead_minutes: 5,
  orchestrator_cooldown_hours: 6,
  portal_abandon_hours: 2,
  call_answered_pause_hours: 24,
};

/**
 * Configura números da retenção ANTES de ligar os toggles.
 * Não envia nada — só persiste parâmetros.
 */
export function RetentionSettingsCard({ canEdit = true }: { canEdit?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<RetentionSettings>(DEFAULTS);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("retention_settings" as never)
        .select("*")
        .eq("id", "global")
        .maybeSingle();
      if (error) {
        console.warn("[RetentionSettings]", error.message);
      } else if (data) {
        const row = data as Record<string, unknown>;
        setForm({
          speed_to_lead_minutes: Number(row.speed_to_lead_minutes) || DEFAULTS.speed_to_lead_minutes,
          orchestrator_cooldown_hours: Number(row.orchestrator_cooldown_hours) || DEFAULTS.orchestrator_cooldown_hours,
          portal_abandon_hours: Number(row.portal_abandon_hours) || DEFAULTS.portal_abandon_hours,
          call_answered_pause_hours: Number(row.call_answered_pause_hours) || DEFAULTS.call_answered_pause_hours,
        });
      }
      setLoading(false);
    })();
  }, []);

  async function save() {
    if (!canEdit) return;
    setSaving(true);
    const { error } = await supabase
      .from("retention_settings" as never)
      .upsert({
        id: "global",
        ...form,
        updated_at: new Date().toISOString(),
      } as never);
    setSaving(false);
    if (error) {
      toast.error("Não foi possível salvar", { description: error.message });
      return;
    }
    toast.success("Configuração salva — ainda precisa ligar os toggles na Central");
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando parâmetros…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/80">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Parâmetros de retenção (configure antes de ligar)</CardTitle>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Estes números só valem quando o toggle correspondente estiver ligado.
          Enquanto estiver desligado, nada dispara sozinho.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sla_min">SLA speed-to-lead (minutos)</Label>
            <Input
              id="sla_min"
              type="number"
              min={1}
              max={120}
              disabled={!canEdit}
              value={form.speed_to_lead_minutes}
              onChange={(e) =>
                setForm((f) => ({ ...f, speed_to_lead_minutes: Number(e.target.value) || 5 }))
              }
            />
            <p className="text-[11px] text-muted-foreground">
              Alerta no painel se lead novo ficar sem 1ª resposta. Toggle: speed_to_lead_sla.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cooldown">Cooldown do orquestrador (horas)</Label>
            <Input
              id="cooldown"
              type="number"
              min={0.5}
              max={168}
              step={0.5}
              disabled={!canEdit}
              value={form.orchestrator_cooldown_hours}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  orchestrator_cooldown_hours: Number(e.target.value) || 6,
                }))
              }
            />
            <p className="text-[11px] text-muted-foreground">
              Evita vários crons no mesmo lead. Toggle: retention_orchestrator.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pause_call">Pausa cadência após ligação atendida (h)</Label>
            <Input
              id="pause_call"
              type="number"
              min={1}
              max={168}
              disabled={!canEdit}
              value={form.call_answered_pause_hours}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  call_answered_pause_hours: Number(e.target.value) || 24,
                }))
              }
            />
            <p className="text-[11px] text-muted-foreground">
              Também usado quando o lead responde no WhatsApp. Toggle: call_answered_pause_cadence.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="portal_h">Abandono de portal (horas) — reservado</Label>
            <Input
              id="portal_h"
              type="number"
              min={0.5}
              max={72}
              step={0.5}
              disabled={!canEdit}
              value={form.portal_abandon_hours}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  portal_abandon_hours: Number(e.target.value) || 2,
                }))
              }
            />
            <p className="text-[11px] text-muted-foreground">
              Para sequência futura. Toggle portal_abandon_sequence ainda não envia.
            </p>
          </div>
        </div>
        {canEdit && (
          <Button type="button" size="sm" className="rounded-xl" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Salvar parâmetros
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
