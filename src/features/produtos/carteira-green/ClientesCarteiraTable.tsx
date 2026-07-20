// =============================================================================
// Tabela unificada de clientes da carteira iGreen (uma linha por cliente).
// Consolida boletos + devolutivas + telecom + seguros. Ao clicar num cliente
// abre o ClienteDetalheDrawer com todo o histórico daquele cliente.
// =============================================================================

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ChevronRight, AlertTriangle, PhoneCall, ShieldCheck, Leaf } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import type { BoletoRow, DevolutivaRow } from "./hooks";
import { norm } from "./searchUtils";
import { ClienteDetalheDrawer, type ClienteAggregate, type TelecomRow, type SeguroRow } from "./ClienteDetalheDrawer";

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type FilterKey = "todos" | "vencidos" | "disponiveis" | "pagos" | "devolutiva";

function normPhone(p?: string | null): string {
  return (p || "").replace(/\D/g, "");
}

export function ClientesCarteiraTable({
  consultantId,
  igreenAccountId = null,
  boletos,
  devolutivas,
}: {
  consultantId: string;
  igreenAccountId?: string | null;
  boletos: BoletoRow[];
  devolutivas: DevolutivaRow[];
}) {
  const [filter, setFilter] = useState<FilterKey>("todos");
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Telecom & Seguros (dados da conta selecionada — sem misturar)
  const { data: telecom = [] } = useQuery({
    queryKey: ["ct-telecom", consultantId, igreenAccountId ?? "all"],
    enabled: !!consultantId,
    staleTime: 60_000,
    queryFn: async (): Promise<TelecomRow[]> => {
      let q = supabase
        .from("igreen_telecom_customers" as never)
        .select("*")
        .eq("consultant_id", consultantId)
        .limit(2000);
      if (igreenAccountId) q = q.eq("igreen_account_id" as never, igreenAccountId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as TelecomRow[];
    },
  });

  const { data: seguros = [] } = useQuery({
    queryKey: ["ct-seguros", consultantId, igreenAccountId ?? "all"],
    enabled: !!consultantId,
    staleTime: 60_000,
    queryFn: async (): Promise<SeguroRow[]> => {
      let q = supabase
        .from("igreen_seguros_customers" as never)
        .select("*")
        .eq("consultant_id", consultantId)
        .limit(2000);
      if (igreenAccountId) q = q.eq("igreen_account_id" as never, igreenAccountId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as SeguroRow[];
    },
  });

  // Agrupar tudo por cliente (chave preferencial: idcliente; fallback: nome+cidade)
  const clientes = useMemo(() => {
    const map = new Map<string, ClienteAggregate>();

    const keyFromBoleto = (b: BoletoRow) =>
      b.idcliente ? `ic:${b.idcliente}` : `nm:${norm(b.nome || b.customer_name || "")}|${norm(b.cidade || "")}`;

    for (const b of boletos) {
      const k = keyFromBoleto(b);
      const cur = map.get(k) || {
        key: k,
        idcliente: b.idcliente ?? null,
        nome: b.nome || b.customer_name || "Cliente",
        cidade: b.cidade,
        uf: b.uf,
        fornecedora: b.fornecedora,
        phone: b.phone_whatsapp,
        boletos: [],
        devolutivas: [],
        telecom: [],
        seguros: [],
      };
      cur.boletos.push(b);
      if (!cur.phone && b.phone_whatsapp) cur.phone = b.phone_whatsapp;
      if (!cur.fornecedora && b.fornecedora) cur.fornecedora = b.fornecedora;
      map.set(k, cur);
    }

    // Devolutivas — casar por iddevolutiva → não temos, então por nome+cidade
    for (const d of devolutivas) {
      const matchKey = `nm:${norm(d.nome || "")}|${norm(d.cidade || "")}`;
      let target: ClienteAggregate | undefined;
      // tenta bater com um cliente existente por nome normalizado
      for (const [k, v] of map) {
        if (k === matchKey || norm(v.nome) === norm(d.nome || "")) {
          target = v;
          break;
        }
      }
      if (!target) {
        target = {
          key: matchKey,
          idcliente: null,
          nome: d.nome || "Cliente",
          cidade: d.cidade,
          uf: d.uf,
          fornecedora: null,
          phone: null,
          boletos: [],
          devolutivas: [],
          telecom: [],
          seguros: [],
        };
        map.set(matchKey, target);
      }
      target.devolutivas.push(d);
    }

    // Telecom por telefone/nome
    for (const t of telecom) {
      const numeroDigits = normPhone(t.numero);
      let matched = false;
      for (const v of map.values()) {
        if (normPhone(v.phone) && normPhone(v.phone).endsWith(numeroDigits.slice(-8)) && numeroDigits.length >= 8) {
          v.telecom.push(t); matched = true; break;
        }
        if (t.nome && norm(v.nome) === norm(t.nome)) {
          v.telecom.push(t); matched = true; break;
        }
      }
      if (!matched && t.nome) {
        const k = `nm:${norm(t.nome)}|`;
        map.set(k, {
          key: k, idcliente: null, nome: t.nome, cidade: null, uf: null, fornecedora: null, phone: null,
          boletos: [], devolutivas: [], telecom: [t], seguros: [],
        });
      }
    }

    // Seguros por nome
    for (const s of seguros) {
      let matched = false;
      for (const v of map.values()) {
        if (s.segurado && norm(v.nome) === norm(s.segurado)) {
          v.seguros.push(s); matched = true; break;
        }
      }
      if (!matched && s.segurado) {
        const k = `nm:${norm(s.segurado)}|`;
        map.set(k, {
          key: k, idcliente: null, nome: s.segurado, cidade: null, uf: null, fornecedora: null, phone: null,
          boletos: [], devolutivas: [], telecom: [], seguros: [s],
        });
      }
    }

    // ordenar boletos internos por vencimento desc
    for (const v of map.values()) {
      v.boletos.sort((a, b) => (b.vencimento || "").localeCompare(a.vencimento || ""));
    }

    return Array.from(map.values());
  }, [boletos, devolutivas, telecom, seguros]);

  const filtered = useMemo(() => {
    const q = norm(search.trim());
    return clientes.filter((c) => {
      // filtro
      const abertos = c.boletos.filter((b) => !b.pagamento && !String(b.status || "").toLowerCase().includes("pago"));
      const vencidos = abertos.filter((b) => (b.dias_atraso ?? 0) > 0);
      const pagos = c.boletos.filter((b) => !!b.pagamento);
      const devAbertas = c.devolutivas.filter((d) => !d.resolvida_em);

      if (filter === "vencidos" && vencidos.length === 0) return false;
      if (filter === "disponiveis" && (vencidos.length > 0 || abertos.length - vencidos.length === 0)) return false;
      if (filter === "pagos" && pagos.length === 0) return false;
      if (filter === "devolutiva" && devAbertas.length === 0) return false;

      if (q) {
        const hay = norm(`${c.nome} ${c.cidade || ""} ${c.uf || ""} ${c.fornecedora || ""}`);
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [clientes, filter, search]);

  const selected = useMemo(
    () => clientes.find((c) => c.key === selectedKey) || null,
    [clientes, selectedKey],
  );

  return (
    <section className="rounded-2xl border border-border/60 bg-card overflow-hidden">
      <header className="p-4 sm:p-5 border-b border-border/60 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="font-display text-base font-semibold text-foreground">Clientes</h3>
            <p className="text-[11px] text-muted-foreground">
              Toque num cliente para ver boletos, devolutivas e histórico.
            </p>
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {filtered.length.toLocaleString("pt-BR")} de {clientes.length.toLocaleString("pt-BR")}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Chip active={filter === "todos"} onClick={() => setFilter("todos")}>Todos</Chip>
          <Chip active={filter === "vencidos"} onClick={() => setFilter("vencidos")}>Com vencidos</Chip>
          <Chip active={filter === "disponiveis"} onClick={() => setFilter("disponiveis")}>A vencer</Chip>
          <Chip active={filter === "pagos"} onClick={() => setFilter("pagos")}>Pagos</Chip>
          <Chip active={filter === "devolutiva"} onClick={() => setFilter("devolutiva")}>Com devolutiva</Chip>
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

      <ul className="divide-y divide-border/60 max-h-[70vh] overflow-y-auto">
        {filtered.length === 0 ? (
          <li className="p-8 text-center text-sm text-muted-foreground">
            Nenhum cliente com esses filtros.
          </li>
        ) : (
          filtered.map((c) => {
            const abertos = c.boletos.filter((b) => !b.pagamento && !String(b.status || "").toLowerCase().includes("pago"));
            const vencidos = abertos.filter((b) => (b.dias_atraso ?? 0) > 0);
            const valorAberto = abertos.reduce((s, b) => s + Number(b.total || 0), 0);
            const devAbertas = c.devolutivas.filter((d) => !d.resolvida_em);
            const injecao = c.boletos.some((b) => !!b.injecao);

            const statusBadge =
              vencidos.length > 0 ? (
                <Badge className="bg-red-500/10 text-red-600 border-red-500/30 text-[10px]" variant="outline">
                  {vencidos.length} vencido{vencidos.length > 1 ? "s" : ""}
                </Badge>
              ) : abertos.length > 0 ? (
                <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/30 text-[10px]" variant="outline">
                  {abertos.length} a vencer
                </Badge>
              ) : c.boletos.length > 0 ? (
                <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px]" variant="outline">
                  Em dia
                </Badge>
              ) : null;

            return (
              <li key={c.key}>
                <button
                  type="button"
                  onClick={() => setSelectedKey(c.key)}
                  className="w-full text-left p-3 sm:p-4 hover:bg-muted/40 transition-colors flex items-center gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate">{c.nome}</p>
                      {statusBadge}
                      {devAbertas.length > 0 && (
                        <Badge className="bg-amber-500/10 text-amber-700 border-amber-500/30 text-[10px]" variant="outline">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          {devAbertas.length} devolutiva{devAbertas.length > 1 ? "s" : ""}
                        </Badge>
                      )}
                      {injecao && (
                        <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-500/30">
                          <Leaf className="h-3 w-3 mr-1" /> Injeção
                        </Badge>
                      )}
                      {c.telecom.length > 0 && (
                        <Badge variant="outline" className="text-[10px]">
                          <PhoneCall className="h-3 w-3 mr-1" />{c.telecom.length}
                        </Badge>
                      )}
                      {c.seguros.length > 0 && (
                        <Badge variant="outline" className="text-[10px]">
                          <ShieldCheck className="h-3 w-3 mr-1" />{c.seguros.length}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {c.cidade || "?"}/{c.uf || "?"}
                      {c.fornecedora ? ` · ${c.fornecedora}` : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {valorAberto > 0 && (
                      <p className="text-sm font-semibold tabular-nums">{BRL(valorAberto)}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground">
                      {c.boletos.length} boleto{c.boletos.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              </li>
            );
          })
        )}
      </ul>

      <ClienteDetalheDrawer
        cliente={selected}
        open={!!selected}
        onOpenChange={(v) => !v && setSelectedKey(null)}
      />
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
