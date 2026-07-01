import { useMemo, useState } from "react";
import { ExternalLink, MessageCircle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BoletoRow } from "./hooks";
import { scoreIntent, INTENT_LABEL, INTENT_STYLE, INTENT_ACTION, type IntentLevel } from "./intent";

type FilterKey =
  | "todos"
  | "vencidos_1_30"
  | "vencidos_31_60"
  | "vencidos_60"
  | "disponiveis"
  | "pagos";
type InjecaoKey = "todos" | "com" | "sem";
type ContaKey = "todas" | "unica" | "duplo";

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function BoletosList({ boletos }: { boletos: BoletoRow[] }) {
  const [status, setStatus] = useState<FilterKey>("todos");
  const [injecao, setInjecao] = useState<InjecaoKey>("todos");
  const [conta, setConta] = useState<ContaKey>("todas");
  const [search, setSearch] = useState("");

  const historyByCliente = useMemo(() => {
    const map = new Map<number | string, BoletoRow[]>();
    for (const b of boletos) {
      const k = b.idcliente ?? b.id;
      const arr = map.get(k) || [];
      arr.push(b);
      map.set(k, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (b.vencimento || "").localeCompare(a.vencimento || ""));
    }
    return map;
  }, [boletos]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return boletos.filter((b) => {
      // status
      const pago = !!b.pagamento || String(b.status || "").toLowerCase().includes("pago");
      const atraso = b.dias_atraso ?? 0;
      const vencido = atraso > 0 || String(b.status || "").toLowerCase().includes("vencid");
      if (status === "pagos" && !pago) return false;
      if (status === "disponiveis" && (pago || vencido)) return false;
      if (status === "vencidos_1_30" && !(vencido && atraso >= 1 && atraso <= 30)) return false;
      if (status === "vencidos_31_60" && !(vencido && atraso >= 31 && atraso <= 60)) return false;
      if (status === "vencidos_60" && !(vencido && atraso > 60)) return false;

      if (injecao === "com" && !b.injecao) return false;
      if (injecao === "sem" && b.injecao) return false;

      if (conta === "unica" && b.conta_unica !== true) return false;
      if (conta === "duplo" && b.conta_unica === true) return false;

      if (q) {
        const hay = `${b.nome || b.customer_name || ""} ${b.cidade || ""} ${b.uf || ""} ${b.fornecedora || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [boletos, status, injecao, conta, search]);

  return (
    <section className="rounded-xl border border-border/60 bg-card">
      <header className="p-4 border-b border-border/60 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-semibold">Boletos por cliente</h3>
          <span className="text-[11px] text-muted-foreground">
            {filtered.length.toLocaleString("pt-BR")} de {boletos.length.toLocaleString("pt-BR")}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={status === "todos"} onClick={() => setStatus("todos")}>Todos</Chip>
          <Chip active={status === "vencidos_1_30"} onClick={() => setStatus("vencidos_1_30")}>Vencidos 1-30d</Chip>
          <Chip active={status === "vencidos_31_60"} onClick={() => setStatus("vencidos_31_60")}>Vencidos 31-60d</Chip>
          <Chip active={status === "vencidos_60"} onClick={() => setStatus("vencidos_60")}>Vencidos +60d</Chip>
          <Chip active={status === "disponiveis"} onClick={() => setStatus("disponiveis")}>Disponíveis</Chip>
          <Chip active={status === "pagos"} onClick={() => setStatus("pagos")}>Pagos</Chip>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={injecao === "todos"} onClick={() => setInjecao("todos")}>Injeção: todos</Chip>
          <Chip active={injecao === "com"} onClick={() => setInjecao("com")}>Com injeção</Chip>
          <Chip active={injecao === "sem"} onClick={() => setInjecao("sem")}>Sem injeção</Chip>
          <span className="w-px bg-border/60 mx-1" />
          <Chip active={conta === "todas"} onClick={() => setConta("todas")}>Conta: todas</Chip>
          <Chip active={conta === "unica"} onClick={() => setConta("unica")}>Única</Chip>
          <Chip active={conta === "duplo"} onClick={() => setConta("duplo")}>Duplo</Chip>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente, cidade, distribuidora…"
            className="pl-9"
          />
        </div>
      </header>

      <ul className="divide-y divide-border/60 max-h-[600px] overflow-y-auto">
        {filtered.slice(0, 300).map((b) => {
          const history = historyByCliente.get(b.idcliente ?? b.id) || [];
          const intent: IntentLevel = scoreIntent(b, history);
          const pago = !!b.pagamento;
          const vencido = (b.dias_atraso ?? 0) > 0;
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
                        Vencido · {b.dias_atraso}d
                      </Badge>
                    ) : (
                      <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/30 text-[10px]" variant="outline">A vencer</Badge>
                    )}
                    {b.injecao ? (
                      <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-500/30">Com injeção</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-500/30">Sem injeção</Badge>
                    )}
                    {b.conta_unica ? (
                      <Badge variant="outline" className="text-[10px]">Única</Badge>
                    ) : null}
                    {!pago && (
                      <Badge variant="outline" className={`text-[10px] ${INTENT_STYLE[intent]}`}>
                        {INTENT_LABEL[intent]}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {b.cidade || "?"}/{b.uf || "?"} · {b.fornecedora || "—"} · vence{" "}
                    {b.vencimento ? new Date(b.vencimento).toLocaleDateString("pt-BR") : "—"}
                  </p>
                  {(b.valor_fornecedora || b.valor_distribuidora || b.tipo_pagamento) && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {b.valor_fornecedora ? <>Fornecedora: <strong>{BRL(Number(b.valor_fornecedora))}</strong> · </> : null}
                      {b.valor_distribuidora ? <>Distribuidora: <strong>{BRL(Number(b.valor_distribuidora))}</strong> · </> : null}
                      {b.tipo_pagamento ? <>Pgto: {b.tipo_pagamento}</> : null}
                    </p>
                  )}
                  {!pago && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 italic">
                      Sugestão: {INTENT_ACTION[intent]}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-semibold">{BRL(Number(b.total || 0))}</p>
                    <p className="text-[10px] text-muted-foreground">{b.mes_referencia || ""}</p>
                  </div>
                  {b.url_boleto && (
                    <a href={b.url_boleto} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]">
                        <ExternalLink className="h-3 w-3 mr-1" /> Boleto
                      </Button>
                    </a>
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
                        <MessageCircle className="h-3 w-3 mr-1" /> Enviar
                      </Button>
                    </a>
                  )}
                </div>

              </div>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="p-6 text-center text-sm text-muted-foreground">
            Nenhum boleto com esses filtros.
          </li>
        )}
      </ul>
      {filtered.length > 300 && (
        <p className="p-2 text-[10px] text-center text-muted-foreground border-t border-border/60">
          Mostrando 300 primeiros — refine os filtros para ver o restante.
        </p>
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
