import { useMemo, useState } from "react";
import { Users, Award, CheckCircle2, Zap, Download, Search } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
  Bar,
} from "recharts";
import { StatCard } from "../StatCard";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useTeamRegistrations, type TeamCustomer } from "@/hooks/useTeamRegistrations";

interface TeamDashboardProps {
  leaderConsultantId: string;
  customers: TeamCustomer[] | undefined; // idealmente já filtrado para wallet iGreen
  periodDays: number;
}

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(45 90% 55%)",
  "hsl(200 85% 55%)",
  "hsl(280 70% 60%)",
  "hsl(0 0% 55%)",
];

export function TeamDashboard({ leaderConsultantId, customers, periodDays }: TeamDashboardProps) {
  const data = useTeamRegistrations(leaderConsultantId, customers, periodDays);
  const [q, setQ] = useState("");
  const [licFilter, setLicFilter] = useState<string>("all");

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLowerCase();
    return data.customers.filter((c) => {
      if (licFilter !== "all") {
        const name = c.registered_by_name ?? (c.registered_by_igreen_id ? `Licenciado ${c.registered_by_igreen_id}` : "Sem licenciado");
        if (name !== licFilter) return false;
      }
      if (!term) return true;
      return (
        (c.name ?? "").toLowerCase().includes(term) ||
        (c.registered_by_name ?? "").toLowerCase().includes(term) ||
        (c.address_city ?? "").toLowerCase().includes(term) ||
        (c.address_state ?? "").toLowerCase().includes(term)
      );
    });
  }, [data, q, licFilter]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.porDia.map((d) => {
      const row: Record<string, number | string> = { label: d.label };
      for (const name of data.topLicenciadoIds) row[name] = d.perTop[name] ?? 0;
      row["Outros"] = d.perTop["Outros"] ?? 0;
      return row;
    });
  }, [data]);

  const handleExportCsv = () => {
    if (!data) return;
    const header = ["Cliente", "Licenciado", "Código iGreen", "Cidade", "UF", "Status", "kWh", "Criado em"];
    const lines = [header.join(";")];
    for (const c of filteredRows) {
      lines.push(
        [
          c.name ?? "",
          c.registered_by_name ?? "",
          c.registered_by_igreen_id ?? "",
          c.address_city ?? "",
          c.address_state ?? "",
          c.status ?? "",
          String(Number(c.media_consumo) || 0),
          new Date(c.created_at).toISOString(),
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(";"),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cadastros-equipe-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!data) {
    return (
      <div className="rounded-xl border border-border/40 bg-card/40 p-6 text-sm text-muted-foreground font-inter">
        Carregando cadastros da equipe…
      </div>
    );
  }

  const deltaPct = Math.round(data.totals.delta.cadastros * 100);

  return (
    <section className="space-y-4">
      {/* Header */}
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-inter">Cadastros da equipe</p>
          <h2 className="font-display text-2xl md:text-3xl font-semibold text-foreground leading-tight">
            Visão consolidada da rede
          </h2>
          <p className="text-xs text-muted-foreground font-inter mt-0.5">
            Últimos {periodDays} dias · {data.totals.licenciadosAtivos} licenciados ativos
          </p>
        </div>
        <Badge variant="outline" className="font-inter text-[11px] border-primary/30 text-primary bg-primary/5">
          {deltaPct >= 0 ? "▲" : "▼"} {Math.abs(deltaPct)}% vs período anterior
        </Badge>
      </header>

      {/* KPI ROW */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-4">
        <StatCard
          icon={<Users className="w-5 h-5" />}
          label="Cadastros totais"
          value={data.totals.cadastros}
          delta={{ value: deltaPct, direction: deltaPct >= 0 ? "up" : "down" }}
        />
        <StatCard
          icon={<Award className="w-5 h-5" />}
          label="Licenciados ativos"
          value={data.totals.licenciadosAtivos}
          subtitle="com cadastro no período"
        />
        <StatCard
          icon={<CheckCircle2 className="w-5 h-5" />}
          label="Aprovados"
          value={data.totals.aprovados}
          subtitle={`${Math.round((data.totals.aprovados / Math.max(1, data.totals.cadastros)) * 100)}% de conversão`}
        />
        <StatCard
          icon={<Zap className="w-5 h-5" />}
          label="kWh total"
          value={`${Math.round(data.totals.kwh).toLocaleString("pt-BR")} kW`}
          subtitle="soma da média de consumo"
        />
      </div>

      {/* Chart + Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-border/40 bg-card/60 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-sm font-semibold text-foreground">Cadastros por dia · top 5 licenciados</h3>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-inter">Área empilhada</span>
          </div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  {[...data.topLicenciadoIds, "Outros"].map((name, idx) => (
                    <linearGradient key={name} id={`g-${idx}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS[idx % CHART_COLORS.length]} stopOpacity={0.6} />
                      <stop offset="95%" stopColor={CHART_COLORS[idx % CHART_COLORS.length]} stopOpacity={0.05} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {[...data.topLicenciadoIds, "Outros"].map((name, idx) => (
                  <Area
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stackId="1"
                    stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                    fill={`url(#g-${idx})`}
                    strokeWidth={2}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border/40 bg-card/60 p-4">
          <h3 className="font-display text-sm font-semibold text-foreground mb-3">Ranking de licenciados</h3>
          <ol className="space-y-2">
            {data.porLicenciado.slice(0, 10).map((b, idx) => {
              const max = data.porLicenciado[0]?.count || 1;
              const pct = (b.count / max) * 100;
              return (
                <li key={`${b.igreenId ?? b.name}-${idx}`} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-inter">
                    <span className="truncate max-w-[180px]" title={b.name}>
                      <span className="text-muted-foreground mr-1.5">{idx + 1}.</span>
                      {b.name}
                    </span>
                    <span className="font-display font-semibold tabular-nums text-foreground">{b.count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/80"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {(b.graduacao || b.uf) && (
                    <div className="text-[10px] text-muted-foreground font-inter">
                      {b.graduacao ?? "—"} {b.uf ? `· ${b.uf}` : ""}
                    </div>
                  )}
                </li>
              );
            })}
            {data.porLicenciado.length === 0 && (
              <li className="text-xs text-muted-foreground font-inter">Nenhum cadastro no período.</li>
            )}
          </ol>
        </div>
      </div>

      {/* Status + Origem + UF */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border/40 bg-card/60 p-4">
          <h3 className="font-display text-sm font-semibold mb-3">Status</h3>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.porStatus}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {data.porStatus.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border/40 bg-card/60 p-4">
          <h3 className="font-display text-sm font-semibold mb-3">Origem</h3>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.porOrigem} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="origem" tick={{ fontSize: 11 }} width={100} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border/40 bg-card/60 p-4">
          <h3 className="font-display text-sm font-semibold mb-3">Estados (top 8)</h3>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.porUF}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="uf" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" fill="hsl(var(--accent))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="rounded-xl border border-border/40 bg-card/60 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-display text-sm font-semibold">Cadastros da equipe</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar cliente, cidade…"
                className="h-8 w-[220px] pl-8 text-xs font-inter"
              />
            </div>
            <Select value={licFilter} onValueChange={setLicFilter}>
              <SelectTrigger className="h-8 w-[180px] text-xs font-inter">
                <SelectValue placeholder="Licenciado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos licenciados</SelectItem>
                {data.porLicenciado.map((b) => (
                  <SelectItem key={b.name} value={b.name}>
                    {b.name} ({b.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={handleExportCsv}>
              <Download className="w-3.5 h-3.5" /> CSV
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto -mx-4 px-4 max-h-[420px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[11px] uppercase tracking-wider font-inter">Cliente</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider font-inter">Licenciado</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider font-inter">Cidade / UF</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider font-inter">Status</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider font-inter text-right">kWh</TableHead>
                <TableHead className="text-[11px] uppercase tracking-wider font-inter">Criado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.slice(0, 200).map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="text-xs font-inter">{c.name ?? "—"}</TableCell>
                  <TableCell className="text-xs font-inter text-muted-foreground">
                    {c.registered_by_name ?? (c.registered_by_igreen_id ? `#${c.registered_by_igreen_id}` : "—")}
                  </TableCell>
                  <TableCell className="text-xs font-inter">
                    {[c.address_city, c.address_state].filter(Boolean).join(" / ") || "—"}
                  </TableCell>
                  <TableCell className="text-xs font-inter">
                    <Badge variant="outline" className="text-[10px]">
                      {c.status ?? "—"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs font-display font-semibold tabular-nums text-right">
                    {Math.round(Number(c.media_consumo) || 0)}
                  </TableCell>
                  <TableCell className="text-xs font-inter text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString("pt-BR")}
                  </TableCell>
                </TableRow>
              ))}
              {filteredRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-6 font-inter">
                    Nenhum cadastro encontrado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {filteredRows.length > 200 && (
            <p className="text-[11px] text-muted-foreground text-center mt-2 font-inter">
              Mostrando 200 de {filteredRows.length}. Refine a busca para ver mais.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
