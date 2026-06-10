import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ShieldAlert, Loader2 } from "lucide-react";

interface SettingsRow {
  key: string;
  value: string;
}

export function AIControlPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [strict, setStrict] = useState(false);
  const [handoff, setHandoff] = useState(0.5);
  const [execute, setExecute] = useState(0.75);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("key,value")
        .in("key", ["strict_script_mode", "ai_confidence_threshold_handoff", "ai_confidence_threshold_execute"]);
      if (!error && data) {
        const map: Record<string, string> = {};
        (data as SettingsRow[]).forEach((r) => (map[r.key] = String(r.value ?? "")));
        setStrict((map.strict_script_mode || "false").toLowerCase() === "true");
        setHandoff(parseFloat(map.ai_confidence_threshold_handoff || "0.5"));
        setExecute(parseFloat(map.ai_confidence_threshold_execute || "0.75"));
      }
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    const rows = [
      { key: "strict_script_mode", value: strict ? "true" : "false" },
      { key: "ai_confidence_threshold_handoff", value: String(handoff) },
      { key: "ai_confidence_threshold_execute", value: String(execute) },
    ];
    const { error } = await supabase.from("settings").upsert(rows, { onConflict: "key" });
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Salvo", description: "Configurações de IA atualizadas (efetivo em até 60s)." });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
      </div>
    );
  }

  return (
    <div className="bg-card/40 backdrop-blur border border-border/50 rounded-xl p-5 space-y-5">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-primary" />
        <h3 className="text-base font-semibold">Controle de Segurança da IA</h3>
      </div>

      <div className="flex items-start justify-between gap-4 p-3 rounded-lg bg-secondary/30 border border-border/40">
        <div className="space-y-1">
          <Label className="text-sm font-medium">Modo Estrito (desligamento de emergência)</Label>
          <p className="text-xs text-muted-foreground max-w-md">
            Quando ativo, a IA fica restrita ao script: nenhuma geração livre, só passos definidos no fluxo.
            Use em caso de respostas erradas/alucinação em massa.
          </p>
        </div>
        <Switch checked={strict} onCheckedChange={setStrict} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label className="text-xs">Threshold de Handoff (&lt;)</Label>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={handoff}
            onChange={(e) => setHandoff(parseFloat(e.target.value) || 0)}
          />
          <p className="text-[11px] text-muted-foreground">
            Confiança abaixo disso → transfere para humano.
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Threshold de Execução (≥)</Label>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={execute}
            onChange={(e) => setExecute(parseFloat(e.target.value) || 0)}
          />
          <p className="text-[11px] text-muted-foreground">
            Acima disso → executa a ação. Entre os dois → repergunta.
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          Salvar configurações
        </Button>
      </div>
    </div>
  );
}
