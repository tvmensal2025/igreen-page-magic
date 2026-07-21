import { friendlyClickLabel } from "@/hooks/useAnalytics";

interface Row {
  target: string;
  clicks: number;
  share: number;
  cpc: number | null;
}

interface Props {
  data?: Row[];
  totalCtaClicks?: number;
}

export function CpcPanel({ data = [], totalCtaClicks = 0 }: Props) {
  const ctas = data.filter((d) => d.target.includes("whatsapp") || d.target.includes("cadastro"));
  const others = data.filter((d) => !d.target.includes("whatsapp") && !d.target.includes("cadastro"));
  const rows = [...ctas, ...others].slice(0, 8);

  return (
    <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden h-full">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Custo por clique</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          Total de ações:{" "}
          <span className="font-semibold text-foreground">{totalCtaClicks}</span>
        </span>
      </header>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Nenhum clique no período</div>
      ) : (
        <div className="overflow-x-auto min-w-0 overscroll-x-contain">
        <table className="w-full text-sm min-w-[420px]">
          <thead>
            <tr className="text-[11px] tracking-wide text-muted-foreground uppercase">
              <th className="text-left px-4 py-2.5 font-medium">#</th>
              <th className="text-left py-2.5 font-medium">Ação</th>
              <th className="text-right py-2.5 font-medium">Cliques</th>
              <th className="text-right py-2.5 font-medium">Participação</th>
              <th className="text-right px-4 py-2.5 font-medium">Custo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isPrimary = r.target.includes("whatsapp") || r.target.includes("cadastro");
              const accent = r.target.includes("whatsapp")
                ? "hsl(var(--primary))"
                : r.target.includes("cadastro")
                ? "hsl(var(--warning))"
                : "hsl(var(--muted-foreground))";
              return (
                <tr key={r.target} className="border-t border-border hover:bg-muted/50">
                  <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{String(i + 1).padStart(2, "0")}</td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-1 h-3 rounded-full" style={{ background: accent }} />
                      <span className={isPrimary ? "text-foreground font-medium" : "text-muted-foreground"}>
                        {friendlyClickLabel(r.target)}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 text-right tabular-nums font-semibold" style={{ color: accent }}>
                    {r.clicks}
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">{r.share.toFixed(1)}%</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {r.cpc != null ? `R$ ${r.cpc.toFixed(2)}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
      <footer className="px-4 py-2.5 border-t border-border text-xs text-muted-foreground">
        Custo por clique = investimento em anúncios ÷ cliques nos botões de ação. Sem investimento no período, mostramos "—".
      </footer>
    </section>
  );
}
