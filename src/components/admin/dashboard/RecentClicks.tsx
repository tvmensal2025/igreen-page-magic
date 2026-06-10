import { friendlyClickLabel } from "@/hooks/useAnalytics";

interface Click {
  target: string;
  page: string;
  device: string;
  source: string;
  created_at: string;
}

interface Props {
  clicks?: Click[];
}

function fmt(ts: string) {
  const d = new Date(ts);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

export function RecentClicks({ clicks = [] }: Props) {
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden h-full flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Últimos cliques</h3>
        <span className="text-xs text-muted-foreground">{clicks.length} eventos</span>
      </header>
      {clicks.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground flex-1 flex items-center justify-center">
          Nenhum clique recente
        </div>
      ) : (
        <ol className="flex-1 max-h-[440px] overflow-y-auto">
          {clicks.map((c, i) => {
            const accent = c.target.includes("whatsapp")
              ? "hsl(var(--primary))"
              : c.target.includes("cadastro")
              ? "hsl(var(--warning))"
              : "hsl(var(--muted-foreground))";
            return (
              <li
                key={i}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 border-b border-border/60 hover:bg-muted/50 text-xs"
              >
                <span className="text-muted-foreground tabular-nums w-10">{fmt(c.created_at)}</span>
                <div className="min-w-0 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: accent }} />
                  <span className="text-foreground truncate">{friendlyClickLabel(c.target)}</span>
                </div>
                <span className="text-muted-foreground uppercase text-[10px] tracking-wide">
                  {c.device} · {c.source}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
