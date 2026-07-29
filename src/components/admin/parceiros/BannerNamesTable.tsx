import { Loader2, QrCode, Users } from "lucide-react";

export type BannerNameRow = {
  key: string;
  name: string;
  code?: string | null;
  leituras: number;
  leads: number;
  /** geral | local | arquivado */
  kind: "geral" | "local" | "arquivado";
};

interface Props {
  rows: BannerNameRow[];
  loading?: boolean;
  emptyHint?: string;
  title?: string;
}

/**
 * Tabela canônica: Nome do banner | leituras | leads.
 * Usada na Lista e em Resultados para o consultor saber qual ponto performou.
 */
export function BannerNamesTable({
  rows,
  loading = false,
  emptyHint = "Nenhum banner nomeado ainda. Crie um local com nome para rastrear.",
  title = "Por nome do banner",
}: Props) {
  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60">
        <p className="text-xs font-heading font-bold text-muted-foreground uppercase tracking-wider">
          {title}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Cada nome identifica de onde veio a leitura e o lead.
        </p>
      </div>

      {loading ? (
        <div className="p-8 flex items-center justify-center text-muted-foreground text-sm gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          {emptyHint}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/30 text-[11px] text-muted-foreground uppercase tracking-wide">
                <th className="text-left font-medium px-4 py-2.5">Nome</th>
                <th className="text-right font-medium px-3 py-2.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1 justify-end">
                    <QrCode className="h-3 w-3" /> Leituras
                  </span>
                </th>
                <th className="text-right font-medium px-4 py-2.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1 justify-end">
                    <Users className="h-3 w-3" /> Leads
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.key}
                  className="border-b border-border/40 last:border-0 hover:bg-muted/20"
                >
                  <td className="px-4 py-2.5 min-w-0">
                    <p className="font-medium text-foreground truncate">{r.name}</p>
                    {r.code ? (
                      <p className="text-[10px] font-mono text-muted-foreground truncate">
                        /{r.code}
                      </p>
                    ) : r.kind === "geral" ? (
                      <p className="text-[10px] text-muted-foreground">
                        QR raiz · sem ponto específico
                      </p>
                    ) : null}
                    {r.kind === "arquivado" && (
                      <p className="text-[10px] text-amber-700 dark:text-amber-400">
                        arquivado
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                    {r.leituras.toLocaleString("pt-BR")}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                    {r.leads.toLocaleString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Monta linhas Geral + locais a partir de contagens e spots. */
export function buildBannerNameRows(opts: {
  rootScans: number;
  rootLeads?: number;
  spots: Array<{
    id: string;
    code: string;
    keyword: string;
    is_active?: boolean;
  }>;
  scanByCode: Record<string, number>;
  leadByKeyword: Record<string, number>;
}): BannerNameRow[] {
  const rows: BannerNameRow[] = [
    {
      key: "__root",
      name: "Banner Geral",
      leituras: opts.rootScans,
      leads: opts.rootLeads ?? 0,
      kind: "geral",
    },
  ];

  const usedKeywords = new Set<string>();
  for (const s of opts.spots) {
    const kw = String(s.keyword || "").trim();
    usedKeywords.add(kw.toLowerCase());
    rows.push({
      key: s.id,
      name: kw || s.code,
      code: s.code,
      leituras: opts.scanByCode[s.code] || 0,
      leads: opts.leadByKeyword[kw] || 0,
      kind: s.is_active === false ? "arquivado" : "local",
    });
  }

  // Keywords de lead sem spot cadastrado (histórico / parceiro / legado).
  for (const [kw, n] of Object.entries(opts.leadByKeyword)) {
    if (!kw || usedKeywords.has(kw.toLowerCase())) continue;
    rows.push({
      key: `kw:${kw}`,
      name: kw,
      leituras: 0,
      leads: n,
      kind: "local",
    });
  }

  return rows.sort((a, b) => {
    if (a.kind === "geral") return -1;
    if (b.kind === "geral") return 1;
    const score = b.leituras + b.leads - (a.leituras + a.leads);
    if (score !== 0) return score;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}
