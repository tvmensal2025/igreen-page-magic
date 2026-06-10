/**
 * Card rico e reutilizável de Template de Anúncio.
 * Usado no painel SuperAdmin (modo "manage") e na galeria do consultor (modo "use").
 *
 * Mostra:
 * - Carrossel das fotos no formato nativo (1:1 / 4:5 / 9:16) com pílula do formato
 * - Copy completa (headline / texto principal / descrição) expansível
 * - Variantes A/B
 * - Segmentação (distribuidoras, cidades, idade, gênero)
 * - Performance real agregada (últimos 30d) via getTemplateAggregatedMetrics
 * - Ações: editar/publicar/apagar/duplicar (manage) ou personalizar/publicar (use)
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ChevronDown, ChevronLeft, ChevronRight, Pencil, Trash2, Eye, EyeOff,
  Copy as CopyIcon, MessageCircle, MousePointerClick, Eye as ImpressionIcon,
  DollarSign, Users, Sparkles, Target, Loader2, AlertCircle,
} from "lucide-react";
import { AdTemplate, getTemplateAggregatedMetrics, type TemplateAggregatedMetrics } from "@/services/adTemplates";
import { DISTRIBUIDORAS_PRESETS } from "@/data/distribuidoraPresets";
import { cn } from "@/lib/utils";

const FORMAT_ASPECT: Record<string, string> = {
  square: "aspect-square",
  vertical: "aspect-[4/5]",
  story: "aspect-[9/16]",
};
const FORMAT_LABEL: Record<string, string> = {
  square: "1:1 Feed",
  vertical: "4:5 Feed",
  story: "9:16 Reels",
};

interface Props {
  template: AdTemplate;
  mode: "manage" | "use";
  /** Se mode="use", filtra performance só pelas campanhas desse consultor */
  consultantId?: string;
  /** Renderizado no rodapé. Painel passa botões customizados (Editar/Publicar/Apagar) ou (Personalizar/Publicar) */
  footer?: ReactNode;
  /** Ações secundárias no header do card */
  onEdit?: () => void;
  onTogglePublish?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  busy?: boolean;
  /** Versão do data para invalidar cache de métricas (incrementa quando publica/pausa) */
  perfRefreshKey?: number;
}

