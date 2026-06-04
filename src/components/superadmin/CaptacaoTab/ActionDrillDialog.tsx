import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Loader2, MessageCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  action: { label: string; detail: string; type: string; impact: string } | null;
}

export function ActionDrillDialog({ open, onOpenChange, action }: Props) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    if (!open || !action) return;
    setLoading(true);
    setRows([]);
    load(action.type).then((r) => {
      setRows(r);
      setLoading(false);
    });
  }, [open, action]);

  async function load(type: string): Promise<any[]> {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    try {
      if (type === "reactivate_leads" || type === "view_stuck_leads" || type === "tune_handoff") {
        const { data } = await supabase
          .from("customers")
          .select("id, name, phone_whatsapp, status, created_at, last_bot_interaction_at, updated_at, flow_variant")
          .neq("customer_origin", "igreen_sync")
          .in("status", ["contato_incompleto", "pending", "awaiting_otp"])
          .gte("created_at", since)
          .order("last_bot_interaction_at", { ascending: true, nullsFirst: true })
          .limit(50);
        return (data || []).map((r: any) => ({
          ...r,
          phone: r.phone_whatsapp,
          last_message_at: r.last_bot_interaction_at || r.updated_at,
        }));
      }
      if (type === "pause_variant") {
        const { data } = await supabase
          .from("customers")
          .select("flow_variant, status")
          .gte("created_at", since)
          .neq("customer_origin", "igreen_sync");
        const map: Record<string, { total: number; approved: number }> = {};
        for (const c of data || []) {
          const v = c.flow_variant || "A";
          if (!map[v]) map[v] = { total: 0, approved: 0 };
          map[v].total++;
          if (c.status === "approved") map[v].approved++;
        }
        return Object.entries(map).map(([variant, m]) => ({
          variant,
          total: m.total,
          approved: m.approved,
          rate: m.total > 0 ? Math.round((m.approved / m.total) * 1000) / 10 : 0,
        }));
      }
      if (type === "replicate_creative") {
        const { data } = await supabase
          .from("ad_creative_performance")
          .select("headline, framework, angle, creative_format, score, leads, spend_cents")
          .eq("is_winner", true)
          .order("score", { ascending: false })
          .limit(10);
        return data || [];
      }
      if (type === "adjust_targeting") {
        const { data } = await supabase
          .from("ad_creative_performance")
          .select("headline, leads, clicks, impressions, spend_cents, score")
          .order("spend_cents", { ascending: false })
          .limit(15);
        return data || [];
      }
    } catch (e) {
      console.error("[ActionDrill] load error:", e);
    }
    return [];
  }

  function waLink(phone: string) {
    const clean = String(phone || "").replace(/\D/g, "");
    return `https://wa.me/${clean}`;
  }

  function brl(cents: number) {
    return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {action?.label}
            {action && (
              <Badge variant={action.impact === "high" ? "default" : "outline"} className="text-[10px]">
                {action.impact}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>{action?.detail}</DialogDescription>
        </DialogHeader>

        <div className="overflow-auto flex-1 -mx-6 px-6">
          {loading ? (
            <div className="py-12 flex items-center justify-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Carregando dados...
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <p>Nenhum dado encontrado para essa ação.</p>
              <p className="text-xs mt-2">Detalhe da IA: {action?.detail}</p>
            </div>
          ) : (
            <RenderRows type={action!.type} rows={rows} waLink={waLink} brl={brl} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RenderRows({ type, rows, waLink, brl }: { type: string; rows: any[]; waLink: (p: string) => string; brl: (c: number) => string }) {
  if (type === "reactivate_leads" || type === "view_stuck_leads" || type === "tune_handoff") {
    return (
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground mb-2">{rows.length} leads parados (mais antigos primeiro)</p>
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-card/40 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground truncate">{r.name || "Sem nome"} <span className="text-muted-foreground font-normal">· {r.phone}</span></p>
              <p className="text-[10px] text-muted-foreground">
                {r.status} · var {r.flow_variant || "A"} · última msg {r.last_message_at ? formatDistanceToNow(new Date(r.last_message_at), { locale: ptBR, addSuffix: true }) : "nunca"}
              </p>
            </div>
            <Button size="sm" variant="outline" asChild className="gap-1 h-7 text-[11px]">
              <a href={waLink(r.phone)} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="w-3 h-3" /> WhatsApp
              </a>
            </Button>
          </div>
        ))}
      </div>
    );
  }

  if (type === "pause_variant") {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground mb-2">Performance por variante (últimos 30 dias)</p>
        {rows.map((r) => (
          <div key={r.variant} className="grid grid-cols-4 gap-2 rounded-lg border border-border/40 bg-card/40 px-3 py-2 text-xs">
            <div className="font-bold">Variante {r.variant}</div>
            <div>{r.total} leads</div>
            <div>{r.approved} aprov.</div>
            <div className={r.rate < 5 ? "text-red-400 font-bold" : r.rate > 15 ? "text-emerald-400 font-bold" : ""}>{r.rate}%</div>
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground italic pt-2">
          Para pausar uma variante, ajuste a distribuição em <code>flow_variant_distribution</code>.
        </p>
      </div>
    );
  }

  if (type === "replicate_creative") {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground mb-2">Top criativos vencedores — replique headline/ângulo</p>
        {rows.map((r, i) => (
          <div key={i} className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
            <p className="text-xs font-bold text-foreground">{r.headline || "(sem headline)"}</p>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {r.framework && <Badge variant="outline" className="text-[10px]">{r.framework}</Badge>}
              {r.angle && <Badge variant="outline" className="text-[10px]">{r.angle}</Badge>}
              {r.creative_format && <Badge variant="outline" className="text-[10px]">{r.creative_format}</Badge>}
              <Badge className="text-[10px]">{r.leads} leads · score {r.score}</Badge>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (type === "adjust_targeting") {
    return (
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground mb-2">Maiores investimentos — verifique CPL</p>
        {rows.map((r, i) => {
          const cpl = r.leads > 0 ? r.spend_cents / r.leads : 0;
          return (
            <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-card/40 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate">{r.headline || "(sem headline)"}</p>
                <p className="text-[10px] text-muted-foreground">{brl(r.spend_cents)} · {r.leads} leads · CPL {cpl > 0 ? brl(cpl) : "—"}</p>
              </div>
              <Badge variant={cpl > 5000 ? "destructive" : "outline"} className="text-[10px] shrink-0">score {r.score}</Badge>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="py-8 text-center text-xs text-muted-foreground">
      <ExternalLink className="w-6 h-6 mx-auto mb-2 opacity-40" />
      Ação genérica — execute manualmente conforme o detalhe acima.
    </div>
  );
}
