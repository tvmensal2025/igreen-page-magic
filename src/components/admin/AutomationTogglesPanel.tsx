import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Power, PowerOff, ShieldAlert } from "lucide-react";

type Toggle = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  category: string;
  enabled: boolean;
  updated_at: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  cadencia: "Cadência",
  voz: "Voz / Ligação",
  sms: "SMS",
  meta: "Meta / Retargeting",
  manual: "Manual",
  ia: "IA",
  "pos-venda": "Pós-venda",
  parceiros: "Parceiros",
  geral: "Geral",
};

export default function AutomationTogglesPanel() {
  const [items, setItems] = useState<Toggle[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("automation_toggles")
      .select("*")
      .order("category", { ascending: true })
      .order("label", { ascending: true });
    if (error) toast.error("Falha ao carregar automações: " + error.message);
    setItems((data || []) as Toggle[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function toggle(t: Toggle, next: boolean) {
    setBusy(t.key);
    const { error } = await supabase
      .from("automation_toggles")
      .update({ enabled: next })
      .eq("id", t.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`${t.label}: ${next ? "LIGADO" : "DESLIGADO"}`);
    setItems(prev => prev.map(x => x.id === t.id ? { ...x, enabled: next } : x));
  }

  async function bulkSet(next: boolean) {
    if (!confirm(`Tem certeza que quer ${next ? "LIGAR" : "DESLIGAR"} TODAS as automações?`)) return;
    setBusy("__all__");
    const { error } = await supabase
      .from("automation_toggles")
      .update({ enabled: next })
      .neq("id", "00000000-0000-0000-0000-000000000000");
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`Todas as automações agora estão ${next ? "LIGADAS" : "DESLIGADAS"}`);
    load();
  }

  const grouped = items.reduce<Record<string, Toggle[]>>((acc, t) => {
    (acc[t.category] ||= []).push(t);
    return acc;
  }, {});

  const onCount = items.filter(i => i.enabled).length;
  const offCount = items.length - onCount;

  return (
    <div className="space-y-6">
      <Card className={onCount === 0 ? "border-amber-500/40 bg-amber-500/5" : ""}>
        <CardContent className="pt-6 flex items-center gap-4 flex-wrap">
          <ShieldAlert className={`h-8 w-8 ${onCount === 0 ? "text-amber-600" : "text-emerald-600"}`} />
          <div className="flex-1 min-w-[200px]">
            <div className="font-semibold">
              {onCount === 0
                ? "Nenhuma automação ligada — nada será enviado para clientes."
                : `${onCount} automação(ões) ativa(s), ${offCount} pausada(s).`}
            </div>
            <div className="text-xs text-muted-foreground">
              Cada função checa este painel antes de enviar. Enquanto estiver DESLIGADA, ela loga "skipped_toggle_off" e não dispara nada.
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => bulkSet(false)} disabled={busy === "__all__"}>
              <PowerOff className="h-3.5 w-3.5 mr-1" />Desligar todas
            </Button>
            <Button size="sm" onClick={() => bulkSet(true)} disabled={busy === "__all__"}>
              <Power className="h-3.5 w-3.5 mr-1" />Ligar todas
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading && <div className="text-sm text-muted-foreground">Carregando…</div>}

      {Object.entries(grouped).map(([cat, list]) => (
        <Card key={cat}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
              {CATEGORY_LABELS[cat] || cat}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {list.map(t => (
              <div key={t.id} className={`border rounded-lg p-3 flex items-start gap-3 ${t.enabled ? "border-emerald-500/30 bg-emerald-500/5" : "border-muted"}`}>
                <Switch
                  checked={t.enabled}
                  onCheckedChange={v => toggle(t, v)}
                  disabled={busy === t.key}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{t.label}</span>
                    {t.enabled
                      ? <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-[10px]">LIGADO</Badge>
                      : <Badge variant="outline" className="text-[10px]">DESLIGADO</Badge>}
                  </div>
                  {t.description && <p className="text-xs text-muted-foreground mt-1">{t.description}</p>}
                  <code className="text-[10px] text-muted-foreground/70">{t.key}</code>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
