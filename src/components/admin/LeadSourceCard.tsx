import { useEffect, useState } from "react";
import { Megaphone, Sparkles, Users, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface LeadSourceCardProps {
  consultantId: string;
  periodDays: number;
}

const SOURCE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  meta_ads: { label: "Anúncios Meta (FB/IG)", icon: "📣", color: "hsl(200, 100%, 50%)" },
  google_ads: { label: "Google Ads", icon: "🔎", color: "hsl(30, 100%, 50%)" },
  indicacao: { label: "Indicação", icon: "🤝", color: "hsl(280, 80%, 60%)" },
  organic: { label: "Orgânico", icon: "🌱", color: "hsl(130, 100%, 36%)" },
  manual: { label: "Cadastro manual", icon: "✍️", color: "hsl(0, 0%, 55%)" },
  unknown: { label: "Não classificado", icon: "❓", color: "hsl(0, 0%, 45%)" },
};

interface CampaignBreakdown {
  campaign_id: string;
  campaign_name: string;
  count: number;
}

export function LeadSourceCard({ consultantId, periodDays }: LeadSourceCardProps) {
  const [data, setData] = useState<{ source: string; count: number }[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignBreakdown[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      const since = new Date(Date.now() - periodDays * 24 * 3600 * 1000).toISOString();

      const [{ data: rows }, { data: campaignRows }] = await Promise.all([
        supabase
          .from("customers")
          .select("lead_source")
          .eq("consultant_id", consultantId)
          .eq("customer_origin", "whatsapp_lead")
          .gte("created_at", since)
          .limit(5000),
        // Leads com campanha específica identificada
        supabase
          .from("customers")
          .select("source_campaign_id, facebook_campaigns(name)")
          .eq("consultant_id", consultantId)
          .not("source_campaign_id", "is", null)
          .gte("created_at", since)
          .limit(5000),
      ]);

      if (cancelled) return;

      const counts: Record<string, number> = {};
      (rows || []).forEach((r: any) => {
        const k = r.lead_source || "unknown";
        counts[k] = (counts[k] || 0) + 1;
      });
      const arr = Object.entries(counts)
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count);
      setData(arr);

      // Agrupa por campanha
      const campMap: Record<string, CampaignBreakdown> = {};
      (campaignRows || []).forEach((r: any) => {
        const cid = r.source_campaign_id;
        const name = r.facebook_campaigns?.name || cid;
        if (!campMap[cid]) campMap[cid] = { campaign_id: cid, campaign_name: name, count: 0 };
        campMap[cid].count++;
      });
      setCampaigns(Object.values(campMap).sort((a, b) => b.count - a.count));

      setLoading(false);
    };
    fetchData();
    return () => { cancelled = true; };
  }, [consultantId, periodDays]);

  const total = data.reduce((s, x) => s + x.count, 0);
  const adsLeads = data.find((d) => d.source === "meta_ads")?.count ?? 0;
  const adsPct = total > 0 ? Math.round((adsLeads / total) * 100) : 0;

  return (
    <div className="premium-card min-w-0 w-full overflow-hidden">
      <div className="flex items-start justify-between mb-1 gap-2 flex-wrap">
        <div className="min-w-0">
          <h3 className="font-heading font-bold text-foreground flex items-center gap-2 text-sm sm:text-base">
            <Megaphone className="w-4 h-4 text-primary shrink-0" />
            <span className="truncate">Origem dos clientes interessados</span>
          </h3>
          <p className="text-xs text-muted-foreground">Últimos {periodDays} dias — anúncio / mensagem do WhatsApp</p>
        </div>
        {total > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-semibold text-foreground">
              {adsLeads} via anúncio ({adsPct}%)
            </span>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-6">Carregando…</p>
      ) : total === 0 ? (
        <div className="text-center py-6">
          <Users className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Sem clientes interessados novos no período</p>
          <p className="text-[11px] text-muted-foreground/70 mt-1">
            Quando você subir anúncios Click-to-WhatsApp, os clientes interessados aparecerão aqui automaticamente.
          </p>
        </div>
      ) : (
        <div className="space-y-3 mt-4">
          {data.map((row) => {
            const meta = SOURCE_LABELS[row.source] || { label: row.source, icon: "•", color: "hsl(0,0%,50%)" };
            const pct = Math.round((row.count / total) * 100);
            return (
              <div key={row.source}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-foreground flex items-center gap-1.5">
                    <span>{meta.icon}</span> {meta.label}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {row.count} ({pct}%)
                  </span>
                </div>
                <div className="w-full bg-secondary rounded-full h-2.5 overflow-hidden">
                  <div
                    className="h-2.5 rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, background: meta.color }}
                  />
                </div>
              </div>
            );
          })}

          {/* Breakdown por campanha específica */}
          {campaigns.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border/50">
              <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                Clientes interessados por campanha identificada
              </p>
              <div className="space-y-2">
                {campaigns.map((c) => {
                  const pct = adsLeads > 0 ? Math.round((c.count / adsLeads) * 100) : 0;
                  return (
                    <div key={c.campaign_id}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-foreground truncate max-w-[70%]">📣 {c.campaign_name}</span>
                        <span className="text-muted-foreground tabular-nums shrink-0">{c.count} lead{c.count !== 1 ? "s" : ""} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-secondary rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-1.5 rounded-full transition-all duration-500 bg-primary/70"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {adsLeads > 0 && campaigns.length === 0 && (
            <div className="mt-4 pt-3 border-t border-border/50 flex items-start gap-2 text-xs text-muted-foreground">
              <TrendingUp className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
              <span>
                Dica: configure a <strong className="text-foreground">mensagem pré-preenchida</strong> do seu anúncio Click-to-WhatsApp com um texto único por campanha. O sistema identifica automaticamente de qual campanha veio cada cliente interessado.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
