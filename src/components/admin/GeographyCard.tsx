import { MapPin, Building2 } from "lucide-react";
import { ufFromPhone } from "@/lib/dddToUf";

interface Customer {
  address_state?: string | null;
  distribuidora?: string | null;
  phone_whatsapp?: string | null;
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="grid grid-cols-[80px_1fr_auto] items-center gap-3 py-1.5">
      <span className="text-xs font-semibold text-foreground truncate">{label}</span>
      <div className="h-2 rounded-full bg-border/30 overflow-hidden">
        <div className={`h-full ${color} transition-all duration-700`} style={{ width: `${Math.max(pct, 4)}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{value}</span>
    </div>
  );
}

export function GeographyCard({ customers }: { customers: Customer[] | undefined }) {
  const list = customers ?? [];

  const distMap = new Map<string, number>();
  for (const c of list) {
    const d = (c.distribuidora || "").trim();
    if (!d) continue;
    distMap.set(d, (distMap.get(d) || 0) + 1);
  }
  const topDist = Array.from(distMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxDist = topDist[0]?.[1] || 0;

  const ufMap = new Map<string, number>();
  for (const c of list) {
    const uf = (c.address_state || "").trim().toUpperCase() || ufFromPhone(c.phone_whatsapp);
    if (!uf) continue;
    ufMap.set(uf, (ufMap.get(uf) || 0) + 1);
  }
  const topUf = Array.from(ufMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxUf = topUf[0]?.[1] || 0;

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="rounded-2xl border border-border/60 bg-card/60 backdrop-blur overflow-hidden">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-border/40">
          <Building2 className="w-4 h-4 text-primary" />
          <div>
            <h3 className="font-heading font-black text-sm tracking-tight">TOP DISTRIBUIDORAS</h3>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Sua cobertura por concessionária</p>
          </div>
        </header>
        <div className="px-5 py-4">
          {topDist.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem dados de distribuidora.</p>
          ) : (
            topDist.map(([name, v]) => <Bar key={name} label={name} value={v} max={maxDist} color="bg-primary" />)
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card/60 backdrop-blur overflow-hidden">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-border/40">
          <MapPin className="w-4 h-4 text-primary" />
          <div>
            <h3 className="font-heading font-black text-sm tracking-tight">TOP ESTADOS</h3>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Onde estão seus clientes</p>
          </div>
        </header>
        <div className="px-5 py-4">
          {topUf.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem dados de localização.</p>
          ) : (
            topUf.map(([uf, v]) => <Bar key={uf} label={uf} value={v} max={maxUf} color="bg-accent" />)
          )}
        </div>
      </div>
    </section>
  );
}
