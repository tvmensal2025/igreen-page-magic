import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Search, UserPlus, Clock, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CAPTURE_FIELDS } from "@/hooks/useCaptureSession";

interface LeadRow {
  id: string;
  name: string | null;
  phone_whatsapp: string | null;
  capture_started_at: string | null;
  created_at: string;
  filled: number;
}

interface Props {
  consultantId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  gameOn?: boolean;
}

export function CaptureLeadList({ consultantId, selectedId, onSelect, gameOn = false }: Props) {

  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const cols = "id, name, phone_whatsapp, capture_started_at, created_at, " + CAPTURE_FIELDS.map(f => f.key).join(", ");
    const { data } = await supabase
      .from("customers")
      .select(cols)
      .eq("consultant_id", consultantId)
      .eq("capture_mode", "manual")
      .order("created_at", { ascending: false })
      .limit(100);
    const rows: LeadRow[] = (data || []).map((c: any) => ({
      id: c.id,
      name: c.name,
      phone_whatsapp: c.phone_whatsapp,
      capture_started_at: c.capture_started_at,
      created_at: c.created_at,
      filled: CAPTURE_FIELDS.filter(f => {
        const v = c[f.key];
        if (v === null || v === undefined) return false;
        if (typeof v === "string" && !v.trim()) return false;
        if (f.key === "electricity_bill_value" && Number(v) <= 0) return false;
        return true;
      }).length,
    }));
    setLeads(rows);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [consultantId]);

  // realtime para refresh leve
  useEffect(() => {
    const ch = supabase.channel(`capture-list-${consultantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "customers", filter: `consultant_id=eq.${consultantId}` },
        () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [consultantId]);

  const filtered = leads.filter(l => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (l.name || "").toLowerCase().includes(s) || (l.phone_whatsapp || "").includes(s);
  });

  const fmtTime = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso); const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "agora";
    if (mins < 60) return `${mins}m`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h`;
    return `${Math.floor(mins / 1440)}d`;
  };

  return (
    <aside className="w-full md:w-auto md:shrink-0 flex flex-col flex-1 h-full border-b md:border-b-0 md:border-r border-border bg-card/40 backdrop-blur-sm min-h-0 overflow-hidden">
      <div className="p-2 border-b border-border space-y-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <h3 className={`text-sm font-semibold ${gameOn ? "exec-shimmer font-black uppercase tracking-wider" : ""}`}>
            {gameOn ? "Leads" : "Em captação"}
          </h3>
          <span className={`text-xs tabular-nums font-bold ${gameOn ? "text-amber-400" : "text-muted-foreground"}`}>{leads.length}</span>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nome/telefone" className="h-8 pl-8 text-xs" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <p className="p-6 text-center text-xs text-muted-foreground">Carregando...</p>}
        {!loading && filtered.length === 0 && (
          <div className="p-6 text-center space-y-2">
            <UserPlus className="w-8 h-8 mx-auto text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">Nenhum lead em captação.<br />Abra um lead pelo chat e clique em "Capturar dados".</p>
          </div>
        )}
        <ul className="divide-y divide-border">
          {filtered.map(l => {
            const active = l.id === selectedId;
            const pct = Math.round((l.filled / CAPTURE_FIELDS.length) * 100);
            const ready = l.filled >= CAPTURE_FIELDS.length;
            const medal = l.filled >= 8 ? "💎" : l.filled >= 6 ? "🥇" : l.filled >= 4 ? "🥈" : l.filled >= 2 ? "🥉" : "🌱";
            return (
              <li key={l.id}>
                <button
                  onClick={() => onSelect(l.id)}
                  className={`w-full text-left px-2.5 py-2 hover:bg-secondary/60 transition-colors ${
                    active ? "bg-primary/10 border-l-2 border-primary" : ""
                  } ${ready ? "ring-1 ring-amber-400/50 bg-amber-400/5" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`leading-none ${gameOn ? "text-base" : "text-sm"}`} title="Nível">{medal}</span>
                      <span className={`truncate ${gameOn ? "text-[15px] font-bold tracking-tight" : "text-sm font-medium"}`}>{l.name || "Sem nome"}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 shrink-0">
                      <Clock className="w-3 h-3" />{fmtTime(l.created_at || l.capture_started_at)}
                    </span>
                  </div>
                  <p className={`truncate ${gameOn ? "text-[11px] text-muted-foreground/80 font-mono" : "text-[11px] text-muted-foreground"}`}>{l.phone_whatsapp || "—"}</p>

                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
                      <div className={`h-full transition-all ${ready ? "bg-gradient-to-r from-amber-400 to-yellow-300" : "bg-gradient-to-r from-emerald-500 to-lime-400"}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className={`text-[10px] tabular-nums font-semibold ${ready ? "text-amber-500" : "text-primary"}`}>{l.filled}/{CAPTURE_FIELDS.length}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="p-1.5 border-t border-border flex items-center gap-1 shrink-0">
        <Button size="sm" variant="default" className="flex-1 h-7 text-[11px] gap-1" onClick={async () => {
          const phone = window.prompt("Telefone do lead (com DDD) para entrar em captação:");
          if (!phone) return;
          const digits = phone.replace(/\D/g, "");
          if (digits.length < 10) { alert("Telefone inválido"); return; }
          const { data: existing } = await supabase.from("customers").select("id").eq("consultant_id", consultantId).ilike("phone_whatsapp", `%${digits}%`).maybeSingle();
          if (existing?.id) {
            await supabase.from("customers").update({ capture_mode: "manual", capture_started_at: new Date().toISOString() }).eq("id", existing.id);
            onSelect(existing.id);
          } else {
            const { data: created } = await supabase.from("customers").insert({
              consultant_id: consultantId, phone_whatsapp: digits, capture_mode: "manual",
              capture_started_at: new Date().toISOString(), customer_origin: "whatsapp_lead",
            }).select("id").maybeSingle();
            if (created?.id) onSelect(created.id);
          }
          void load();
        }}><UserPlus className="w-3 h-3" /> Novo lead</Button>
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Atualizar lista" onClick={() => void load()}>
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>
    </aside>
  );
}
