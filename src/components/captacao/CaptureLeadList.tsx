import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Search, UserPlus, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CAPTURE_FIELDS } from "@/hooks/useCaptureSession";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { toast } from "sonner";

interface LeadRow {
  id: string;
  name: string | null;
  phone_whatsapp: string | null;
  capture_started_at: string | null;
  created_at: string;
  filled: number;
  lastMsg?: string | null;
  lastMsgAt?: string | null;
}

interface Props {
  consultantId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  gameOn?: boolean;
}

// Avatar com inicial e cor derivada do id (igual aos apps de mensagem)
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

export function CaptureLeadList({ consultantId, selectedId, onSelect }: Props) {
  const prompt = usePrompt();
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

    // Busca a última mensagem de cada lead (prévia na lista), em 1 query
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      const { data: msgs } = await supabase
        .from("conversations")
        .select("customer_id, message_text, message_type, created_at")
        .in("customer_id", ids)
        .order("created_at", { ascending: false })
        .limit(400);
      if (msgs) {
        const lastByCustomer = new Map<string, { text: string; at: string }>();
        for (const m of msgs as any[]) {
          if (!lastByCustomer.has(m.customer_id)) {
            const t = m.message_text || `[${m.message_type || "mídia"}]`;
            lastByCustomer.set(m.customer_id, { text: t, at: m.created_at });
          }
        }
        setLeads((prev) => prev.map((r) => {
          const last = lastByCustomer.get(r.id);
          return last ? { ...r, lastMsg: last.text, lastMsgAt: last.at } : r;
        }));
      }
    }
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

  const fmtPhone = (p: string | null) => {
    if (!p) return "—";
    if (/sem_celular/i.test(p)) return "Sem telefone";
    const d = p.replace(/\D/g, "");
    return d.length >= 12 ? `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}` : p;
  };

  return (
    <aside className="w-full md:w-auto md:shrink-0 flex flex-col flex-1 h-full border-b md:border-b-0 md:border-r border-border bg-card/40 min-h-0 overflow-hidden">
      <div className="p-2.5 border-b border-border space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Conversas</h3>
          <span className="text-xs tabular-nums font-medium text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full">{leads.length}</span>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nome ou telefone" className="h-9 pl-8 text-xs rounded-lg" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <p className="p-6 text-center text-xs text-muted-foreground">Carregando...</p>}
        {!loading && filtered.length === 0 && (
          <div className="p-6 text-center space-y-2">
            <UserPlus className="w-8 h-8 mx-auto text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">Nenhum cliente em captação.<br />Abra um cliente no WhatsApp e clique em "Capturar dados".</p>
          </div>
        )}
        <ul className="divide-y divide-border/60">
          {filtered.map(l => {
            const active = l.id === selectedId;
            const pct = Math.round((l.filled / CAPTURE_FIELDS.length) * 100);
            const ready = l.filled >= CAPTURE_FIELDS.length;
            return (
              <li key={l.id}>
                <button
                  onClick={() => onSelect(l.id)}
                  className={`w-full text-left px-2.5 py-2.5 flex gap-2.5 transition-colors ${
                    active ? "bg-primary/10 border-l-2 border-primary" : "border-l-2 border-transparent hover:bg-secondary/50"
                  }`}
                >
                  {/* Avatar */}
                  <div className={`relative shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold ${toneFor(l.id)}`}>
                    {initialsFrom(l.name, l.phone_whatsapp)}
                    {ready && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary border-2 border-card" title="Cadastro completo" />
                    )}
                  </div>
                  {/* Conteúdo */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground sensitive-name">{l.name || "Sem nome"}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{fmtTime(l.lastMsgAt || l.created_at)}</span>
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground mt-0.5 sensitive-phone">
                      {l.lastMsg ? l.lastMsg : fmtPhone(l.phone_whatsapp)}
                    </p>
                    {/* Progresso */}
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${ready ? "bg-primary" : "bg-primary/60"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className={`text-[10px] tabular-nums font-medium shrink-0 ${ready ? "text-primary" : "text-muted-foreground"}`}>{l.filled}/{CAPTURE_FIELDS.length}</span>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="p-2 border-t border-border flex items-center gap-1.5 shrink-0">
        <Button size="sm" variant="default" className="flex-1 min-h-[44px] lg:h-8 text-[11px] gap-1.5 rounded-lg" onClick={async () => {
          const phone = await prompt({
            title: "Entrar em captação manual",
            description: "Informe o telefone do cliente interessado (com DDD).",
            placeholder: "Ex: 11971254913",
            confirmText: "Entrar",
          });
          if (!phone) return;
          const digits = phone.replace(/\D/g, "");
          if (digits.length < 10) { toast.error("Telefone inválido"); return; }
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
        }}><UserPlus className="w-3.5 h-3.5" /> Novo cliente</Button>
        <Button size="icon" variant="ghost" className="h-11 w-11 lg:h-8 lg:w-8 shrink-0" title="Atualizar lista" onClick={() => void load()}>
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>
    </aside>
  );
}
