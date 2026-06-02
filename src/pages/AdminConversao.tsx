import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useReferralPartners } from "@/components/admin/parceiros/hooks/useReferralPartners";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  ArrowLeft, Loader2, RefreshCw, Flame, Cloud, Snowflake, Skull,
  AlertTriangle, LifeBuoy, Search, Sparkles, MessageSquare, Copy, Zap,
} from "lucide-react";
import { toast } from "sonner";
import AppHeader from "@/components/layout/AppHeader";

type Temp = "hot" | "warm" | "cold" | "dead" | "objection" | "rescue";

const TEMP_META: Record<Temp, { label: string; icon: any; cls: string; bar: string; ring: string }> = {
  hot:       { label: "Quente",  icon: Flame,         cls: "bg-red-500/15 text-red-400 border-red-500/30",       bar: "bg-red-500",    ring: "ring-red-500/40" },
  warm:      { label: "Morno",   icon: Cloud,         cls: "bg-amber-500/15 text-amber-400 border-amber-500/30", bar: "bg-amber-500",  ring: "ring-amber-500/40" },
  cold:      { label: "Frio",    icon: Snowflake,     cls: "bg-blue-500/15 text-blue-400 border-blue-500/30",    bar: "bg-blue-500",   ring: "ring-blue-500/40" },
  dead:      { label: "Morto",   icon: Skull,         cls: "bg-muted text-muted-foreground border-border",       bar: "bg-muted-foreground", ring: "ring-border" },
  objection: { label: "Objeção", icon: AlertTriangle, cls: "bg-orange-500/15 text-orange-400 border-orange-500/30", bar: "bg-orange-500", ring: "ring-orange-500/40" },
  rescue:    { label: "Resgate", icon: LifeBuoy,      cls: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",    bar: "bg-cyan-500",   ring: "ring-cyan-500/40" },
};

interface InsightRow {
  customer_id: string;
  temperature: Temp;
  loss_reason: string | null;
  main_doubt: string | null;
  main_objection: string | null;
  summary: string | null;
  next_action: string | null;
  next_msg_draft: string | null;
  next_msg_template_shortcut: string | null;
  conversion_chance: number | null;
  signals: any;
  classified_at: string;
  needs_reclassify: boolean;
  customer?: {
    name: string | null;
    phone: string | null;
    customer_origin: string | null;
    lead_source: any;
    bot_paused: boolean | null;
    referral_partner_id: string | null;
    referral_keyword_matched: string | null;
  };
}

type OriginFilter = "all" | "meta_ads" | "whatsapp_direct" | "partner";

function originOf(c: InsightRow["customer"]): OriginFilter {
  if (!c) return "all";
  const src = typeof c.lead_source === "string" ? c.lead_source : c.lead_source?.source;
  if (src === "meta_ads") return "meta_ads";
  if (src === "partner") return "partner";
  return "whatsapp_direct";
}

const ORIGIN_LABEL: Record<OriginFilter, string> = {
  all: "Todas",
  meta_ads: "Meta Ads",
  whatsapp_direct: "WhatsApp direto",
  partner: "Parceiro",
};

function initials(name?: string | null) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export default function AdminConversao() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<InsightRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [classifying, setClassifying] = useState<string | null>(null);
  const [bulkClassifying, setBulkClassifying] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [tempFilter, setTempFilter] = useState<Temp | "all">("all");
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<InsightRow | null>(null);
  const cancelBulkRef = useRef(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [partnerFilter, setPartnerFilter] = useState<string>(searchParams.get("partner") || "all");
  const { partners } = useReferralPartners();

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) { navigate("/auth"); return; }
      if (alive) setUserId(uid);
    })();
    return () => { alive = false; };
  }, [navigate]);

  const fetchRows = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("customers" as any)
      .select(`
        id, name, phone_whatsapp, customer_origin, lead_source, bot_paused, last_bot_interaction_at,
        referral_partner_id, referral_keyword_matched,
        lead_insights ( customer_id, temperature, loss_reason, main_doubt, main_objection,
                         summary, next_action, next_msg_draft, next_msg_template_shortcut,
                         conversion_chance, signals, classified_at, needs_reclassify )
      `)
      .eq("consultant_id", userId)
      .or("customer_origin.in.(whatsapp_lead,manual),customer_origin.is.null")
      .order("last_bot_interaction_at", { ascending: false, nullsFirst: false })
      .limit(1000);

    if (error) {
      toast.error("Falha ao carregar leads", { description: error.message });
      setLoading(false);
      return;
    }

    const mapped: InsightRow[] = (data ?? []).map((c: any) => {
      const li = Array.isArray(c.lead_insights) ? c.lead_insights[0] : c.lead_insights;
      const base: InsightRow = li ?? {
        customer_id: c.id,
        temperature: "cold",
        loss_reason: null, main_doubt: null, main_objection: null,
        summary: null, next_action: null, next_msg_draft: null,
        next_msg_template_shortcut: null, conversion_chance: null,
        signals: {}, classified_at: "", needs_reclassify: true,
      };
      return {
        ...base,
        customer: {
          name: c.name,
          phone: c.phone_whatsapp ?? null,
          customer_origin: c.customer_origin,
          lead_source: c.lead_source,
          bot_paused: c.bot_paused,
          referral_partner_id: c.referral_partner_id ?? null,
          referral_keyword_matched: c.referral_keyword_matched ?? null,
        },
      };
    });
    setRows(mapped);
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const counts = useMemo(() => {
    const c: Record<Temp, number> = { hot: 0, warm: 0, cold: 0, dead: 0, objection: 0, rescue: 0 };
    for (const r of rows) if (r.classified_at) c[r.temperature] = (c[r.temperature] || 0) + 1;
    return c;
  }, [rows]);

  const unclassified = rows.filter(r => !r.classified_at).length;
  const totalClassified = rows.filter(r => r.classified_at).length;

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (tempFilter !== "all" && (r.classified_at === "" || r.temperature !== tempFilter)) return false;
      if (originFilter !== "all" && originOf(r.customer) !== originFilter) return false;
      if (partnerFilter !== "all") {
        if (partnerFilter === "none") {
          if (r.customer?.referral_partner_id) return false;
        } else if (r.customer?.referral_partner_id !== partnerFilter) return false;
      }
      if (search.trim()) {
        const s = search.toLowerCase();
        if (!(r.customer?.name ?? "").toLowerCase().includes(s) &&
            !(r.summary ?? "").toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [rows, tempFilter, originFilter, partnerFilter, search]);

  const handlePartnerFilter = (id: string) => {
    setPartnerFilter(id);
    const sp = new URLSearchParams(searchParams);
    if (id === "all") sp.delete("partner"); else sp.set("partner", id);
    setSearchParams(sp, { replace: true });
  };


  const classifyOne = useCallback(async (customerId: string) => {
    setClassifying(customerId);
    try {
      const { data, error } = await supabase.functions.invoke("lead-temperature-classifier", {
        body: { customer_id: customerId },
      });
      if (error) throw error;
      toast.success("Lead reclassificado", { description: data?.results?.[0]?.temperature ?? "ok" });
      await fetchRows();
    } catch (e: any) {
      toast.error("Falha ao classificar", { description: e.message });
    } finally {
      setClassifying(null);
    }
  }, [fetchRows]);

  const classifyAllUnclassified = useCallback(async () => {
    if (!userId) return;
    const total = unclassified;
    if (total === 0) {
      toast.info("Nada para classificar");
      return;
    }
    setBulkClassifying(true);
    cancelBulkRef.current = false;
    setBulkProgress({ done: 0, total });
    let done = 0;
    try {
      // loops chamando a função (25 por chamada) até esvaziar
      for (let i = 0; i < 50; i++) {
        if (cancelBulkRef.current) break;
        const { data, error } = await supabase.functions.invoke("lead-temperature-classifier", {
          body: { consultant_id: userId, scope: "all_unclassified" },
        });
        if (error) throw error;
        const results = (data?.results ?? []) as any[];
        const effective = results.filter(r => r?.temperature).length;
        const firstError = results.find(r => r?.error)?.error as string | undefined;
        const hadRateLimit = results.some(r => r?.error === "rate_limited" || r?.error === "no_credits");
        done += effective;
        setBulkProgress({ done: Math.min(done, total), total });
        await fetchRows();
        if (effective === 0) {
          if (firstError) toast.error("Classificador falhou", { description: firstError });
          break;
        }
        if (hadRateLimit) {
          toast.warning("Pausado por limite da IA", { description: "Tente novamente em alguns minutos." });
          break;
        }
        // pequena pausa para não estourar rate-limit
        await new Promise(r => setTimeout(r, 400));
      }
      toast.success(`${done} leads classificados`);
    } catch (e: any) {
      toast.error("Falha no batch", { description: e.message });
    } finally {
      setBulkClassifying(false);
      setBulkProgress(null);
    }
  }, [userId, unclassified, fetchRows]);

  const classifyStale = useCallback(async () => {
    if (!userId) return;
    setBulkClassifying(true);
    try {
      const { data, error } = await supabase.functions.invoke("lead-temperature-classifier", {
        body: { consultant_id: userId, scope: "stale_24h" },
      });
      if (error) throw error;
      toast.success(`${data?.processed ?? 0} leads reclassificados`);
      await fetchRows();
    } catch (e: any) {
      toast.error("Falha", { description: e.message });
    } finally {
      setBulkClassifying(false);
    }
  }, [userId, fetchRows]);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Central de Conversão" subtitle="Modo análise — nenhuma mensagem é enviada automaticamente" />

      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchRows} disabled={loading || bulkClassifying}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Recarregar
            </Button>
            {unclassified > 0 ? (
              <Button size="sm" onClick={classifyAllUnclassified} disabled={bulkClassifying} className="gap-1.5">
                {bulkClassifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Classificar {unclassified} não classificados
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={classifyStale} disabled={bulkClassifying} className="gap-1.5">
                {bulkClassifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Reclassificar antigos (24h)
              </Button>
            )}
          </div>
        </div>

        {/* Hero — não classificados */}
        {unclassified > 0 && (
          <Card className="p-5 border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="h-12 w-12 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                <Sparkles className="h-6 w-6 text-amber-400" />
              </div>
              <div className="flex-1 min-w-[200px]">
                <div className="text-2xl font-semibold text-amber-100">
                  {unclassified} {unclassified === 1 ? "lead aguardando" : "leads aguardando"} classificação
                </div>
                <div className="text-xs text-amber-200/70 mt-0.5">
                  A IA vai analisar a conversa, definir temperatura e sugerir a próxima mensagem.
                </div>
              </div>
              {!bulkClassifying && (
                <Button onClick={classifyAllUnclassified} className="gap-1.5">
                  <Zap className="h-4 w-4" /> Classificar todos agora
                </Button>
              )}
            </div>
            {bulkProgress && (
              <div className="mt-4 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-amber-200/80">
                  <span>Classificando com IA…</span>
                  <span className="font-mono">{bulkProgress.done}/{bulkProgress.total}</span>
                </div>
                <Progress value={(bulkProgress.done / Math.max(1, bulkProgress.total)) * 100} className="h-1.5" />
              </div>
            )}
          </Card>
        )}

        {/* KPI cards por temperatura */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <button
            onClick={() => setTempFilter("all")}
            className={`p-3 rounded-xl border text-left transition ${
              tempFilter === "all"
                ? "bg-primary/10 border-primary/40 ring-1 ring-primary/30"
                : "bg-card border-border/40 hover:border-border"
            }`}
          >
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Todos</div>
            <div className="text-2xl font-semibold text-foreground mt-0.5">{totalClassified}</div>
          </button>
          {(Object.keys(TEMP_META) as Temp[]).map(t => {
            const M = TEMP_META[t];
            const Icon = M.icon;
            const active = tempFilter === t;
            return (
              <button
                key={t}
                onClick={() => setTempFilter(active ? "all" : t)}
                className={`p-3 rounded-xl border text-left transition group ${
                  active ? `${M.cls} ring-1 ${M.ring}` : "bg-card border-border/40 hover:border-border"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className={`text-[10px] uppercase tracking-wide ${active ? "" : "text-muted-foreground"}`}>{M.label}</div>
                  <Icon className={`h-3.5 w-3.5 ${active ? "" : "text-muted-foreground group-hover:text-foreground"}`} />
                </div>
                <div className="text-2xl font-semibold mt-0.5">{counts[t]}</div>
              </button>
            );
          })}
        </div>

        {/* Filtros origem + busca */}
        <div className="flex flex-wrap gap-2 items-center bg-card/40 border border-border/40 rounded-lg p-2.5">
          <span className="text-[10px] uppercase text-muted-foreground mr-1 px-1">Origem</span>
          {(Object.keys(ORIGIN_LABEL) as OriginFilter[]).map(o => (
            <button
              key={o}
              onClick={() => setOriginFilter(o)}
              className={`px-2.5 py-1 rounded-md border text-[11px] transition ${
                originFilter === o ? "bg-primary/10 border-primary/30 text-primary" : "bg-card border-border/40 text-muted-foreground hover:border-border"
              }`}
            >
              {ORIGIN_LABEL[o]}
            </button>
          ))}
          <div className="relative ml-auto">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar nome / resumo"
              className="pl-7 h-8 w-64 text-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Tabela */}
        <Card className="overflow-hidden">
          {loading ? (
            <div className="p-12 text-center">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-16 text-center">
              <div className="h-14 w-14 rounded-2xl bg-muted/40 border border-border/40 flex items-center justify-center mx-auto mb-3">
                <Sparkles className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="text-sm text-muted-foreground">Nenhum lead com esses filtros.</div>
              {unclassified > 0 && (
                <Button size="sm" className="mt-4 gap-1.5" onClick={classifyAllUnclassified} disabled={bulkClassifying}>
                  <Zap className="h-3.5 w-3.5" /> Classificar {unclassified} agora
                </Button>
              )}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/30 border-b border-border/40">
                <tr className="text-left text-[10px] uppercase text-muted-foreground">
                  <th className="px-4 py-2.5">Lead</th>
                  <th className="px-3 py-2.5">Origem</th>
                  <th className="px-3 py-2.5">Temp</th>
                  <th className="px-3 py-2.5 w-40">Chance</th>
                  <th className="px-3 py-2.5">Próxima ação</th>
                  <th className="px-3 py-2.5 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const isClassified = !!r.classified_at;
                  const M = isClassified ? TEMP_META[r.temperature] : null;
                  const Icon = M?.icon;
                  const origin = originOf(r.customer);
                  const chance = r.conversion_chance ?? 0;
                  return (
                    <tr
                      key={r.customer_id}
                      className={`border-b border-border/30 hover:bg-muted/30 cursor-pointer transition-colors ${
                        !isClassified ? "bg-amber-500/[0.04]" : ""
                      }`}
                      onClick={() => setSelected(r)}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-medium border ${M ? M.cls : "bg-muted/40 text-muted-foreground border-border/40"}`}>
                            {initials(r.customer?.name)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-foreground truncate max-w-[180px]">{r.customer?.name || "(sem nome)"}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {isClassified ? `classificado ${new Date(r.classified_at).toLocaleDateString("pt-BR")}` : "não classificado"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-border/40 bg-muted/40 text-muted-foreground">
                          {ORIGIN_LABEL[origin]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {M && Icon ? (
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] ${M.cls}`}>
                            <Icon className="h-3 w-3" /> {M.label}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {isClassified && r.conversion_chance != null ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-muted/60 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${M?.bar ?? "bg-muted-foreground"} transition-all`}
                                style={{ width: `${Math.max(2, Math.min(100, chance))}%` }}
                              />
                            </div>
                            <span className="font-mono text-[11px] text-foreground/80 w-8 text-right">{chance}%</span>
                          </div>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground truncate max-w-[280px]">{r.next_action || "—"}</td>
                      <td className="px-3 py-2.5 text-right">
                        <Button
                          size="sm" variant={isClassified ? "ghost" : "default"} className="h-7 text-[10px]"
                          onClick={(e) => { e.stopPropagation(); classifyOne(r.customer_id); }}
                          disabled={classifying === r.customer_id}
                        >
                          {classifying === r.customer_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                          <span className="ml-1">IA</span>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* Drawer detalhe */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {selected.customer?.name || "Lead"}
                  {selected.classified_at && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${TEMP_META[selected.temperature].cls}`}>
                      {TEMP_META[selected.temperature].label}
                    </span>
                  )}
                </SheetTitle>
                <SheetDescription>
                  {ORIGIN_LABEL[originOf(selected.customer)]}
                  {selected.conversion_chance != null && ` · ${selected.conversion_chance}% de chance`}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-5 space-y-4 text-sm">
                {!selected.classified_at ? (
                  <div className="p-4 rounded-lg border border-dashed border-border bg-muted/20 text-center text-muted-foreground text-xs">
                    Lead ainda não classificado.
                    <Button size="sm" className="mt-3 w-full" onClick={() => classifyOne(selected.customer_id)} disabled={classifying === selected.customer_id}>
                      {classifying === selected.customer_id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                      Analisar agora
                    </Button>
                  </div>
                ) : (
                  <>
                    {selected.summary && (
                      <div className="border-l-2 border-primary/40 pl-3">
                        <div className="text-[10px] uppercase text-muted-foreground mb-1">Resumo</div>
                        <p className="text-foreground">{selected.summary}</p>
                      </div>
                    )}
                    {selected.main_doubt && (
                      <div className="border-l-2 border-blue-500/40 pl-3">
                        <div className="text-[10px] uppercase text-muted-foreground mb-1">Dúvida principal</div>
                        <p>{selected.main_doubt}</p>
                      </div>
                    )}
                    {selected.main_objection && (
                      <div className="border-l-2 border-orange-500/40 pl-3">
                        <div className="text-[10px] uppercase text-muted-foreground mb-1">Objeção</div>
                        <p className="text-orange-300">{selected.main_objection}</p>
                      </div>
                    )}
                    {selected.loss_reason && (
                      <div className="border-l-2 border-red-500/40 pl-3">
                        <div className="text-[10px] uppercase text-muted-foreground mb-1">Por que está parando</div>
                        <p className="text-red-300/90">{selected.loss_reason}</p>
                      </div>
                    )}
                    <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                      <div className="text-[10px] uppercase text-primary mb-1">Próxima ação</div>
                      <p className="font-medium text-foreground">{selected.next_action}</p>
                      {selected.next_msg_template_shortcut && (
                        <Badge variant="outline" className="mt-2 text-[10px]">template {selected.next_msg_template_shortcut}</Badge>
                      )}
                    </div>
                    {selected.next_msg_draft && (
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground mb-1">
                          Mensagem sugerida (revise antes de enviar)
                        </div>
                        <div className="p-3 rounded-lg bg-muted/40 border border-border/40 whitespace-pre-wrap text-foreground">
                          {selected.next_msg_draft}
                        </div>
                        <Button
                          size="sm" className="mt-2 w-full gap-1.5"
                          onClick={() => {
                            navigator.clipboard.writeText(selected.next_msg_draft!);
                            toast.success("Mensagem copiada");
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" /> Copiar mensagem
                        </Button>
                      </div>
                    )}
                  </>
                )}

                <div className="pt-2 border-t border-border/40 flex gap-2">
                  <Button
                    variant="outline" size="sm" className="flex-1"
                    onClick={() => navigate(`/admin?tab=whatsapp&phone=${selected.customer?.phone ?? ""}`)}
                  >
                    <MessageSquare className="h-3.5 w-3.5 mr-1" /> Abrir chat
                  </Button>
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => classifyOne(selected.customer_id)}
                    disabled={classifying === selected.customer_id}
                  >
                    {classifying === selected.customer_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
