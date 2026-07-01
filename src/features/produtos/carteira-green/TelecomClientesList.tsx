// Lista detalhada de clientes Telecom capturados do escritório iGreen.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, PhoneCall } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { norm } from "./searchUtils";

const BRL = (n: number | null | undefined) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });


interface TelecomRow {
  id: string;
  idcnxtelecom: number | null;
  nome: string | null;
  cidade: string | null;
  uf: string | null;
  numero: string | null;
  licenciado: string | null;
  status: string | null;
  status_label: string | null;
  data: string | null;
  fatura_valor: number | null;
  fatura_status: string | null;
  fatura_mes_referencia: string | null;
}

export function TelecomClientesList({ consultantId }: { consultantId: string }) {
  const [q, setQ] = useState("");
  const { data = [] } = useQuery({
    queryKey: ["igreen-telecom-clientes", consultantId],
    enabled: !!consultantId,
    staleTime: 60_000,
    queryFn: async (): Promise<TelecomRow[]> => {
      const { data, error } = await supabase
        .from("igreen_telecom_customers" as never)
        .select("id, idcnxtelecom, nome, cidade, uf, numero, licenciado, status, status_label, data, fatura_valor, fatura_status, fatura_mes_referencia")
        .eq("consultant_id", consultantId)
        .order("data", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data || []) as unknown as TelecomRow[];
    },
  });

  const filtered = useMemo(() => {
    const s = norm(q.trim());
    if (!s) return data;
    return data.filter((c) =>
      norm(
        `${c.nome || ""} ${c.cidade || ""} ${c.uf || ""} ${c.numero || ""} ${c.licenciado || ""} ${c.status_label || ""} ${c.fatura_status || ""}`,
      ).includes(s),
    );
  }, [data, q]);

  if (data.length === 0) return null;
  const mrrSource = q.trim() ? filtered : data;
  const mrr = mrrSource
    .filter((c) => (c.status || "").toLowerCase().includes("ativ"))
    .reduce((s, c) => s + Number(c.fatura_valor || 0), 0);
  const hasQuery = q.trim().length > 0;

  return (
    <section className="rounded-xl border border-border/60 bg-card">
      <header className="p-4 border-b border-border/60 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <PhoneCall className="w-4 h-4 text-muted-foreground" />
            Clientes Telecom
            <Badge variant="outline" className="text-[10px] font-normal">
              {hasQuery ? `${filtered.length} de ${data.length}` : data.length}
            </Badge>
          </h3>
          <span className="text-[11px] text-muted-foreground">
            MRR {hasQuery ? "filtrado" : "ativos"}: <strong className="text-foreground">{BRL(mrr)}</strong>
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente, número, cidade, status…" className="pl-9" />
        </div>
      </header>
      {filtered.length === 0 ? (
        <div className="p-8 text-center text-xs text-muted-foreground">
          Nenhum resultado para <strong>«{q}»</strong>.
        </div>
      ) : (
        <ul className="divide-y divide-border/60 max-h-[500px] overflow-y-auto">
          {filtered.slice(0, 300).map((c) => (
            <li key={c.id} className="p-3 hover:bg-muted/40 transition-colors">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium truncate">{c.nome || "—"}</p>
                    {c.status_label && (
                      <Badge variant="outline" className="text-[10px]">
                        {c.status_label}
                      </Badge>
                    )}
                    {c.fatura_status && (
                      <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-500/30">
                        Fatura: {c.fatura_status}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {c.cidade || "?"}/{c.uf || "?"} · linha {c.numero || "—"} · {c.licenciado || "—"}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold">{BRL(c.fatura_valor)}</p>
                  <p className="text-[10px] text-muted-foreground">{c.fatura_mes_referencia || ""}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {filtered.length > 300 && (
        <p className="p-2 text-[10px] text-center text-muted-foreground border-t border-border/60">
          Mostrando 300 primeiros — refine a busca.
        </p>
      )}
    </section>
  );


}
