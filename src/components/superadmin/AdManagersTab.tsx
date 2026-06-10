import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, X, UserCog, Search } from "lucide-react";

interface Consultant {
  id: string;
  name: string;
  license: string | null;
}

interface ManagerWithLinks {
  manager_user_id: string;
  manager: Consultant | null;
  managed: Consultant[];
}

export function AdManagersTab() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [groups, setGroups] = useState<ManagerWithLinks[]>([]);
  const [newManager, setNewManager] = useState("");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    const { data: consList } = await supabase
      .from("consultants")
      .select("id, name, license")
      .order("name");
    const list = (consList ?? []) as Consultant[];
    setConsultants(list);

    const { data: links } = await supabase
      .from("ad_account_managers")
      .select("manager_user_id, consultant_id");

    const byManager = new Map<string, string[]>();
    for (const l of links ?? []) {
      const arr = byManager.get((l as any).manager_user_id) ?? [];
      arr.push((l as any).consultant_id);
      byManager.set((l as any).manager_user_id, arr);
    }
    const cMap = new Map(list.map((c) => [c.id, c]));
    const result: ManagerWithLinks[] = [];
    for (const [mid, ids] of byManager.entries()) {
      result.push({
        manager_user_id: mid,
        manager: cMap.get(mid) ?? null,
        managed: ids.map((id) => cMap.get(id)).filter(Boolean) as Consultant[],
      });
    }
    setGroups(result);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const addManager = async () => {
    if (!newManager) return;
    // Nothing to insert until we add a consultant — just expose the manager row
    setGroups((g) =>
      g.some((x) => x.manager_user_id === newManager)
        ? g
        : [...g, { manager_user_id: newManager, manager: consultants.find((c) => c.id === newManager) ?? null, managed: [] }],
    );
    setNewManager("");
  };

  const addLink = async (managerId: string, consultantId: string) => {
    if (!consultantId || managerId === consultantId) return;
    const { error } = await supabase
      .from("ad_account_managers")
      .insert({ manager_user_id: managerId, consultant_id: consultantId });
    if (error) {
      toast({ title: "Erro ao vincular", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "✅ Consultor vinculado" });
    load();
  };

  const removeLink = async (managerId: string, consultantId: string) => {
    const { error } = await supabase
      .from("ad_account_managers")
      .delete()
      .eq("manager_user_id", managerId)
      .eq("consultant_id", consultantId);
    if (error) {
      toast({ title: "Erro ao remover", description: error.message, variant: "destructive" });
      return;
    }
    load();
  };

  const filteredConsultants = consultants.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.license ?? "").includes(search),
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando vínculos...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <UserCog className="w-5 h-5 text-primary mt-1" />
        <div>
          <h2 className="font-heading font-bold text-lg">Gestores de Conta de Anúncio</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Vincule um consultor "gestor" a outros consultores. O gestor verá o dashboard
            (gasto Ads, clientes interessados, CPL, visitas LP) tanto da própria conta quanto dos vinculados,
            podendo alternar pelo seletor no topo do /admin.
          </p>
        </div>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <select
            value={newManager}
            onChange={(e) => setNewManager(e.target.value)}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm flex-1"
          >
            <option value="">Selecione um consultor para virar gestor...</option>
            {consultants
              .filter((c) => !groups.some((g) => g.manager_user_id === c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.license ? `(${c.license})` : ""}
                </option>
              ))}
          </select>
          <Button onClick={addManager} disabled={!newManager} size="sm" className="gap-1.5">
            <Plus className="w-4 h-4" /> Adicionar gestor
          </Button>
        </div>
      </Card>

      <div className="space-y-4">
        {groups.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-8">
            Nenhum gestor configurado. Adicione um acima para começar.
          </div>
        )}
        {groups.map((g) => (
          <ManagerCard
            key={g.manager_user_id}
            group={g}
            consultants={filteredConsultants}
            onAdd={(cid) => addLink(g.manager_user_id, cid)}
            onRemove={(cid) => removeLink(g.manager_user_id, cid)}
            search={search}
            setSearch={setSearch}
          />
        ))}
      </div>
    </div>
  );
}

function ManagerCard({
  group, consultants, onAdd, onRemove, search, setSearch,
}: {
  group: ManagerWithLinks;
  consultants: Consultant[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  search: string;
  setSearch: (s: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const alreadyLinked = new Set(group.managed.map((m) => m.id));
  alreadyLinked.add(group.manager_user_id);
  const available = consultants.filter((c) => !alreadyLinked.has(c.id));

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-bold">{group.manager?.name ?? group.manager_user_id}</div>
          <div className="text-xs text-muted-foreground">
            Gerencia {group.managed.length} consultor{group.managed.length === 1 ? "" : "es"}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {group.managed.map((c) => (
          <Badge key={c.id} variant="secondary" className="gap-1.5 pl-2 pr-1 py-1">
            {c.name}
            <button
              onClick={() => onRemove(c.id)}
              className="rounded-full hover:bg-destructive/20 p-0.5"
              aria-label="Remover"
            >
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
        {group.managed.length === 0 && (
          <span className="text-xs text-muted-foreground italic">Nenhum vínculo ainda</span>
        )}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-border/40">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar consultor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-7 text-sm"
          />
        </div>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm flex-1"
        >
          <option value="">Selecionar consultor a vincular...</option>
          {available.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} {c.license ? `(${c.license})` : ""}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          onClick={() => {
            if (selected) { onAdd(selected); setSelected(""); }
          }}
          disabled={!selected}
          className="gap-1.5"
        >
          <Plus className="w-4 h-4" /> Vincular
        </Button>
      </div>
    </Card>
  );
}
