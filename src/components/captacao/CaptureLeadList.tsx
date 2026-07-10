import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, UserPlus, RefreshCw, CheckSquare, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CAPTURE_FIELDS } from "@/hooks/useCaptureSession";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { toast } from "sonner";

export type CapturePeriodKey = "48h" | "7d" | "30d" | "60d" | "90d" | "all";

export interface CaptureBatchLead {
  id: string;
  name: string | null;
  phone_whatsapp: string | null;
  capture_started_at: string | null;
  created_at: string;
  welcome_sent_at: string | null;
  filled: number;
  lastMsg?: string | null;
  lastMsgAt?: string | null;
}

interface Props {
  consultantId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  gameOn?: boolean;
  whatsappConnected?: boolean;
  onOpenBatch?: (leads: CaptureBatchLead[], periodLabel: string) => void;
}

const PERIOD_OPTIONS: { key: CapturePeriodKey; label: string; ms: number | null }[] = [
  { key: "48h", label: "48h", ms: 48 * 60 * 60 * 1000 },
  { key: "7d", label: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", label: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "60d", label: "60d", ms: 60 * 24 * 60 * 60 * 1000 },
  { key: "90d", label: "90d", ms: 90 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "Todos", ms: null },
];

export function periodLabelOf(key: CapturePeriodKey): string {
  if (key === "48h") return "últimas 48h";
  if (key === "all") return "todos os períodos";
  const opt = PERIOD_OPTIONS.find((o) => o.key === key);
  return opt ? `últimos ${opt.label}` : key;
}

const AVATAR_TONES = [
  "bg-primary/15 text-primary",
  "bg-info/15 text-info",
  "bg-warning/15 text-warning",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
];
function toneFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}
function initialsFrom(name: string | null, phone: string | null) {
  const src = (name || "").trim();
  if (src) {
    const parts = src.split(/\s+/);
    return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
  }
  return (phone || "?").replace(/\D/g, "").slice(-2) || "?";
}

function leadAnchor(l: CaptureBatchLead): number {
  const iso = l.capture_started_at || l.created_at;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

async function fetchLastMessagesByCustomer(
  ids: string[],
): Promise<Map<string, { text: string; at: string }>> {
  const lastByCustomer = new Map<string, { text: string; at: string }>();
  const CHUNK = 80;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data: msgs } = await supabase
      .from("conversations")
      .select("customer_id, message_text, message_type, created_at")
      .in("customer_id", slice)
      .order("created_at", { ascending: false })
      .limit(Math.min(400, slice.length * 3));
    for (const m of (msgs as any[]) || []) {
      if (!lastByCustomer.has(m.customer_id)) {
        const t = m.message_text || `[${m.message_type || "mídia"}]`;
        lastByCustomer.set(m.customer_id, { text: t, at: m.created_at });
      }
    }
  }
  return lastByCustomer;
}

