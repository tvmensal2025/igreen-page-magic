import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Eye, RefreshCw, Search, Clock3, Wand2, ExternalLink } from "lucide-react";

interface Row {
  id: string;
  ad_archive_id: string | null;
  advertiser: string;
  headline: string | null;
  primary_text: string | null;
  cta: string | null;
  angle: string | null;
  creative_format: string | null;
  active_days: number | null;
  thumbnail_url: string | null;
  image_url: string | null;
  last_seen_at: string | null;
  ingested_at: string;
}

interface Props {
  onInspire?: (adId: string, hint: string) => void;
}

const ANGLE_LABEL: Record<string, string> = {
  economia_concreta: "💰 Economia",
  quebra_objecao: "🛡️ Quebra objeção",
  prova_social: "👥 Prova social",
  curiosidade: "❓ Curiosidade",
  dor_pas: "😣 Dor/PAS",
  urgencia_local: "📍 Urgência local",
};

export function CompetitorsPanel({ onInspire }: Props = {}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [advertiser, setAdvertiser] = useState<string>("all");
  const [angle, setAngle] = useState<string>("all");
  const [format, setFormat] = useState<string>("all");
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("ad_competitor_creatives")
      .select("id, ad_archive_id, advertiser, headline, primary_text, cta, angle, creative_format, active_days, thumbnail_url, image_url, last_seen_at, ingested_at")
      .order("active_days", { ascending: false })
      .limit(100);
    setRows((data as Row[]) || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function rescan() {
    setScanning(true);
    try {
      // Fire-and-forget — função pode demorar 30-60s, não esperamos
      supabase.functions.invoke("ad-competitor-scraper", { body: {} }).catch(() => {});
      toast({ title: "Re-escaneamento iniciado", description: "Atualizando em ~1 min. Os novos anúncios aparecerão aqui." });
      setTimeout(() => { load(); setScanning(false); }, 60_000);
    } catch (e) {
      setScanning(false);
      toast({ title: "Erro", description: String(e), variant: "destructive" });
    }
  }

  const advertisers = Array.from(new Set(rows.map(r => r.advertiser))).sort();
  const ownBenchmark = rows.filter(r => /i\s*green/i.test(r.advertiser));
  const competitors = rows.filter(r => !/i\s*green/i.test(r.advertiser));
  const recentCutoff = Date.now() - 30 * 86400_000;
  const isRecent = (row: Row) => {
    const seenAt = row.last_seen_at || row.ingested_at;
    const timestamp = new Date(seenAt).getTime();
    return Number.isFinite(timestamp) && timestamp >= recentCutoff;
  };
  const recentCompetitors = competitors.filter(isRecent);

  const filtered = rows.filter(r => {
    if (!isRecent(r)) return false;
    if (advertiser === "all" && /i\s*green/i.test(r.advertiser)) return false;
    if (advertiser !== "all" && r.advertiser !== advertiser) return false;
    if (angle !== "all" && r.angle !== angle) return false;
    if (format !== "all" && r.creative_format !== format) return false;
    if (search && !`${r.headline} ${r.primary_text} ${r.advertiser}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const top5Ids = new Set(recentCompetitors.slice(0, 5).map(r => r.id));
  const longestObserved = recentCompetitors[0];

  function inspire(r: Row) {
    const hint = `${r.advertiser} · ${r.active_days || 0}d no ar — "${(r.headline || r.primary_text || "").slice(0, 100)}"`;
    if (onInspire) {
      onInspire(r.id, hint);
    } else {
      toast({ title: "Inspiração selecionada", description: hint });
    }
  }

  function fbAdLibUrl(r: Row): string | null {
    if (!r.ad_archive_id) return null;
    return `https://www.facebook.com/ads/library/?id=${encodeURIComponent(r.ad_archive_id)}`;
  }

  return (
    <Card className="p-5 bg-card/50 backdrop-blur border-border/60">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h3 className="font-bold text-foreground flex items-center gap-2">
            <Eye className="w-5 h-5 text-primary" />
            Referências de anúncios observadas no Brasil
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            {recentCompetitors.length} anúncios recentes de outras empresas. Permanência no ar é referência de observação, não prova de conversão.
            {ownBenchmark.length > 0 && ` iGreen aparece separadamente como benchmark próprio (${ownBenchmark.length}).`}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={rescan} disabled={scanning} className="gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${scanning ? "animate-spin" : ""}`} />
          {scanning ? "Escaneando..." : "Re-escanear agora"}
        </Button>
      </div>

      {/* Referência observada há mais tempo entre registros recentes */}
      {longestObserved && (
        <div className="mb-4 p-4 rounded-xl border-2 border-primary/50 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent">
          <div className="flex items-center gap-2 mb-2">
            <Clock3 className="w-5 h-5 text-primary" />
            <span className="font-bold text-sm text-foreground">Referência observada há mais tempo</span>
            <Badge className="text-[10px] h-5">{longestObserved.active_days || 0}d observados</Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mb-3">A permanência observada não comprova conversão nem valida as afirmações do anúncio.</p>
          <div className="grid md:grid-cols-[120px_1fr] gap-3">
            {(longestObserved.thumbnail_url || longestObserved.image_url) ? (
              <img
                src={longestObserved.thumbnail_url || longestObserved.image_url || ""}
                alt={longestObserved.advertiser}
                className="w-full md:w-[120px] aspect-square object-cover rounded-lg border border-border/40"
                loading="lazy"
              />
            ) : (
              <div className="w-full md:w-[120px] aspect-square rounded-lg bg-secondary/40 border border-border/40 flex items-center justify-center">
                <Eye className="w-8 h-8 text-muted-foreground/40" />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-semibold text-sm text-foreground">{longestObserved.advertiser}</span>
                {longestObserved.angle && <Badge variant="outline" className="text-[10px] h-5">{ANGLE_LABEL[longestObserved.angle] || longestObserved.angle}</Badge>}
                {longestObserved.creative_format && <Badge variant="outline" className="text-[10px] h-5">{longestObserved.creative_format}</Badge>}
              </div>
              {longestObserved.headline && <p className="text-sm text-foreground font-medium">"{longestObserved.headline}"</p>}
              {longestObserved.primary_text && <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{longestObserved.primary_text}</p>}
              <div className="flex gap-2 mt-2 flex-wrap">
                <Button size="sm" className="h-7 text-[11px] gap-1" onClick={() => inspire(longestObserved)}>
                  <Wand2 className="w-3 h-3" /> Usar como referência
                </Button>
                {fbAdLibUrl(longestObserved) && (
                  <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" asChild>
                    <a href={fbAdLibUrl(longestObserved)!} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3 h-3" /> Ver na Meta
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <div className="col-span-2 md:col-span-1 relative">
          <Search className="absolute left-2 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar..." className="pl-7 h-9 text-xs" />
        </div>
        <Select value={advertiser} onValueChange={setAdvertiser}>
          <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Marca" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as marcas</SelectItem>
            {advertisers.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={angle} onValueChange={setAngle}>
          <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Ângulo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os ângulos</SelectItem>
            {Object.entries(ANGLE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={format} onValueChange={setFormat}>
          <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Formato" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos formatos</SelectItem>
            <SelectItem value="estatico">📷 Estático</SelectItem>
            <SelectItem value="video">🎬 Vídeo</SelectItem>
            <SelectItem value="carrossel">🎠 Carrossel</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Nenhum anúncio com esses filtros.</p>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
          {filtered.map(r => (
            <div key={r.id} className={`p-3 rounded-lg border ${top5Ids.has(r.id) ? "bg-primary/5 border-primary/40" : "bg-secondary/30 border-border/40"}`}>
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-foreground">{r.advertiser}</span>
                  {top5Ids.has(r.id) && <Clock3 className="w-3.5 h-3.5 text-primary" aria-label="Entre as referências recentes observadas há mais tempo" />}
                  {r.angle && <Badge variant="outline" className="text-[10px] h-5">{ANGLE_LABEL[r.angle] || r.angle}</Badge>}
                  {r.creative_format && <Badge variant="outline" className="text-[10px] h-5">{r.creative_format}</Badge>}
                </div>
                {r.active_days != null && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {r.active_days}d no ar
                  </span>
                )}
              </div>
              {r.headline && <p className="text-sm text-foreground mt-1.5 font-medium">"{r.headline}"</p>}
              {r.primary_text && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.primary_text}</p>}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {r.cta && <Badge variant="secondary" className="text-[10px] h-5">CTA: {r.cta}</Badge>}
                <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 ml-auto" onClick={() => inspire(r)}>
                  <Wand2 className="w-3 h-3" /> Inspirar
                </Button>
                {fbAdLibUrl(r) && (
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1" asChild>
                    <a href={fbAdLibUrl(r)!} target="_blank" rel="noopener">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
