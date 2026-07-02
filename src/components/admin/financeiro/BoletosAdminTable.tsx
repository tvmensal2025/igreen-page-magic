import { useMemo, useState } from "react";
import { ExternalLink, MessageCircle, Search, Copy, Download, ArrowUp, ArrowDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import type { BoletoAdminRow } from "./hooks";
import {
  useUltimaCobrancaMap,
  useBoletoCobrancaTemplate,
  FALLBACK_COBRANCA_TEMPLATE,
  renderCobrancaTemplate,
} from "./hooks";
import { exportBoletosCsv } from "./csvExport";
import { CobrarBulkDialog } from "./CobrarBulkDialog";
import { supabase } from "@/integrations/supabase/client";

type FilterKey =
  | "todos"
  | "vence_hoje"
  | "vence_3d"
  | "vence_7d"
  | "vencidos_1_30"
  | "vencidos_31_60"
  | "vencidos_60"
  | "pagos";

type SortKey = "vencimento" | "valor" | "cliente" | "consultor" | "atraso";

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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / DAY);
  if (d < 1) return "hoje";
  if (d === 1) return "1d";
  if (d < 30) return `${d}d`;
  const m = Math.floor(d / 30);
  return m === 1 ? "1 mês" : `${m} meses`;
}

/**
 * Tabela de boletos com filtros, ordenação, seleção em lote, template
 * configurável, coluna "Última cobrança" e export CSV.
 */
