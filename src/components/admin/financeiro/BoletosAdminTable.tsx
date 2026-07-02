import { useMemo, useState } from "react";
import { ExternalLink, MessageCircle, Search, Copy } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { BoletoAdminRow } from "./hooks";

type FilterKey =
  | "todos"
  | "vence_hoje"
  | "vence_3d"
  | "vence_7d"
  | "vencidos_1_30"
  | "vencidos_31_60"
  | "vencidos_60"
  | "pagos";

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const DAY = 86400000;

function daysFromToday(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso);
  t.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((t.getTime() - today.getTime()) / DAY);
}

/**
 * Tabela de boletos com filtros por vencimento + consultor.
 * Compartilha visual/badge do BoletosList original, mas adiciona coluna
 * "Consultor" e filtros focados em vencimento (para admin).
 */
export function BoletosAdminTable({ rows }: { rows: BoletoAdminRow[] }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<FilterKey>("todos");
  const [consultantId, setConsultantId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(100);

  const consultants = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      if (r.consultant_id) m.set(r.consultant_id, r.consultant_name || "—");
    }
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((b) => {
      if (consultantId !== "all" && b.consultant_id !== consultantId) return false;
      const pago = !!b.pagamento || String(b.status || "").toLowerCase().includes("pago");
      const d = daysFromToday(b.vencimento);
      const atraso = d != null && d < 0 ? Math.abs(d) : 0;
      if (status === "pagos" && !pago) return false;
      if (status !== "pagos" && pago) return false;
      if (status === "vence_hoje" && d !== 0) return false;
      if (status === "vence_3d" && !(d != null && d >= 0 && d <= 3)) return false;
      if (status === "vence_7d" && !(d != null && d >= 0 && d <= 7)) return false;
      if (status === "vencidos_1_30" && !(atraso >= 1 && atraso <= 30)) return false;
      if (status === "vencidos_31_60" && !(atraso >= 31 && atraso <= 60)) return false;
      if (status === "vencidos_60" && !(atraso > 60)) return false;
      if (q) {
        const hay = `${b.nome || b.customer_name || ""} ${b.cidade || ""} ${b.uf || ""} ${b.fornecedora || ""} ${b.consultant_name || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, status, consultantId, search]);

  return (
    <section className="rounded-xl border border-border/60 bg-card">
      <header className="p-4 border-b border-border/60 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-semibold">Boletos</h3>
          <span className="text-[11px] text-muted-foreground">
            {filtered.length.toLocaleString("pt-BR")} de {rows.length.toLocaleString("pt-BR")}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={status === "todos"} onClick={() => setStatus("todos")}>Todos em aberto</Chip>
          <Chip active={status === "vence_hoje"} onClick={() => setStatus("vence_hoje")}>Vence hoje</Chip>
          <Chip active={status === "vence_3d"} onClick={() => setStatus("vence_3d")}>Vence em 3d</Chip>
          <Chip active={status === "vence_7d"} onClick={() => setStatus("vence_7d")}>Vence em 7d</Chip>
          <Chip active={status === "vencidos_1_30"} onClick={() => setStatus("vencidos_1_30")}>Vencidos 1-30d</Chip>
          <Chip active={status === "vencidos_31_60"} onClick={() => setStatus("vencidos_31_60")}>Vencidos 31-60d</Chip>
          <Chip active={status === "vencidos_60"} onClick={() => setStatus("vencidos_60")}>Vencidos +60d</Chip>
          <Chip active={status === "pagos"} onClick={() => setStatus("pagos")}>Pagos</Chip>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente, cidade, consultor, distribuidora…"
              className="pl-9"
            />
          </div>
          {consultants.length > 1 && (
            <select
              value={consultantId}
              onChange={(e) => setConsultantId(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[200px]"
            >
              <option value="all">Todos os consultores ({consultants.length})</option>
              {consultants.map(([id, name]) => (
                <option key={id} value={id}>{name || id.slice(0, 8)}</option>
              ))}
            </select>
          )}
        </div>
      </header>

      <ul className="divide-y divide-border/60">
        {filtered.slice(0, visible).map((b) => {
          const pago = !!b.pagamento;
          const d = daysFromToday(b.vencimento);
          const vencido = d != null && d < 0;
          const venceHoje = d === 0;
          const venceEm7 = d != null && d > 0 && d <= 7;
          return (
            <li key={b.id} className="p-3 hover:bg-muted/30">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium truncate">{b.nome || b.customer_name || "Cliente"}</p>
                    {pago ? (
                      <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px]" variant="outline">Pago</Badge>
                    ) : vencido ? (
                      <Badge className="bg-red-500/10 text-red-600 border-red-500/30 text-[10px]" variant="outline">
                        Vencido · {Math.abs(d!)}d
                      </Badge>
                    ) : venceHoje ? (
                      <Badge className="bg-amber-500/10 text-amber-700 border-amber-500/30 text-[10px]" variant="outline">Vence hoje</Badge>
                    ) : venceEm7 ? (
                      <Badge className="bg-amber-500/10 text-amber-700 border-amber-500/30 text-[10px]" variant="outline">Em {d}d</Badge>
                    ) : (
                      <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/30 text-[10px]" variant="outline">A vencer</Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    <span className="font-medium text-foreground/70">{b.consultant_name || "—"}</span>
                    {" · "}
                    {b.cidade || "?"}/{b.uf || "?"} · {b.fornecedora || "—"} · vence{" "}
                    {b.vencimento ? new Date(b.vencimento).toLocaleDateString("pt-BR") : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-semibold">{BRL(Number(b.total || 0))}</p>
                    <p className="text-[10px] text-muted-foreground">{b.mes_referencia || ""}</p>
                  </div>
                  {b.url_boleto && (
                    <>
                      <a href={b.url_boleto} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]">
                          <ExternalLink className="h-3 w-3 mr-1" /> Boleto
                        </Button>
                      </a>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => {
                          navigator.clipboard.writeText(b.url_boleto!);
                          toast({ title: "Link copiado" });
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                  {b.url_invoice && (
                    <a href={b.url_invoice} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]">
                        <ExternalLink className="h-3 w-3 mr-1" /> NF
                      </Button>
                    </a>
                  )}
                  {b.phone_whatsapp && b.url_boleto && (
                    <a
                      href={`https://wa.me/${b.phone_whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(
                        `Olá! Segue seu boleto de energia (${b.mes_referencia || ""}): ${b.url_boleto}`,
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Button size="sm" className="h-7 px-2 text-[11px]">
                        <MessageCircle className="h-3 w-3 mr-1" /> Cobrar
                      </Button>
                    </a>
                  )}
                </div>
              </div>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="p-6 text-center text-sm text-muted-foreground">Nenhum boleto com esses filtros.</li>
        )}
      </ul>
      {filtered.length > visible && (
        <div className="p-3 text-center border-t border-border/60">
          <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + 100)}>
            Mostrar mais 100 ({filtered.length - visible} restantes)
          </Button>
        </div>
      )}
    </section>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-[11px] font-medium border transition ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background border-border/60 text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
