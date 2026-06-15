import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Save, GitBranch } from "lucide-react";

type Mode = "D_ONLY" | "B_ONLY" | "BOTH";

const MODE_TO_ARRAY: Record<Mode, string[]> = {
  D_ONLY: ["D"],
  B_ONLY: ["B"],
  BOTH: ["B", "D"],
};

function arrayToMode(arr: string[] | null | undefined): Mode {
  const a = (arr || []).map((x) => String(x).toUpperCase()).sort();
  if (a.length === 1 && a[0] === "B") return "B_ONLY";
  if (a.length === 1 && a[0] === "D") return "D_ONLY";
  return "BOTH";
}

interface Props {
  consultantId: string;
}

export default function ConsultantVariantsCard({ consultantId }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<Mode>("BOTH");
  const [original, setOriginal] = useState<Mode>("BOTH");
  const [counts, setCounts] = useState<{ B: number; D: number }>({ B: 0, D: 0 });

  useEffect(() => {
    if (!consultantId) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("consultants")
        .select("active_variants")
        .eq("id", consultantId)
        .maybeSingle();
      const m = arrayToMode((data as any)?.active_variants);
      setMode(m);
      setOriginal(m);

      // counts últimos 7 dias
      const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
      const [{ count: bCount }, { count: dCount }] = await Promise.all([
        supabase.from("customers").select("id", { count: "exact", head: true })
          .eq("consultant_id", consultantId).eq("flow_variant", "B").gte("created_at", since),
        supabase.from("customers").select("id", { count: "exact", head: true })
          .eq("consultant_id", consultantId).eq("flow_variant", "D").gte("created_at", since),
      ]);
      setCounts({ B: bCount ?? 0, D: dCount ?? 0 });
      setLoading(false);
    })();
  }, [consultantId]);

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("consultants")
      .update({ active_variants: MODE_TO_ARRAY[mode] })
      .eq("id", consultantId);
    setSaving(false);
    if (error) {
      toast({ title: "Erro salvando", description: error.message, variant: "destructive" });
      return;
    }
    setOriginal(mode);
    toast({ title: "Distribuição atualizada", description: "Novos leads usarão a nova configuração." });
  }

  if (loading) return <Card><CardContent className="flex justify-center p-8"><Loader2 className="animate-spin" /></CardContent></Card>;

  const dirty = mode !== original;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><GitBranch className="w-5 h-5 text-primary" />Distribuição de Fluxo</CardTitle>
        <CardDescription>
          Define quais variantes este consultor recebe. Últimos 7 dias:
          <Badge variant="outline" className="ml-2">Fluxo B (IA): {counts.B}</Badge>
          <Badge variant="outline" className="ml-1">Fluxo D (botões): {counts.D}</Badge>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} className="space-y-2">
          <div className="flex items-start gap-3 p-3 border rounded-md hover:bg-muted/30 cursor-pointer" onClick={() => setMode("D_ONLY")}>
            <RadioGroupItem value="D_ONLY" id="m-d" className="mt-1" />
            <Label htmlFor="m-d" className="cursor-pointer flex-1">
              <div className="font-medium">Apenas Fluxo D (botões guiados)</div>
              <div className="text-xs text-muted-foreground">Roteiro fixo com botões. Mais previsível, sem IA livre.</div>
            </Label>
          </div>
          <div className="flex items-start gap-3 p-3 border rounded-md hover:bg-muted/30 cursor-pointer" onClick={() => setMode("B_ONLY")}>
            <RadioGroupItem value="B_ONLY" id="m-b" className="mt-1" />
            <Label htmlFor="m-b" className="cursor-pointer flex-1">
              <div className="font-medium">Apenas Fluxo B (IA livre)</div>
              <div className="text-xs text-muted-foreground">Camila IA conduz toda a conversa até pedir a foto da conta.</div>
            </Label>
          </div>
          <div className="flex items-start gap-3 p-3 border rounded-md hover:bg-muted/30 cursor-pointer" onClick={() => setMode("BOTH")}>
            <RadioGroupItem value="BOTH" id="m-both" className="mt-1" />
            <Label htmlFor="m-both" className="cursor-pointer flex-1">
              <div className="font-medium">Ambos (A/B 50/50)</div>
              <div className="text-xs text-muted-foreground">Roteador sorteia entre B e D para cada novo lead. Recomendado para comparar.</div>
            </Label>
          </div>
        </RadioGroup>
        <div className="flex justify-end">
          <Button onClick={save} disabled={!dirty || saving} size="sm">
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
