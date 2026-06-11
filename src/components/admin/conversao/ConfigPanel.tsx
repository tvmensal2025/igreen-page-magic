import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, Clock, Power, CalendarClock } from "lucide-react";
import { toast } from "sonner";

/**
 * Painel de CONFIGURAÇÃO do reaquecimento — é AQUI que o consultor define o
 * TEMPO (quanto esperar antes de reativar), os limites e a janela de horário,
 * e liga/desliga o reaquecimento automático.
 */

interface Settings {
  auto_enabled: boolean;
  horas_ate_primeiro_followup: number;
  max_envios: number;
  horas_entre_envios: number;
  janela_inicio: number;
  janela_fim: number;
  enviar_fim_de_semana: boolean;
}

const DEFAULTS: Settings = {
  auto_enabled: false,
  horas_ate_primeiro_followup: 24,
  max_envios: 3,
  horas_entre_envios: 48,
  janela_inicio: 9,
  janela_fim: 20,
  enviar_fim_de_semana: false,
};

interface Props {
  consultantId: string;
}

export function ConfigPanel({ consultantId }: Props) {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [consultantId]);

  async function load() {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("reactivation_settings")
      .select("*")
      .eq("consultant_id", consultantId)
      .maybeSingle();
    if (data) {
      setS({
        auto_enabled: data.auto_enabled,
        horas_ate_primeiro_followup: data.horas_ate_primeiro_followup,
        max_envios: data.max_envios,
        horas_entre_envios: data.horas_entre_envios,
        janela_inicio: data.janela_inicio,
        janela_fim: data.janela_fim,
        enviar_fim_de_semana: data.enviar_fim_de_semana,
      });
    }
    setLoading(false);
  }

  async function save() {
    setSaving(true);
    const { error } = await (supabase as any)
      .from("reactivation_settings")
      .upsert({ consultant_id: consultantId, ...s, updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) toast.error("Erro ao salvar: " + error.message);
    else toast.success("Configuração salva");
  }

  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    setS((prev) => ({ ...prev, [k]: v }));
  }

  if (loading) {
    return <div className="grid place-items-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="max-w-2xl space-y-4">
      {/* Liga/desliga */}
      <Card className="flex items-center gap-4 p-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 border border-primary/30">
          <Power className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">Reaquecimento automático</h3>
          <p className="text-xs text-muted-foreground">
            Quando ligado, o sistema envia as frases ativas sozinho para os leads parados, respeitando as regras abaixo.
          </p>
        </div>
        <Switch checked={s.auto_enabled} onCheckedChange={(v) => set("auto_enabled", v)} />
      </Card>

      {/* Tempo */}
      <Card className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Tempo e limites</h3>
        </div>

        <Field
          label="Esperar quantas horas paradas antes de reativar"
          hint="Tempo sem resposta do cliente até o primeiro toque."
        >
          <Input type="number" min={1} max={720} value={s.horas_ate_primeiro_followup}
            onChange={(e) => set("horas_ate_primeiro_followup", Number(e.target.value))} className="w-28" />
          <span className="text-xs text-muted-foreground">horas</span>
        </Field>

        <Field label="Máximo de mensagens automáticas por lead" hint="Depois disso, o sistema para de insistir.">
          <Input type="number" min={1} max={10} value={s.max_envios}
            onChange={(e) => set("max_envios", Number(e.target.value))} className="w-28" />
          <span className="text-xs text-muted-foreground">mensagens</span>
        </Field>

        <Field label="Intervalo entre uma mensagem e outra" hint="Evita mandar várias seguidas pro mesmo lead.">
          <Input type="number" min={1} max={336} value={s.horas_entre_envios}
            onChange={(e) => set("horas_entre_envios", Number(e.target.value))} className="w-28" />
          <span className="text-xs text-muted-foreground">horas</span>
        </Field>
      </Card>

      {/* Janela de horário */}
      <Card className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Janela de envio</h3>
        </div>
        <Field label="Enviar somente entre" hint="Horário comercial evita incomodar de madrugada.">
          <Input type="number" min={0} max={23} value={s.janela_inicio}
            onChange={(e) => set("janela_inicio", Number(e.target.value))} className="w-20" />
          <span className="text-xs text-muted-foreground">e</span>
          <Input type="number" min={0} max={23} value={s.janela_fim}
            onChange={(e) => set("janela_fim", Number(e.target.value))} className="w-20" />
          <span className="text-xs text-muted-foreground">horas</span>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={s.enviar_fim_de_semana} onCheckedChange={(v) => set("enviar_fim_de_semana", v)} />
          Enviar também aos sábados e domingos
        </label>
      </Card>

      <Button onClick={save} disabled={saving}>
        {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
        Salvar configuração
      </Button>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">{children}</div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
