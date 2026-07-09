import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Search, Loader2, RefreshCw, PlayCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

type Row = {
  key: string;
  source: "captured" | "customer";
  id: string;
  consultant_id: string | null;
  name: string | null;
  phone_raw: string | null;
  phone_norm: string | null;
  ddd: string | null;
  city: string | null;
  uf: string | null;
  source_campaign_id: string | null;
  status: string | null;
  created_at: string;
  days_stuck: number;
};

const DDD_PRESETS: Record<string, string[]> = {
  minas: ["31", "32", "33", "34", "35", "37", "38"],
  sp_capital: ["11"],
  sp_interior: ["12", "13", "14", "15", "16", "17", "18", "19"],
};

export default function AdminRecoverLeadsPage() {
  const queryClient = useQueryClient();
  const [days, setDays] = useState<string>("120");
  const [source, setSource] = useState<"all" | "captured" | "customer">("all");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [dddInput, setDddInput] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const ddds = useMemo(
    () =>
      dddInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    [dddInput],
  );

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["recover-leads", days, source, scope, ddds.join(","), search],
    queryFn: async () => {
      const params = new URLSearchParams({ days, source, scope });
      if (ddds.length) params.set("ddds", ddds.join(","));
      if (search) params.set("q", search);
      const { data, error } = await supabase.functions.invoke(
        `admin-recover-parked-leads?${params.toString()}`,
        { method: "GET" },
      );
      if (error) throw error;
      return data as { rows: Row[]; total: number; dddCounts: Record<string, number> };
    },
  });

  const rows = data?.rows ?? [];
  const dddCounts = data?.dddCounts ?? {};

  const promote = useMutation({
    mutationFn: async (keys: string[]) => {
      const { data, error } = await supabase.functions.invoke("admin-recover-parked-leads", {
        method: "POST",
        body: { action: "promote", lead_keys: keys },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (res: any) => {
      toast.success("Leads em conversão", {
        description: `${res.promoted} promovidos, ${res.linked} vinculados, ${res.reactivated} reativados.`,
      });
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["recover-leads"] });
    },
    onError: (e: any) => toast.error("Falha ao colocar em conversão", { description: e.message }),
  });

  const markLost = useMutation({
    mutationFn: async (keys: string[]) => {
      const { data, error } = await supabase.functions.invoke("admin-recover-parked-leads", {
        method: "POST",
        body: { action: "mark_lost", lead_keys: keys },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (res: any) => {
      toast.success("Leads marcados como perdidos", { description: `${res.updated} atualizados.` });
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["recover-leads"] });
    },
    onError: (e: any) => toast.error("Falha ao marcar como perdido", { description: e.message }),
  });

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.key)));
  };
  const toggleOne = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Button asChild variant="ghost" size="sm" className="mb-2">
              <Link to="/admin">
                <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
              </Link>
            </Button>
            <h1 className="text-2xl md:text-3xl font-bold">Recuperação de Leads</h1>
            <p className="text-sm text-muted-foreground">
              Leads parados dos últimos {days} dias (exclui base sincronizada do iGreen).
            </p>
          </div>
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Atualizar
          </Button>
        </div>

        {/* Filtros */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Filtros</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-6">
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger><SelectValue placeholder="Período" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
                <SelectItem value="60">Últimos 60 dias</SelectItem>
                <SelectItem value="90">Últimos 90 dias</SelectItem>
                <SelectItem value="120">Últimos 120 dias</SelectItem>
              </SelectContent>
            </Select>

            <Select value={source} onValueChange={(v: any) => setSource(v)}>
              <SelectTrigger><SelectValue placeholder="Fonte" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as fontes</SelectItem>
                <SelectItem value="captured">Formulário Facebook</SelectItem>
                <SelectItem value="customer">WhatsApp Lead</SelectItem>
              </SelectContent>
            </Select>

            <Select value={scope} onValueChange={(v: any) => setScope(v)}>
              <SelectTrigger><SelectValue placeholder="Escopo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mine">Meus leads</SelectItem>
                <SelectItem value="all">Todos os consultores</SelectItem>
              </SelectContent>
            </Select>

            <Input
              placeholder="DDDs (ex: 11,19,34)"
              value={dddInput}
              onChange={(e) => setDddInput(e.target.value)}
            />

            <div className="md:col-span-2 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Buscar por nome ou telefone"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="md:col-span-6 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDddInput(DDD_PRESETS.minas.join(","))}>
                Minas (31-38)
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setDddInput(DDD_PRESETS.sp_capital.join(","))}>
                SP capital (11)
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setDddInput(DDD_PRESETS.sp_interior.join(","))}>
                SP interior (12-19)
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setDddInput("11,19,34")}>
                11 + 19 + 34
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDddInput("")}>
                Limpar DDD
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Contadores por DDD */}
        {Object.keys(dddCounts).length > 0 && (
          <Card>
            <CardContent className="pt-4 flex flex-wrap gap-2">
              {Object.entries(dddCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([ddd, count]) => (
                  <Badge key={ddd} variant="outline" className="text-xs">
                    DDD {ddd}: <span className="font-bold ml-1">{count}</span>
                  </Badge>
                ))}
            </CardContent>
          </Card>
        )}

        {/* Ações em massa */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm text-muted-foreground mr-auto">
            {isLoading ? "Carregando…" : `${rows.length} leads · ${selected.size} selecionados`}
          </div>
          <Button
            size="sm"
            disabled={selected.size === 0 || promote.isPending}
            onClick={() => promote.mutate(Array.from(selected))}
          >
            {promote.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-1" />}
            Colocar em conversão ({selected.size})
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={selected.size === 0 || markLost.isPending}
            onClick={() => markLost.mutate(Array.from(selected))}
          >
            <XCircle className="h-4 w-4 mr-1" />
            Marcar como perdido
          </Button>
        </div>

        {/* Tabela */}
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3 w-10">
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                  </th>
                  <th className="p-3 text-left">Nome</th>
                  <th className="p-3 text-left">Telefone</th>
                  <th className="p-3 text-left">DDD</th>
                  <th className="p-3 text-left">Cidade/UF</th>
                  <th className="p-3 text-left">Fonte</th>
                  <th className="p-3 text-left">Campanha</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-left">Parado há</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t hover:bg-muted/30">
                    <td className="p-3">
                      <Checkbox checked={selected.has(r.key)} onCheckedChange={() => toggleOne(r.key)} />
                    </td>
                    <td className="p-3 font-medium">{r.name || <span className="italic text-muted-foreground">sem nome</span>}</td>
                    <td className="p-3 font-mono text-xs">{r.phone_norm || "—"}</td>
                    <td className="p-3">
                      {r.ddd ? <Badge variant="outline">{r.ddd}</Badge> : "—"}
                    </td>
                    <td className="p-3 text-xs">
                      {[r.city, r.uf].filter(Boolean).join(" / ") || "—"}
                    </td>
                    <td className="p-3">
                      <Badge variant={r.source === "captured" ? "secondary" : "default"} className="text-xs">
                        {r.source === "captured" ? "Formulário FB" : "WhatsApp"}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs">{r.source_campaign_id ? "sim" : "—"}</td>
                    <td className="p-3 text-xs">{r.status || "—"}</td>
                    <td className="p-3 text-xs">{r.days_stuck}d</td>
                  </tr>
                ))}
                {!isLoading && rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-muted-foreground">
                      Nenhum lead parado com esses filtros.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
