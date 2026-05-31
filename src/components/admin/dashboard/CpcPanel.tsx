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
    <section className="border border-[#1a2e1a] bg-[#0a0f0a] overflow-hidden h-full">
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-[#1a2e1a]">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-zinc-500 tracking-widest">PNL_02</span>
          <h3 className="font-mono text-xs font-bold tracking-wider text-zinc-200">CUSTO POR CLIQUE</h3>
        </div>
        <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
          TOT.CTA <span className="text-[#fbbf24]">{totalCtaClicks}</span>
        </span>
      </header>
      {rows.length === 0 ? (
        <div className="p-8 text-center font-mono text-xs text-zinc-600">— sem cliques no período —</div>
      ) : (
        <table className="w-full font-mono text-xs">
          <thead>
            <tr className="text-[9px] tracking-widest text-zinc-600 uppercase">
              <th className="text-left px-4 py-2 font-normal">#</th>
              <th className="text-left py-2 font-normal">CTA</th>
              <th className="text-right py-2 font-normal">CLIQUES</th>
              <th className="text-right py-2 font-normal">SHARE</th>
              <th className="text-right px-4 py-2 font-normal">CPC</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isPrimary = r.target.includes("whatsapp") || r.target.includes("cadastro");
              const accent = r.target.includes("whatsapp") ? "#22c55e" : r.target.includes("cadastro") ? "#fbbf24" : "#737373";
              return (
                <tr key={r.target} className="border-t border-[#1a2e1a] hover:bg-black/40">
                  <td className="px-4 py-2.5 text-zinc-600 tabular-nums">{String(i + 1).padStart(2, "0")}</td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-1 h-3" style={{ background: accent }} />
                      <span className={isPrimary ? "text-zinc-100" : "text-zinc-400"}>{friendlyClickLabel(r.target)}</span>
                    </div>
                  </td>
                  <td className="py-2.5 text-right tabular-nums font-bold" style={{ color: accent }}>
                    {r.clicks}
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-zinc-400">{r.share.toFixed(1)}%</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">
                    {r.cpc != null ? `R$${r.cpc.toFixed(2)}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <footer className="px-4 py-2 border-t border-[#1a2e1a] font-mono text-[9px] text-zinc-600 tracking-wider">
        CPC = gasto de anúncio ÷ cliques CTA (blended). Sem gasto Meta no período → "—".
      </footer>
    </section>
  );
}