export function BoletosAdminTable({ rows, currentUserId }: { rows: BoletoAdminRow[]; currentUserId: string }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<FilterKey>("todos");
  const [consultantId, setConsultantId] = useState<string>("all");
  const [mesRef, setMesRef] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(100);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("vencimento");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [bulkOpen, setBulkOpen] = useState(false);

  const { data: template } = useBoletoCobrancaTemplate();
  const activeTemplate = template || FALLBACK_COBRANCA_TEMPLATE;

  const customerIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.customer_id).filter(Boolean) as string[])),
    [rows],
  );
  const { data: ultimaCobrancaMap = {} } = useUltimaCobrancaMap(customerIds);

  const consultants = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      if (r.consultant_id) m.set(r.consultant_id, r.consultant_name || "—");
    }
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const mesesRef = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.mes_referencia) s.add(r.mes_referencia);
    return Array.from(s).sort().reverse().slice(0, 12);
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((b) => {
      if (consultantId !== "all" && b.consultant_id !== consultantId) return false;
      if (mesRef !== "all" && b.mes_referencia !== mesRef) return false;
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

    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      switch (sortKey) {
        case "valor":
          return (Number(a.total || 0) - Number(b.total || 0)) * dir;
        case "cliente":
          return (a.nome || a.customer_name || "").localeCompare(b.nome || b.customer_name || "") * dir;
        case "consultor":
          return (a.consultant_name || "").localeCompare(b.consultant_name || "") * dir;
        case "atraso": {
          const da = daysFromToday(a.vencimento) ?? 0;
          const db = daysFromToday(b.vencimento) ?? 0;
          return (da - db) * dir;
        }
        case "vencimento":
        default:
          return (
            (new Date(a.vencimento || 0).getTime() - new Date(b.vencimento || 0).getTime()) * dir
          );
      }
    });
    return list;
  }, [rows, status, consultantId, mesRef, search, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "vencimento" || k === "valor" ? "desc" : "asc");
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = filtered.slice(0, visible).every((r) => selected.has(r.id)) && filtered.length > 0;
  const toggleSelectAllVisible = () => {
    const visibleIds = filtered.slice(0, visible).map((r) => r.id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const alvosBulk = useMemo(
    () => filtered.filter((r) => selected.has(r.id) && r.phone_whatsapp && r.url_boleto),
    [filtered, selected],
  );

  const openBulk = () => {
    if (alvosBulk.length === 0) {
      toast({ title: "Nenhum selecionado com WhatsApp + boleto", variant: "destructive" });
      return;
    }
    setBulkOpen(true);
  };

  const confirmBulk = async () => {
    for (const b of alvosBulk) {
      const text = renderCobrancaTemplate(activeTemplate, {
        nome: b.nome || b.customer_name,
        mes: b.mes_referencia,
        valor: Number(b.total || 0),
        vencimento: b.vencimento,
        url_boleto: b.url_boleto,
      });
      const url = `https://wa.me/${b.phone_whatsapp!.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
      window.open(url, "_blank", "noopener");
    }
    await logCobrancas(alvosBulk, currentUserId);
    toast({ title: `${alvosBulk.length} conversa(s) aberta(s)` });
    setBulkOpen(false);
    setSelected(new Set());
  };

  const sendSingle = async (b: BoletoAdminRow) => {
    if (!b.phone_whatsapp || !b.url_boleto) return;
    const text = renderCobrancaTemplate(activeTemplate, {
      nome: b.nome || b.customer_name,
      mes: b.mes_referencia,
      valor: Number(b.total || 0),
      vencimento: b.vencimento,
      url_boleto: b.url_boleto,
    });
    window.open(
      `https://wa.me/${b.phone_whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener",
    );
    await logCobrancas([b], currentUserId);
  };

  return (
    <section className="rounded-xl border border-border/60 bg-card">
      <header className="p-4 border-b border-border/60 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-semibold">Boletos</h3>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {filtered.length.toLocaleString("pt-BR")} de {rows.length.toLocaleString("pt-BR")}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={() => exportBoletosCsv(filtered, `boletos-${new Date().toISOString().slice(0, 10)}.csv`)}
              disabled={filtered.length === 0}
            >
              <Download className="h-3 w-3 mr-1" /> CSV
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filtro de status">
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
          {mesesRef.length > 0 && (
            <select
              value={mesRef}
              onChange={(e) => setMesRef(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[140px]"
              aria-label="Filtrar por mês"
            >
              <option value="all">Todos os meses</option>
              {mesesRef.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
          {consultants.length > 1 && (
            <select
              value={consultantId}
              onChange={(e) => setConsultantId(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[200px]"
              aria-label="Filtrar por consultor"
            >
              <option value="all">Todos os consultores ({consultants.length})</option>
              {consultants.map(([id, name]) => (
                <option key={id} value={id}>{name || id.slice(0, 8)}</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>Ordenar:</span>
          <SortBtn active={sortKey === "vencimento"} dir={sortDir} onClick={() => toggleSort("vencimento")}>Vencimento</SortBtn>
          <SortBtn active={sortKey === "valor"} dir={sortDir} onClick={() => toggleSort("valor")}>Valor</SortBtn>
          <SortBtn active={sortKey === "atraso"} dir={sortDir} onClick={() => toggleSort("atraso")}>Dias atraso</SortBtn>
          <SortBtn active={sortKey === "cliente"} dir={sortDir} onClick={() => toggleSort("cliente")}>Cliente</SortBtn>
          <SortBtn active={sortKey === "consultor"} dir={sortDir} onClick={() => toggleSort("consultor")}>Consultor</SortBtn>
          {!template && (
            <span className="ml-auto text-amber-700">
              Usando template padrão · crie um atalho <code className="bg-muted px-1 rounded">boleto_cobranca</code> em Templates para personalizar.
            </span>
          )}
        </div>

        {selected.size > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
            <span className="text-xs">
              <strong>{selected.size}</strong> selecionado(s) · <strong>{alvosBulk.length}</strong> com WhatsApp
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-7" onClick={() => setSelected(new Set())}>
                Limpar
              </Button>
              <Button size="sm" className="h-7" onClick={openBulk} disabled={alvosBulk.length === 0}>
                <MessageCircle className="w-3 h-3 mr-1" /> Cobrar selecionados
              </Button>
            </div>
          </div>
        )}
      </header>

      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/60 bg-muted/20">
        <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAllVisible} aria-label="Selecionar todos" />
        <span className="text-[11px] text-muted-foreground">Selecionar todos visíveis</span>
      </div>

      <ul className="divide-y divide-border/60">
        {filtered.slice(0, visible).map((b) => {
          const pago = !!b.pagamento;
          const d = daysFromToday(b.vencimento);
          const vencido = d != null && d < 0;
          const venceHoje = d === 0;
          const venceEm7 = d != null && d > 0 && d <= 7;
          const isSel = selected.has(b.id);
          const ultima = b.customer_id ? ultimaCobrancaMap[b.customer_id] : null;
          return (
            <li key={b.id} className={`p-3 hover:bg-muted/30 ${isSel ? "bg-primary/5" : ""}`}>
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={isSel}
                  onCheckedChange={() => toggleSelect(b.id)}
                  aria-label="Selecionar boleto"
                  className="mt-1"
                />
                <div className="flex items-start justify-between gap-3 flex-wrap flex-1">
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
                      {ultima && (
                        <Badge variant="outline" className="text-[10px] bg-muted/40">
                          Cobrado há {timeAgo(ultima)}
                        </Badge>
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
                      <Button size="sm" className="h-7 px-2 text-[11px]" onClick={() => sendSingle(b)}>
                        <MessageCircle className="h-3 w-3 mr-1" /> Cobrar
                      </Button>
                    )}
                  </div>
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

      <CobrarBulkDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        alvos={alvosBulk}
        template={activeTemplate}
        onConfirm={confirmBulk}
      />
    </section>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
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

function SortBtn({ active, dir, onClick, children }: { active: boolean; dir: "asc" | "desc"; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md border text-[11px] transition ${
        active ? "border-primary text-foreground bg-primary/5" : "border-transparent hover:text-foreground"
      }`}
    >
      {children}
      {active && (dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
    </button>
  );
}

/**
 * Registra cada cobrança no `customer_auto_message_log` com `stage_key='boleto_cobranca'`
 * para alimentar a coluna "Última cobrança". Falha silenciosamente — não bloqueia UX.
 */
async function logCobrancas(alvos: BoletoAdminRow[], consultantId: string) {
  const rows = alvos
    .filter((b) => b.customer_id)
    .map((b) => ({
      customer_id: b.customer_id as string,
      consultant_id: consultantId,
      stage_key: "boleto_cobranca",
      remote_jid: b.phone_whatsapp ? `${b.phone_whatsapp.replace(/\D/g, "")}@s.whatsapp.net` : null,
      customer_name: b.nome || b.customer_name || null,
      message_preview: `Cobrança boleto ${b.mes_referencia || ""}`.slice(0, 200),
      status: "sent",
    }));
  if (rows.length === 0) return;
  try {
    await supabase.from("customer_auto_message_log").insert(rows);
  } catch {
    // silencioso
  }
}
