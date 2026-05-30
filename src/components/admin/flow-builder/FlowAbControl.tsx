import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Shuffle, FileAudio, MousePointerClick } from "lucide-react";
import { toast } from "sonner";

type AbMode = "split" | "only_A" | "only_D";

// Painel de controle do teste A/B (Fluxo A áudio/texto × Fluxo D botões).
// Grava em settings.flow_ab_mode. O webhook lê esse flag ao criar cada lead novo.
//   split  → 50/50 aleatório por lead
//   only_A → todo lead novo entra no Fluxo A
//   only_D → todo lead novo entra no Fluxo D
export default function FlowAbControl() {
  const [mode, setMode] = useState<AbMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<AbMode | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "flow_ab_mode")
        .maybeSingle();
      const v = String(data?.value || "split").toLowerCase();
      setMode(v === "only_a" ? "only_A" : v === "only_d" ? "only_D" : "split");
      setLoading(false);
    })();
  }, []);

  const save = async (next: AbMode) => {
    setSaving(next);
    const { error } = await supabase
      .from("settings")
      .upsert({ key: "flow_ab_mode", value: next }, { onConflict: "key" });
    setSaving(null);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      return;
    }
    setMode(next);
    toast.success(
      next === "split"
        ? "Teste A/B ligado — leads novos caem 50/50 entre os dois fluxos"
        : next === "only_A"
          ? "Só o Fluxo A (áudio/texto) — todo lead novo vai pra ele"
          : "Só o Fluxo D (botões) — todo lead novo vai pra ele",
    );
  };

  const opt = (
    value: AbMode,
    icon: React.ReactNode,
    title: string,
    desc: string,
  ) => {
    const active = mode === value;
    return (
      <button
        type="button"
        onClick={() => !active && save(value)}
        disabled={saving !== null}
        className={`flex-1 text-left rounded-lg border p-3 transition ${
          active
            ? "border-primary bg-primary/10 ring-1 ring-primary"
            : "border-border hover:border-primary/40 hover:bg-muted/40"
        }`}
      >
        <div className="flex items-center gap-2">
          <div className={`h-8 w-8 rounded-full flex items-center justify-center ${active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
            {saving === value ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
          </div>
          <span className="font-semibold text-sm">{title}</span>
          {active && <Badge variant="secondary" className="ml-auto">Ativo</Badge>}
        </div>
        <p className="text-xs text-muted-foreground mt-2">{desc}</p>
      </button>
    );
  };

  return (
    <Card className="p-4 border-primary/20 bg-card/40">
      <div className="flex items-start gap-2 mb-3">
        <Shuffle className="h-5 w-5 text-primary mt-0.5" />
        <div className="flex-1">
          <h2 className="text-base font-semibold">Teste A/B — qual fluxo o lead recebe</h2>
          <p className="text-xs text-muted-foreground">
            Vale para cada <strong>lead novo</strong>. Quem já está conversando mantém o fluxo onde entrou.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2">
          {opt("split", <Shuffle className="h-4 w-4" />, "Testar os dois (50/50)", "Metade dos leads novos vai pro Fluxo A, metade pro Fluxo D. Use pra descobrir qual converte mais.")}
          {opt("only_A", <FileAudio className="h-4 w-4" />, "Só Fluxo A", "Áudio + texto, conversa guiada (persona Rafael). Todo lead novo entra aqui.")}
          {opt("only_D", <MousePointerClick className="h-4 w-4" />, "Só Fluxo D", "Botões interativos do WhatsApp. Todo lead novo entra aqui.")}
        </div>
      )}
    </Card>
  );
}
