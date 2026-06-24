import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Sun } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { logAdminAction } from "@/hooks/useAdminAudit";

interface SolarConsultantRow {
  id: string;
  name: string;
  license: string;
  approved: boolean;
  solar_3d_enabled: boolean;
  solar_public_widget_enabled: boolean;
}

export function SolarModulePanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SolarConsultantRow[]>([]);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("consultants")
      .select("id, name, license, approved, solar_3d_enabled, solar_public_widget_enabled")
      .order("name");
    if (error) {
      toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
    } else {
      setRows((data ?? []) as SolarConsultantRow[]);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleFlag = async (
    id: string,
    field: "solar_3d_enabled" | "solar_public_widget_enabled",
    value: boolean,
  ) => {
    setBusyId(id);
    const { error } = await supabase
      .from("consultants")
      .update({ [field]: value } as Record<string, boolean>)
      .eq("id", id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
      logAdminAction("solar_module_toggle", "consultant", id, { field, value });
      toast({ title: value ? "Módulo habilitado" : "Módulo desabilitado" });
    }
    setBusyId(null);
  };

  const filtered = rows.filter(
    (r) =>
      !search.trim() ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.license.toLowerCase().includes(search.toLowerCase()),
  );

  const enabled3d = rows.filter((r) => r.solar_3d_enabled).length;
  const enabledWidget = rows.filter((r) => r.solar_public_widget_enabled).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Sun className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Módulo Solar 3D</h2>
        </div>
        <Badge variant="outline">{enabled3d} com análise admin</Badge>
        <Badge variant="outline">{enabledWidget} com widget público</Badge>
      </div>

      <p className="text-sm text-muted-foreground max-w-2xl">
        Habilita a ferramenta de análise de telhado (Conexão Placas) no painel do consultor e, opcionalmente,
        o widget de captação na página pública do licenciado.
      </p>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Buscar consultor..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid gap-2">
          {filtered.map((r) => (
            <Card key={r.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
              <div className="min-w-0">
                <p className="font-medium truncate">{r.name}</p>
                <p className="text-xs text-muted-foreground">{r.license}</p>
              </div>
              <div className="flex flex-wrap items-center gap-6 shrink-0">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={r.solar_3d_enabled}
                    disabled={busyId === r.id || !r.approved}
                    onCheckedChange={(v) => toggleFlag(r.id, "solar_3d_enabled", v)}
                  />
                  Análise admin
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={r.solar_public_widget_enabled}
                    disabled={busyId === r.id || !r.approved}
                    onCheckedChange={(v) => toggleFlag(r.id, "solar_public_widget_enabled", v)}
                  />
                  Widget captação
                </label>
                {!r.approved && (
                  <span className="text-[10px] text-warning">Aprove o consultor primeiro</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
