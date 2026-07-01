// Lista detalhada de apólices de Seguros capturadas do escritório iGreen.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { norm } from "./searchUtils";

const BRL = (n: number | null | undefined) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });


interface SeguroRow {
  id: string;
  seguro_id: number | null;
  segurado: string | null;
  modelo: string | null;
  placa: string | null;
  fipe: number | null;
  mensal: number | null;
  status: string | null;
  status_label: string | null;
  cidade: string | null;
  uf: string | null;
  licenciado: string | null;
}

export function SegurosClientesList({ consultantId }: { consultantId: string }) {
  const [q, setQ] = useState("");
  const { data = [] } = useQuery({
    queryKey: ["igreen-seguros-clientes", consultantId],
    enabled: !!consultantId,
    staleTime: 60_000,
    queryFn: async (): Promise<SeguroRow[]> => {
      const { data, error } = await supabase
        .from("igreen_seguros_customers" as never)
        .select("id, seguro_id, segurado, modelo, placa, fipe, mensal, status, status_label, cidade, uf, licenciado")
        .eq("consultant_id", consultantId)
        .order("mensal", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data || []) as unknown as SeguroRow[];
    },
  });

  const filtered = useMemo(() => {
    const s = norm(q.trim());
    if (!s) return data;
    return data.filter((c) =>
      norm(
        `${c.segurado || ""} ${c.modelo || ""} ${c.placa || ""} ${c.cidade || ""} ${c.uf || ""} ${c.licenciado || ""} ${c.status_label || ""}`,
      ).includes(s),
    );
  }, [data, q]);

  if (data.length === 0) return null;
  const mrrSource = q.trim() ? filtered : data;
  const mrr = mrrSource
    .filter((c) => (c.status || "").toLowerCase().includes("vigent"))
    .reduce((s, c) => s + Number(c.mensal || 0), 0);
  const hasQuery = q.trim().length > 0;

  return (
    <section className="rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.03] to-card">
      <header className="p-4 border-b border-emerald-500/15 bg-emerald-500/5 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <ShieldCheck className="w-3.5 h-3.5" />
            </span>
            Apólices de Seguros
            <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-700">
              {hasQuery ? `${filtered.length} de ${data.length}` : data.length}
            </Badge>
          </h3>
          <span className="text-[11px] text-muted-foreground">
            MRR {hasQuery ? "filtrado" : "vigentes"}: <strong className="text-emerald-700">{BRL(mrr)}</strong>
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar segurado, veículo, placa, cidade…" className="pl-9" />
        </div>
      </header>
      {filtered.length === 0 ? (
        <div className="p-8 text-center text-xs text-muted-foreground">
          Nenhum resultado para <strong>«{q}»</strong>.
        </div>
      ) : (
        <ul className="divide-y divide-emerald-500/10 max-h-[500px] overflow-y-auto">
          {filtered.slice(0, 300).map((c) => (
            <li key={c.id} className="p-3 hover:bg-emerald-500/5 transition-colors">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium truncate">{c.segurado || "—"}</p>
                    {c.status_label && (
                      <Badge variant="outline" className="text-[10px]">
                        {c.status_label}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {c.modelo || "—"} · {c.placa || "—"} · FIPE {BRL(c.fipe)} · {c.cidade || "?"}/{c.uf || "?"} · {c.licenciado || "—"}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold">{BRL(c.mensal)}</p>
                  <p className="text-[10px] text-muted-foreground">/mês</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {filtered.length > 300 && (
        <p className="p-2 text-[10px] text-center text-muted-foreground border-t border-emerald-500/15">
          Mostrando 300 primeiros — refine a busca.
        </p>
      )}
    </section>
  );

}
