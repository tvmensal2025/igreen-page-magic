import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  ArrowLeft, Loader2, RefreshCw, Flame, Cloud, Snowflake, Skull,
  AlertTriangle, LifeBuoy, Search, Sparkles, MessageSquare, Copy,
} from "lucide-react";
import { toast } from "sonner";
import AppHeader from "@/components/layout/AppHeader";

type Temp = "hot" | "warm" | "cold" | "dead" | "objection" | "rescue";

const TEMP_META: Record<Temp, { label: string; icon: any; cls: string }> = {
  hot:       { label: "Quente",     icon: Flame,         cls: "bg-red-500/15 text-red-400 border-red-500/30" },
  warm:      { label: "Morno",      icon: Cloud,         cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  cold:      { label: "Frio",       icon: Snowflake,     cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  dead:      { label: "Morto",      icon: Skull,         cls: "bg-muted text-muted-foreground border-border" },
  objection: { label: "Objeção",    icon: AlertTriangle, cls: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  rescue:    { label: "Resgate",    icon: LifeBuoy,      cls: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" },
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

export default function AdminConversao() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<InsightRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [classifying, setClassifying] = useState<string | null>(null);
  const [bulkClassifying, setBulkClassifying] = useState(false);
  const [tempFilter, setTempFilter] = useState<Temp | "all">("all");
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<InsightRow | null>(null);

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
    // Pega últimas 200 mensagens recentes (últimos 60d) com insights
    const { data, error } = await supabase
      .from("customers" as any)
      .select(`
        id, name, phone_whatsapp, customer_origin, lead_source, bot_paused, last_bot_interaction_at,
        lead_insights ( customer_id, temperature, loss_reason, main_doubt, main_objection,
                         summary, next_action, next_msg_draft, next_msg_template_shortcut,
                         conversion_chance, signals, classified_at, needs_reclassify )
      `)
      .eq("consultant_id", userId)
      .order("last_bot_interaction_at", { ascending: false, nullsFirst: false })
      .limit(300);

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

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (tempFilter !== "all" && r.temperature !== tempFilter) return false;
      if (originFilter !== "all" && originOf(r.customer) !== originFilter) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        if (!(r.customer?.name ?? "").toLowerCase().includes(s) &&
            !(r.summary ?? "").toLowerCase().includes(s)) return false;
      }
      return r.classified_at !== "" || tempFilter === "all";
    });
  }, [rows, tempFilter, originFilter, search]);

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

  const classifyBatch = useCallback(async () => {
    if (!userId) return;
    setBulkClassifying(true);
    try {
      const { data, error } = await supabase.functions.invoke("lead-temperature-classifier", {
        body: { consultant_id: userId, scope: "stale_24h" },
      });
      if (error) throw error;
      toast.success(`${data?.processed ?? 0} leads classificados`);
      await fetchRows();
    } catch (e: any) {
      toast.error("Falha no batch", { description: e.message });
    } finally {
      setBulkClassifying(false);
    }
  }, [userId, fetchRows]);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Central de Conversão" subtitle="Modo análise — nenhuma mensagem é enviada automaticamente" />

      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchRows} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Recarregar
            </Button>
            <Button size="sm" onClick={classifyBatch} disabled={bulkClassifying}>
              {bulkClassifying ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
              Classificar com IA (lote)
            </Button>
          </div>
        </div>

        {/* Banner de aviso modo ajuste */}
        <Card className="p-3 border-amber-500/30 bg-amber-500/5 text-xs text-amber-200">
          ⚠️ <strong>Modo ajuste ativo.</strong> A IA analisa e sugere a próxima mensagem,
          mas <u>não envia nada sozinha</u>. Você clica, copia e dispara manualmente no chat.
        </Card>

        {/* Chips de temperatura */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setTempFilter("all")}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition ${tempFilter === "all" ? "bg-primary/15 border-primary/40 text-primary" : "bg-card border-border/40 text-muted-foreground hover:border-border"}`}
          >
            Todos {rows.filter(r => r.classified_at).length}
          </button>
          {(Object.keys(TEMP_META) as Temp[]).map(t => {
            const M = TEMP_META[t];
            const Icon = M.icon;
            const active = tempFilter === t;
            return (
              <button
                key={t}
                onClick={() => setTempFilter(t)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition flex items-center gap-1.5 ${active ? M.cls : "bg-card border-border/40 text-muted-foreground hover:border-border"}`}
              >
                <Icon className="h-3.5 w-3.5" /> {M.label} {counts[t]}
              </button>
            );
          })}
          {unclassified > 0 && (
            <Badge variant="outline" className="ml-auto text-[10px]">
              {unclassified} ainda não classificados
            </Badge>
          )}
        </div>

        {/* Filtros origem + busca */}
        <div className="flex flex-wrap gap-2 items-center">
          {(Object.keys(ORIGIN_LABEL) as OriginFilter[]).map(o => (
            <button
              key={o}
              onClick={() => setOriginFilter(o)}
              className={`px-2.5 py-1 rounded-md border text-[11px] transition ${originFilter === o ? "bg-primary/10 border-primary/30 text-primary" : "bg-card border-border/40 text-muted-foreground hover:border-border"}`}
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
            <div className="p-12 text-center text-sm text-muted-foreground">
              Nenhum lead encontrado com esses filtros.
              {rows.filter(r => !r.classified_at).length > 0 && (
                <div className="mt-3 text-xs">
                  Você tem {unclassified} leads não classificados — clique em <strong>Classificar com IA</strong> acima.
                </div>
              )}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/30 border-b border-border/40">
                <tr className="text-left text-[10px] uppercase text-muted-foreground">
                  <th className="px-3 py-2">Lead</th>
                  <th className="px-3 py-2">Origem</th>
                  <th className="px-3 py-2">Temp</th>
                  <th className="px-3 py-2">Chance</th>
                  <th className="px-3 py-2">Próxima ação</th>
                  <th className="px-3 py-2 w-32"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const M = r.classified_at ? TEMP_META[r.temperature] : null;
                  const Icon = M?.icon;
                  const origin = originOf(r.customer);
                  return (
                    <tr
                      key={r.customer_id}
                      className="border-b border-border/30 hover:bg-muted/30 cursor-pointer"
                      onClick={() => setSelected(r)}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground truncate max-w-[180px]">{r.customer?.name || "(sem nome)"}</div>
                        <div className="text-[10px] text-muted-foreground">{r.classified_at ? `classificado ${new Date(r.classified_at).toLocaleDateString("pt-BR")}` : "não classificado"}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-border/40 bg-muted/40 text-muted-foreground">
                          {ORIGIN_LABEL[origin]}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {M && Icon ? (
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] ${M.cls}`}>
                            <Icon className="h-3 w-3" /> {M.label}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.conversion_chance != null ? (
                          <span className="font-mono text-[11px]">{r.conversion_chance}%</span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground truncate max-w-[280px]">{r.next_action || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm" variant="ghost" className="h-7 text-[10px]"
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
                    <Button size="sm" className="mt-3 w-full" onClick={() => classifyOne(selected.customer_id)}>
                      <Sparkles className="h-3.5 w-3.5 mr-1" /> Analisar agora
                    </Button>
                  </div>
                ) : (
                  <>
                    {selected.summary && (
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground mb-1">Resumo</div>
                        <p className="text-foreground">{selected.summary}</p>
                      </div>
                    )}
                    {selected.main_doubt && (
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground mb-1">Dúvida principal</div>
                        <p>{selected.main_doubt}</p>
                      </div>
                    )}
                    {selected.main_objection && (
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground mb-1">Objeção</div>
                        <p className="text-orange-300">{selected.main_objection}</p>
                      </div>
                    )}
                    {selected.loss_reason && (
                      <div>
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
                        <div className="text-[10px] uppercase text-muted-foreground mb-1 flex items-center justify-between">
                          <span>Mensagem sugerida (revise antes de enviar)</span>
                          <Button
                            size="sm" variant="ghost" className="h-6 text-[10px] px-2"
                            onClick={() => {
                              navigator.clipboard.writeText(selected.next_msg_draft!);
                              toast.success("Copiado");
                            }}
                          >
                            <Copy className="h-3 w-3 mr-1" /> Copiar
                          </Button>
                        </div>
                        <div className="p-3 rounded-lg bg-muted/40 border border-border/40 whitespace-pre-wrap">
                          {selected.next_msg_draft}
                        </div>
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
