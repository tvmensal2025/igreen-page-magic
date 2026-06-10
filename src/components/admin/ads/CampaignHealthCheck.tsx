import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertTriangle, Clock, PauseCircle, XCircle, RefreshCw, ExternalLink, MessageCircle } from "lucide-react";

type Delivery = "delivering" | "warming" | "no_delivery" | "paused" | "rejected" | "review" | "not_published";

interface StatusResp {
  delivery: Delivery;
  message: string;
  campaign_status?: string;
  adset_status?: string | null;
  ad_status?: string | null;
  issues?: string[];
  impressions_24h?: number;
  impressions_7d?: number;
  clicks_24h?: number;
  spend_24h_cents?: number;
  checked_at?: string;
}

const STYLES: Record<Delivery, { bg: string; icon: any; label: string }> = {
  delivering:    { bg: "bg-primary/15 border-primary/30 text-primary", icon: CheckCircle2, label: "Funcionando" },
  warming:       { bg: "bg-warning/15 border-warning/30 text-warning",       icon: Clock,        label: "Aquecendo" },
  no_delivery:   { bg: "bg-destructive/15 border-destructive/30 text-destructive", icon: AlertTriangle,label: "Sem entregar" },
  paused:        { bg: "bg-secondary border-border text-muted-foreground",         icon: PauseCircle,  label: "Pausada" },
  rejected:      { bg: "bg-destructive/15 border-destructive/30 text-destructive", icon: XCircle,      label: "Reprovada" },
  review:        { bg: "bg-info/15 border-info/30 text-info",          icon: Clock,        label: "Em revisão" },
  not_published: { bg: "bg-secondary border-border text-muted-foreground",         icon: Clock,        label: "Não publicada" },
};

export function CampaignHealthCheck({
  campaignId,
  fbCampaignId,
  whatsappNumber,
}: {
  campaignId: string;
  fbCampaignId: string | null;
  whatsappNumber: string | null;
}) {
  const [data, setData] = useState<StatusResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function check() {
    setRefreshing(true);
    try {
      const { data: r, error } = await supabase.functions.invoke("facebook-campaign-status", {
        body: { campaign_id: campaignId },
      });
      if (error) throw error;
      setData(r as StatusResp);
    } catch (e: any) {
      setData({ delivery: "no_delivery", message: e?.message || "Falha ao verificar" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { check(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [campaignId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Verificando se está funcionando...
      </div>
    );
  }
  if (!data) return null;

  const s = STYLES[data.delivery];
  const Icon = s.icon;
  const waDigits = (whatsappNumber || "").replace(/\D/g, "");
  const testLink = waDigits ? `https://wa.me/${waDigits}?text=${encodeURIComponent("Vi seu anúncio")}` : null;
  const fbDeepLink = fbCampaignId ? `https://business.facebook.com/adsmanager/manage/campaigns?selected_campaign_ids=${fbCampaignId}` : null;

  return (
    <div className={`rounded-lg border ${s.bg} p-3 space-y-2`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-4 h-4 shrink-0" />
          <div className="min-w-0">
            <div className="font-bold text-xs">{s.label}</div>
            <div className="text-[11px] opacity-80 truncate">{data.message}</div>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={check} disabled={refreshing} className="h-7 w-7 p-0 shrink-0">
          {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </Button>
      </div>

      {(data.delivery === "delivering" || data.delivery === "no_delivery" || data.delivery === "warming") && (
        <div className="grid grid-cols-3 gap-1.5 text-[10px]">
          <Mini label="Impressões hoje" value={(data.impressions_24h || 0).toLocaleString("pt-BR")} />
          <Mini label="Cliques hoje" value={String(data.clicks_24h || 0)} />
          <Mini label="Gasto hoje" value={`R$ ${((data.spend_24h_cents || 0) / 100).toFixed(2)}`} />
        </div>
      )}

      {data.issues && data.issues.length > 0 && (
        <div className="text-[11px] text-destructive bg-destructive/10 rounded px-2 py-1">
          {data.issues.slice(0, 2).join(" · ")}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {testLink && (
          <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" asChild>
            <a href={testLink} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="w-3 h-3" /> Testar meu link
            </a>
          </Button>
        )}
        {fbDeepLink && (
          <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" asChild>
            <a href={fbDeepLink} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-3 h-3" /> Ver no Meta
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-background/40 px-2 py-1">
      <div className="opacity-70">{label}</div>
      <div className="font-bold">{value}</div>
    </div>
  );
}
