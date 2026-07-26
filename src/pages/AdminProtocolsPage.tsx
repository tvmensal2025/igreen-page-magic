import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Search, ArrowLeft, Download } from "lucide-react";
import { toast } from "sonner";

type CampaignRow = {
  id: string;
  name: string;
  status: string | null;
  tracking_protocol: string | null;
  tracking_protocol_channel: string | null;
  consultant_id: string;
  created_at: string;
  initial_message: string | null;
};

export default function AdminProtocolsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["admin-protocols"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("facebook_campaigns")
        .select(
          "id,name,status,tracking_protocol,tracking_protocol_channel,consultant_id,created_at,initial_message",
        )
        .not("tracking_protocol", "is", null)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as CampaignRow[];
    },
  });

  const consultantIds = useMemo(
    () => Array.from(new Set(campaigns.map((c) => c.consultant_id).filter(Boolean))),
    [campaigns],
  );

  const { data: consultants = {} } = useQuery({
    queryKey: ["admin-protocols-consultants", consultantIds],
    enabled: consultantIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consultants")
        .select("id, name, phone")
        .in("id", consultantIds);
      if (error) throw error;
      const map: Record<string, { id: string; name: string | null; phone: string | null }> = {};
      (data ?? []).forEach((r) => {
        map[r.id] = r;
      });
      return map;
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (statusFilter !== "all" && (c.status ?? "").toLowerCase() !== statusFilter) return false;
      if (!q) return true;
      const consultant = consultants[c.consultant_id];
      return (
        c.tracking_protocol?.toLowerCase().includes(q) ||
        c.name?.toLowerCase().includes(q) ||
        consultant?.name?.toLowerCase().includes(q) ||
        consultant?.phone?.toLowerCase().includes(q)
      );
    });
  }, [campaigns, consultants, search, statusFilter]);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`Protocolo ${text} copiado`);
  };

  const exportCsv = () => {
    const rows = [
      ["Protocolo", "Campanha", "Status", "Consultor", "Telefone", "Criada em"],
      ...filtered.map((c) => [
        c.tracking_protocol ?? "",
        c.name ?? "",
        c.status ?? "",
        consultants[c.consultant_id]?.name ?? "",
        consultants[c.consultant_id]?.phone ?? "",
        new Date(c.created_at).toLocaleString("pt-BR"),
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `protocolos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" asChild className="shrink-0">
            <Link to="/admin"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold truncate">Protocolos</h1>
            <p className="text-sm text-muted-foreground">
              Dois códigos distintos — não confundir
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0} className="shrink-0">
          <Download className="h-4 w-4 mr-2" /> Exportar CSV
        </Button>
      </div>

      {/* Cards explicativos: DOIS protocolos diferentes */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Badge variant="secondary" className="font-mono">2026-0042</Badge>
              Protocolo da Campanha
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            <p>Vai embutido no anúncio Meta (wa.me). O <b>cliente envia</b> ao iniciar a conversa.</p>
            <p>Usado pra <b>casar o lead com a campanha</b> e disparar o rodízio de parceiros.</p>
            <p className="text-[11px] italic">↓ Listados abaixo</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-emerald-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Badge variant="secondary" className="font-mono">IGR-RFF-0042</Badge>
              Chamado de Atendimento
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            <p><b>Gerado por nós</b> quando o atendimento abre. Contém a sigla do parceiro (ex.: RFF = Rafael Ferreira).</p>
            <p>É o <b>número do chamado</b> que fica com o cliente pra suporte — não serve pra matching de campanha.</p>
            <p className="text-[11px] italic">Fica salvo em <code>customers.tracking_protocol</code></p>
          </CardContent>
        </Card>
      </div>


      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Buscar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Protocolo (ex: 2026-0042), campanha, consultor ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {["all", "active", "paused", "pending_review", "archived"].map((s) => (
              <Button
                key={s}
                size="sm"
                variant={statusFilter === s ? "default" : "outline"}
                onClick={() => setStatusFilter(s)}
              >
                {s === "all" ? "Todos" : s}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {isLoading ? "Carregando..." : `${filtered.length} protocolo(s)`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="border-b bg-muted/40">
                <tr className="text-left">
                  <th className="p-3">Protocolo</th>
                  <th className="p-3">Campanha</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Consultor</th>
                  <th className="p-3">Criada em</th>
                  <th className="p-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const cons = consultants[c.consultant_id];
                  return (
                    <tr key={c.id} className="border-b hover:bg-muted/20">
                      <td className="p-3">
                        <Badge variant="secondary" className="font-mono text-xs">
                          {c.tracking_protocol}
                        </Badge>
                      </td>
                      <td className="p-3 max-w-[280px] truncate">{c.name}</td>
                      <td className="p-3">
                        <Badge
                          variant={c.status === "active" ? "default" : "outline"}
                          className="text-xs"
                        >
                          {c.status ?? "—"}
                        </Badge>
                      </td>
                      <td className="p-3">
                        {cons?.name ?? "—"}
                        {cons?.phone && (
                          <span className="text-muted-foreground text-xs block">
                            {cons.phone}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground text-xs">
                        {new Date(c.created_at).toLocaleString("pt-BR")}
                      </td>
                      <td className="p-3">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => c.tracking_protocol && copy(c.tracking_protocol)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                      Nenhum protocolo encontrado
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