export function CaptureLeadList({
  consultantId,
  selectedId,
  onSelect,
  whatsappConnected = false,
  onOpenBatch,
}: Props) {
  const prompt = usePrompt();
  const [leads, setLeads] = useState<CaptureBatchLead[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState<CapturePeriodKey>("60d");
  const loadSeqRef = useRef(0);

  const load = async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const cols =
        "id, name, phone_whatsapp, capture_started_at, created_at, welcome_sent_at, " +
        CAPTURE_FIELDS.map((f) => f.key).join(", ");
      const { data, error } = await supabase
        .from("customers")
        .select(cols)
        .eq("consultant_id", consultantId)
        .eq("capture_mode", "manual")
        .is("capture_closed_at", null)
        .order("created_at", { ascending: false })
        .limit(400);
      if (seq !== loadSeqRef.current) return;
      if (error) {
        toast.error("Falha ao carregar conversas");
        setLeads([]);
        setLoading(false);
        return;
      }
      const rows: CaptureBatchLead[] = (data || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        phone_whatsapp: c.phone_whatsapp,
        capture_started_at: c.capture_started_at,
        created_at: c.created_at,
        welcome_sent_at: c.welcome_sent_at ?? null,
        filled: CAPTURE_FIELDS.filter((f) => {
          const v = c[f.key];
          if (v === null || v === undefined) return false;
          if (typeof v === "string" && !v.trim()) return false;
          if (f.key === "electricity_bill_value" && Number(v) <= 0) return false;
          return true;
        }).length,
      }));
      setLeads(rows);
      setLoading(false);

      const ids = rows.map((r) => r.id);
      if (ids.length === 0) return;
      const lastByCustomer = await fetchLastMessagesByCustomer(ids);
      if (seq !== loadSeqRef.current) return;
      setLeads((prev) =>
        prev.map((r) => {
          const last = lastByCustomer.get(r.id);
          return last ? { ...r, lastMsg: last.text, lastMsgAt: last.at } : r;
        }),
      );
    } catch {
      if (seq !== loadSeqRef.current) return;
      toast.error("Falha ao carregar conversas");
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [consultantId]);

  useEffect(() => {
    const onBatchDone = () => void load();
    window.addEventListener("captacao:batch-finished", onBatchDone);
    return () => window.removeEventListener("captacao:batch-finished", onBatchDone);
  }, [consultantId]);

  useEffect(() => {
    const ch = supabase
      .channel(`capture-list-${consultantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "customers", filter: `consultant_id=eq.${consultantId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [consultantId]);

  const periodMs = PERIOD_OPTIONS.find((o) => o.key === period)?.ms ?? null;

  const filtered = useMemo(() => {
    const now = Date.now();
    return leads.filter((l) => {
      if (periodMs != null) {
        const anchor = leadAnchor(l);
        if (!anchor || now - anchor > periodMs) return false;
      }
      if (!q) return true;
      const s = q.toLowerCase();
      return (l.name || "").toLowerCase().includes(s) || (l.phone_whatsapp || "").includes(s);
    });
  }, [leads, q, periodMs]);

  const filteredIds = useMemo(() => new Set(filtered.map((l) => l.id)), [filtered]);

  // Remove da seleção quem saiu do filtro/período (evita CTA com IDs invisíveis).
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (filteredIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [filteredIds]);

  const selectedVisibleCount = useMemo(() => {
    let n = 0;
    for (const id of selectedIds) if (filteredIds.has(id)) n++;
    return n;
  }, [selectedIds, filteredIds]);

  const fmtTime = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "agora";
    if (mins < 60) return `${mins}m`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h`;
    return `${Math.floor(mins / 1440)}d`;
  };

  const fmtPhone = (p: string | null) => {
    if (!p) return "—";
    if (/sem_celular/i.test(p)) return "Sem telefone";
    const d = p.replace(/\D/g, "");
    return d.length >= 12 ? `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}` : p;
  };

  const toggleSelectMode = () => {
    setSelectMode((v) => {
      if (v) {
        setSelectedIds(new Set());
        return false;
      }
      // Ao entrar em modo seleção: já marca todos do período pra dar feedback visível.
      setSelectedIds(new Set(filtered.map((l) => l.id)));
      return true;
    });
  };


  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedIds(new Set(filtered.map((l) => l.id)));
  };

  const selectWithoutAttendance = () => {
    setSelectedIds(new Set(filtered.filter((l) => !l.welcome_sent_at).map((l) => l.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const openBatch = () => {
    if (!onOpenBatch) return;
    if (!whatsappConnected) {
      toast.error("WhatsApp desconectado — reconecte para abrir em lote");
      return;
    }
    const picked = filtered.filter((l) => selectedIds.has(l.id));
    if (picked.length === 0) {
      toast.error("Selecione pelo menos um cliente");
      return;
    }
    onOpenBatch(picked, periodLabelOf(period));
  };

  return (
    <aside className="w-full md:w-auto md:shrink-0 flex flex-col flex-1 h-full border-b md:border-b-0 md:border-r border-border bg-card/40 min-h-0 overflow-hidden">
      <div className="p-2.5 border-b border-border space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-sm font-semibold">Conversas</h3>
            <span className="text-xs tabular-nums font-medium text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full">
              {filtered.length}
            </span>
          </div>
          <Button
            size="sm"
            variant={selectMode ? "secondary" : "outline"}
            className="h-7 px-2 text-[11px] gap-1 shrink-0"
            onClick={toggleSelectMode}
          >
            {selectMode ? (
              <>
                <X className="w-3 h-3" /> Cancelar
              </>
            ) : (
              <>
                <CheckSquare className="w-3 h-3" /> Selecionar
              </>
            )}
          </Button>
        </div>

        <div className="flex flex-wrap gap-1">
          {PERIOD_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setPeriod(o.key)}
              className={`px-2 py-0.5 text-[10px] font-semibold rounded-md transition ${
                period === o.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {selectMode && (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className="text-[10px] font-medium text-primary hover:underline"
              onClick={selectAllFiltered}
            >
              Todos do período
            </button>
            <span className="text-[10px] text-muted-foreground">·</span>
            <button
              type="button"
              className="text-[10px] font-medium text-primary hover:underline"
              onClick={selectWithoutAttendance}
            >
              Só sem atendimento
            </button>
            <span className="text-[10px] text-muted-foreground">·</span>
            <button
              type="button"
              className="text-[10px] font-medium text-muted-foreground hover:underline"
              onClick={clearSelection}
            >
              Limpar
            </button>
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar nome ou telefone"
            className="h-9 pl-8 text-xs rounded-lg"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <p className="p-6 text-center text-xs text-muted-foreground">Carregando...</p>}
        {!loading && filtered.length === 0 && (
          <div className="p-6 text-center space-y-2">
            <UserPlus className="w-8 h-8 mx-auto text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              Nenhum cliente neste período.
              <br />
              Abra um cliente no WhatsApp e clique em &quot;Capturar dados&quot;.
            </p>
          </div>
        )}
        <ul className="divide-y divide-border/60">
          {filtered.map((l) => {
            const active = l.id === selectedId && !selectMode;
            const pct = Math.round((l.filled / CAPTURE_FIELDS.length) * 100);
            const ready = l.filled >= CAPTURE_FIELDS.length;
            const checked = selectedIds.has(l.id);
            return (
              <li key={l.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (selectMode) toggleId(l.id);
                    else onSelect(l.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (selectMode) toggleId(l.id);
                      else onSelect(l.id);
                    }
                  }}
                  className={`w-full text-left px-2.5 py-2.5 flex gap-2.5 transition-colors cursor-pointer ${
                    selectMode && checked
                      ? "bg-primary/10 border-l-2 border-primary"
                      : active
                        ? "bg-primary/10 border-l-2 border-primary"
                        : "border-l-2 border-transparent hover:bg-secondary/50"
                  }`}
                >
                  {selectMode && (
                    <div
                      className="shrink-0 pt-2.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleId(l.id);
                      }}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleId(l.id)}
                        aria-label={`Selecionar ${l.name || l.id}`}
                      />
                    </div>
                  )}
                  <div
                    className={`relative shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold ${toneFor(l.id)}`}
                  >
                    {initialsFrom(l.name, l.phone_whatsapp)}
                    {ready && (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary border-2 border-card"
                        title="Cadastro completo"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground sensitive-name">
                        {l.name || "Sem nome"}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                        {fmtTime(l.lastMsgAt || l.created_at)}
                      </span>
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground mt-0.5 sensitive-phone">
                      {l.lastMsg ? l.lastMsg : fmtPhone(l.phone_whatsapp)}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${ready ? "bg-primary" : "bg-primary/60"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span
                        className={`text-[10px] tabular-nums font-medium shrink-0 ${ready ? "text-primary" : "text-muted-foreground"}`}
                      >
                        {l.filled}/{CAPTURE_FIELDS.length}
                      </span>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {selectMode && selectedVisibleCount > 0 ? (
        <div className="p-2 border-t border-border flex items-center gap-1.5 shrink-0 bg-card/80">
          <span className="text-[11px] font-medium tabular-nums text-muted-foreground shrink-0 px-1">
            {selectedVisibleCount} sel.
          </span>
          <Button
            size="sm"
            variant="default"
            className="flex-1 min-h-[44px] lg:h-8 text-[11px] rounded-lg"
            disabled={!whatsappConnected}
            title={!whatsappConnected ? "WhatsApp desconectado" : undefined}
            onClick={openBatch}
          >
            Abrir atendimento
          </Button>
        </div>
      ) : (
        <div className="p-2 border-t border-border flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="default"
            className="flex-1 min-h-[44px] lg:h-8 text-[11px] gap-1.5 rounded-lg"
            onClick={async () => {
              const phone = await prompt({
                title: "Entrar em captação manual",
                description: "Informe o telefone do cliente interessado (com DDD).",
                placeholder: "Ex: 11971254913",
                confirmText: "Entrar",
              });
              if (!phone) return;
              const digits = phone.replace(/\D/g, "");
              if (digits.length < 10) {
                toast.error("Telefone inválido");
                return;
              }
              const { data: existing } = await supabase
                .from("customers")
                .select("id")
                .eq("consultant_id", consultantId)
                .ilike("phone_whatsapp", `%${digits}%`)
                .maybeSingle();
              if (existing?.id) {
                await supabase
                  .from("customers")
                  .update({ capture_mode: "manual", capture_started_at: new Date().toISOString() })
                  .eq("id", existing.id);
                onSelect(existing.id);
              } else {
                const { data: created } = await supabase
                  .from("customers")
                  .insert({
                    consultant_id: consultantId,
                    phone_whatsapp: digits,
                    capture_mode: "manual",
                    capture_started_at: new Date().toISOString(),
                    customer_origin: "whatsapp_lead",
                  })
                  .select("id")
                  .maybeSingle();
                if (created?.id) onSelect(created.id);
              }
              void load();
            }}
          >
            <UserPlus className="w-3.5 h-3.5" /> Novo cliente
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-11 w-11 lg:h-8 lg:w-8 shrink-0"
            title="Atualizar lista"
            onClick={() => void load()}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </aside>
  );
}