function fmtMoneyCents(c: number) {
  return `R$ ${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtInt(n: number) {
  return n.toLocaleString("pt-BR");
}

export function TemplateInfoCard({
  template: t, mode, consultantId, footer,
  onEdit, onTogglePublish, onDelete, onDuplicate, busy, perfRefreshKey,
}: Props) {
  const [photoIdx, setPhotoIdx] = useState(0);
  const [openCopy, setOpenCopy] = useState(false);
  const [openSeg, setOpenSeg] = useState(true);
  const [metrics, setMetrics] = useState<TemplateAggregatedMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    setMetricsLoading(true);
    getTemplateAggregatedMetrics(t.id, { consultantId, days: 30 })
      .then((m) => { if (!cancel) setMetrics(m); })
      .catch(() => { if (!cancel) setMetrics(null); })
      .finally(() => { if (!cancel) setMetricsLoading(false); });
    return () => { cancel = true; };
  }, [t.id, consultantId, perfRefreshKey]);

  const photos = t.photos || [];
  const currentPhoto = photos[photoIdx];

  const distribuidoraChips = useMemo(() => {
    const ids = t.target_distribuidora_ids || [];
    if (ids.length === 0) return [{ id: "all", label: "Todas as distribuidoras", uf: "" }];
    return DISTRIBUIDORAS_PRESETS.filter((p) => ids.includes(p.id))
      .map((p) => ({ id: p.id, label: p.nome, uf: p.uf }));
  }, [t.target_distribuidora_ids]);

  const variantsCount = (t.headline_variants?.length || 0) + (t.primary_text_variants?.length || 0);

  return (
    <Card className="overflow-hidden flex flex-col bg-card border-border/60">
      {/* === HEADER VISUAL === */}
      <div className="relative bg-muted/30">
        {currentPhoto ? (
          <div className={cn("relative mx-auto bg-black/40 overflow-hidden", FORMAT_ASPECT[currentPhoto.format] || "aspect-square")}
               style={{ maxHeight: 360 }}>
            <img src={currentPhoto.url} alt={t.title} className="w-full h-full object-cover" loading="lazy" />
            <Badge variant="secondary" className="absolute top-2 left-2 text-[10px] font-bold bg-background/85 backdrop-blur">
              {FORMAT_LABEL[currentPhoto.format] || currentPhoto.format}
            </Badge>
            <Badge className={cn(
              "absolute top-2 right-2 text-[10px] font-bold",
              t.status === "published" && "bg-primary hover:bg-primary",
              t.status === "draft" && "bg-warning/100 hover:bg-warning/100",
              t.status === "archived" && "bg-muted-foreground hover:bg-muted-foreground",
            )}>
              {t.status === "published" ? "Publicado" : t.status === "draft" ? "Rascunho" : "Arquivado"}
            </Badge>
            {photos.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setPhotoIdx((i) => (i - 1 + photos.length) % photos.length)}
                  className="absolute left-1 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background rounded-full p-1 backdrop-blur"
                  aria-label="Foto anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPhotoIdx((i) => (i + 1) % photos.length)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background rounded-full p-1 backdrop-blur"
                  aria-label="Próxima foto"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                  {photos.map((_, i) => (
                    <span
                      key={i}
                      className={cn("w-1.5 h-1.5 rounded-full transition", i === photoIdx ? "bg-white" : "bg-white/40")}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="aspect-square flex items-center justify-center text-muted-foreground">
            <ImpressionIcon className="w-8 h-8 opacity-40" />
          </div>
        )}
      </div>

      <div className="p-4 space-y-3 flex-1 flex flex-col">
        {/* === TÍTULO + AÇÕES ICÔNICAS === */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-base leading-tight truncate">{t.title}</h3>
            {t.description && (
              <p className="text-[11px] text-muted-foreground truncate">{t.description}</p>
            )}
          </div>
          {mode === "manage" && (
            <div className="flex gap-1 shrink-0">
              {onEdit && (
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit} disabled={busy} title="Editar">
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
              )}
              {onDuplicate && (
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDuplicate} disabled={busy} title="Duplicar como rascunho">
                  <CopyIcon className="w-3.5 h-3.5" />
                </Button>
              )}
              {onTogglePublish && (
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onTogglePublish} disabled={busy}
                  title={t.status === "published" ? "Despublicar" : "Publicar"}>
                  {t.status === "published" ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </Button>
              )}
              {onDelete && (
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete} disabled={busy} title="Apagar">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          )}
        </div>

        {/* === COPY COMPLETA === */}
        <Collapsible open={openCopy} onOpenChange={setOpenCopy}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" /> Copy do anúncio
                {variantsCount > 0 && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">+{variantsCount} variantes A/B</Badge>
                )}
              </span>
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", openCopy && "rotate-180")} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            <div>
              <div className="text-[9px] uppercase font-bold text-muted-foreground mb-0.5">Headline principal</div>
              <p className="text-xs font-semibold text-foreground">{t.headline || <span className="text-muted-foreground italic">vazio</span>}</p>
            </div>
            <div>
              <div className="text-[9px] uppercase font-bold text-muted-foreground mb-0.5">Texto principal</div>
              <p className="text-xs whitespace-pre-line text-foreground/90">{t.primary_text || <span className="text-muted-foreground italic">vazio</span>}</p>
            </div>
            {t.description_text && (
              <div>
                <div className="text-[9px] uppercase font-bold text-muted-foreground mb-0.5">Descrição</div>
                <p className="text-xs text-foreground/80">{t.description_text}</p>
              </div>
            )}
            {(t.headline_variants?.length || 0) > 0 && (
              <div>
                <div className="text-[9px] uppercase font-bold text-muted-foreground mb-1">Headlines alternativas A/B</div>
                <ul className="text-[11px] space-y-0.5 text-foreground/75 list-disc list-inside">
                  {t.headline_variants.map((h, i) => <li key={i}>{h}</li>)}
                </ul>
              </div>
            )}
            {(t.primary_text_variants?.length || 0) > 0 && (
              <div>
                <div className="text-[9px] uppercase font-bold text-muted-foreground mb-1">Textos alternativos A/B</div>
                <ul className="text-[11px] space-y-1 text-foreground/75">
                  {t.primary_text_variants.map((p, i) => (
                    <li key={i} className="border-l-2 border-border pl-2 whitespace-pre-line">{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* === SEGMENTAÇÃO === */}
        <Collapsible open={openSeg} onOpenChange={setOpenSeg}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition">
              <span className="flex items-center gap-1.5"><Target className="w-3 h-3" /> Segmentação</span>
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", openSeg && "rotate-180")} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1.5 pt-2">
            <div className="flex flex-wrap gap-1">
              {distribuidoraChips.map((d) => (
                <Badge key={d.id} variant="outline" className="text-[10px] font-medium">
                  {d.label}{d.uf && <span className="opacity-60 ml-1">{d.uf}</span>}
                </Badge>
              ))}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span><strong className="text-foreground">{t.age_min}–{t.age_max}</strong> anos</span>
              <span>•</span>
              <span>{(t.genders?.length === 0 || t.genders?.length === 2) ? "Todos os gêneros" : t.genders.join(", ")}</span>
              <span>•</span>
              <span><strong className="text-foreground">{fmtMoneyCents(t.suggested_daily_budget_cents)}</strong>/dia sugerido</span>
            </div>
            {(t.target_cidades?.length || 0) > 0 && (
              <div className="text-[10px] text-muted-foreground">
                <strong>{t.target_cidades.length}</strong> cidade(s) específica(s):{" "}
                <span className="text-foreground/70">{t.target_cidades.slice(0, 4).join(", ")}{t.target_cidades.length > 4 ? ` +${t.target_cidades.length - 4}` : ""}</span>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* === PERFORMANCE REAL === */}
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Performance real · últimos 30d
            </div>
            {metrics && metrics.campaigns_count > 0 && (
              <Badge variant="outline" className="text-[9px]">
                {metrics.active_campaigns}/{metrics.campaigns_count} ativa(s)
              </Badge>
            )}
          </div>

          {metricsLoading ? (
            <div className="flex items-center justify-center py-3 text-muted-foreground text-xs">
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Carregando…
            </div>
          ) : !metrics || metrics.campaigns_count === 0 ? (
            <div className="flex items-start gap-2 text-[11px] text-muted-foreground py-1">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{mode === "use" ? "Você ainda não publicou nenhuma campanha com este modelo." : "Nenhum consultor publicou esse modelo ainda."}</span>
            </div>
          ) : !metrics.has_data ? (
            <div className="flex items-start gap-2 text-[11px] text-warning dark:text-warning py-1">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Aguardando primeiros dados da Meta (até 24h após publicar).</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat icon={<DollarSign className="w-3 h-3" />} label="Gasto" value={fmtMoneyCents(metrics.spend_cents)} highlight />
                <Stat icon={<MessageCircle className="w-3 h-3" />} label="Conversas" value={fmtInt(metrics.conversations)} highlight={metrics.conversations > 0} />
                <Stat icon={<Users className="w-3 h-3" />} label="Clientes" value={fmtInt(metrics.customers_acquired)} highlight={metrics.customers_acquired > 0} />
              </div>
              <div className="grid grid-cols-4 gap-2 text-center pt-1 border-t border-border/40">
                <Stat icon={<ImpressionIcon className="w-3 h-3" />} label="Impr." value={fmtInt(metrics.impressions)} small />
                <Stat icon={<MousePointerClick className="w-3 h-3" />} label="Cliques" value={fmtInt(metrics.clicks)} small />
                <Stat label="CTR" value={`${metrics.ctr_pct.toFixed(2)}%`} small />
                <Stat label="CPL" value={metrics.cpl_cents > 0 ? fmtMoneyCents(metrics.cpl_cents) : "—"} small />
              </div>
              {metrics.frequency_avg > 0 && (
                <div className="text-[10px] text-muted-foreground text-center">
                  Frequência média: <strong className={cn(metrics.frequency_avg > 3 && "text-warning")}>{metrics.frequency_avg.toFixed(1)}x</strong>
                  {metrics.frequency_avg > 3 && " (criativo cansado)"}
                </div>
              )}
            </>
          )}
        </div>

        {/* === FOOTER (passado pelo painel) === */}
        {footer && <div className="pt-1">{footer}</div>}
      </div>
    </Card>
  );
}

function Stat({ icon, label, value, highlight, small }: { icon?: ReactNode; label: string; value: string; highlight?: boolean; small?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex items-center gap-1 text-[9px] uppercase font-bold text-muted-foreground">
        {icon}{label}
      </div>
      <div className={cn(small ? "text-[11px]" : "text-sm", "font-bold leading-tight tabular-nums", highlight && "text-primary")}>
        {value}
      </div>
    </div>
  );
}
