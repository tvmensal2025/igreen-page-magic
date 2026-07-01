import { useMemo } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { DevolutivaRow } from "./hooks";

export function DevolutivasList({ devolutivas }: { devolutivas: DevolutivaRow[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, DevolutivaRow[]>();
    for (const d of devolutivas) {
      const key = d.categoria || "Sem categoria";
      const arr = map.get(key) || [];
      arr.push(d);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [devolutivas]);

  const abertas = devolutivas.filter((d) => !d.resolvida_em).length;
  const impeditivas = devolutivas.filter((d) => d.impeditiva && !d.resolvida_em).length;

  return (
    <section className="rounded-xl border border-border/60 bg-card">
      <header className="p-4 border-b border-border/60 flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold">Devolutivas detalhadas</h3>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">{abertas} abertas</Badge>
          {impeditivas > 0 && (
            <Badge className="bg-red-500/10 text-red-600 border-red-500/30 text-[10px]" variant="outline">
              {impeditivas} impeditivas
            </Badge>
          )}
        </div>
      </header>

      {devolutivas.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">
          Sem devolutivas — carteira limpa.
        </p>
      ) : (
        <div className="divide-y divide-border/60 max-h-[600px] overflow-y-auto">
          {groups.map(([cat, items]) => (
            <div key={cat} className="p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {cat} · {items.length}
              </p>
              <ul className="space-y-2">
                {items.slice(0, 20).map((d) => (
                  <li key={d.id} className="rounded-lg border border-border/40 p-2.5 bg-background">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{d.nome || "Cliente"}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {d.cidade || "?"}/{d.uf || "?"} · {d.licenciado || ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {d.resolvida_em ? (
                          <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px]" variant="outline">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Resolvida
                          </Badge>
                        ) : d.impeditiva ? (
                          <Badge className="bg-red-500/10 text-red-600 border-red-500/30 text-[10px]" variant="outline">
                            <AlertTriangle className="h-3 w-3 mr-1" /> Impeditiva
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Aberta</Badge>
                        )}
                        {d.propria && (
                          <Badge variant="outline" className="text-[10px]">Própria</Badge>
                        )}
                      </div>
                    </div>
                    {(d.campo || d.motivo) && (
                      <p className="text-[11px] mt-1.5 text-foreground/80">
                        {d.campo && <strong className="text-foreground">{d.campo}: </strong>}
                        {d.motivo || "—"}
                      </p>
                    )}
                    {d.data_devolutiva && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {new Date(d.data_devolutiva).toLocaleDateString("pt-BR")}
                      </p>
                    )}
                  </li>
                ))}
                {items.length > 20 && (
                  <li className="text-[10px] text-muted-foreground text-center pt-1">
                    +{items.length - 20} nesta categoria
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
