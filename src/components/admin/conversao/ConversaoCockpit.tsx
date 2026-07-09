import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useReferralPartners } from "@/components/admin/parceiros/hooks/useReferralPartners";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Loader2, RefreshCw, Flame, Cloud, Snowflake, Skull, AlertTriangle,
  LifeBuoy, Search, Sparkles, Zap, Send, MessageSquare, BellOff, Clock, TrendingUp,
  ListOrdered, MessageSquareText, Settings2, BarChart3, CheckSquare, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  priorityScore, priorityTier, TIER_META, formatStuck, type Temp,
} from "./score";
import { stepLabel, loadFlowTitles } from "./stepLabels";
import { ConversaoLeadDrawer } from "./ConversaoLeadDrawer";
import { FrasesPanel } from "./FrasesPanel";
import { ConfigPanel } from "./ConfigPanel";
import { ResultadosPanel } from "./ResultadosPanel";

const TEMP_META: Record<Temp, { label: string; icon: any; cls: string }> = {
  hot:       { label: "Quente",  icon: Flame,         cls: "bg-destructive/15 text-destructive border-destructive/30" },
  warm:      { label: "Morno",   icon: Cloud,         cls: "bg-warning/15 text-warning border-warning/30" },
  cold:      { label: "Frio",    icon: Snowflake,     cls: "bg-info/15 text-info border-info/30" },
  dead:      { label: "Morto",   icon: Skull,         cls: "bg-muted text-muted-foreground border-border" },
  objection: { label: "Objeção", icon: AlertTriangle, cls: "bg-warning/15 text-warning border-warning/30" },
  rescue:    { label: "Resgate", icon: LifeBuoy,      cls: "bg-info/15 text-info border-info/30" },
};

export interface LeadRow {
  customer_id: string;
  name: string | null;
  phone: string | null;
  bill_value: number | null;
  bot_paused: boolean | null;
  hours_stuck: number | null;
  inbound_count: number | null;
  referral_partner_id: string | null;
  lead_source: any;
  conversation_step: string | null;
  // insight (pode estar vazio)
  temperature: Temp | null;
  conversion_chance: number | null;
  summary: string | null;
  main_doubt: string | null;
  main_objection: string | null;
  loss_reason: string | null;
  next_action: string | null;
  next_msg_draft: string | null;
  classified_at: string | null;
  classification_source: string | null;
  // derivado
  score: number;
}

const SOURCE_LABEL: Record<string, string> = {
  rules: "Regras",
  ai_lite: "IA lite",
  ai_full: "IA full",
  cache: "Cache",
};

type OriginFilter = "all" | "meta_ads" | "whatsapp_direct" | "partner";

function originOf(lead_source: any): OriginFilter {
  const src = typeof lead_source === "string" ? lead_source : lead_source?.source;
  if (src === "meta_ads") return "meta_ads";
  if (src === "partner") return "partner";
  return "whatsapp_direct";
}

function initials(name?: string | null) {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

function brl(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

interface Props {
  consultantId: string;
  initialView?: string;
  onViewConsumed?: () => void;
}

export function ConversaoCockpit({ consultantId, initialView, onViewConsumed }: Props) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [classifying, setClassifying] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [tempFilter, setTempFilter] = useState<Temp | "all">("all");
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
  const [partnerFilter, setPartnerFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<LeadRow | null>(null);
  const [bulkStale, setBulkStale] = useState(false);
  const [flowTitles, setFlowTitles] = useState<Map<string, string>>(new Map());
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchSending, setBatchSending] = useState<{ done: number; total: number } | null>(null);
  const [activeView, setActiveView] = useState<string>(initialView || "fila");
  const [searchParams] = useSearchParams();
  const { partners } = useReferralPartners();

  useEffect(() => {
    if (!initialView) return;
    setActiveView(initialView);
    onViewConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialView]);
  // Dispara a classificação sob demanda uma única vez por consultor ao abrir a
  // Central. Evita o trabalho ocioso do cron periódico: só processa quando
  // alguém realmente abre a tela.
  const autoClassifiedFor = useRef<string | null>(null);

  // ─── Data ────────────────────────────────────────────────────────────────
  const fetchRows = useCallback(async () => {
    if (!consultantId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("customers" as any)
      .select(`
        id, name, phone_whatsapp, customer_origin, lead_source, bot_paused,
        last_bot_interaction_at, created_at, electricity_bill_value, referral_partner_id, conversation_step,
        igreen_code, data_ativo, data_validado, data_cadastro, andamento_igreen, assinatura_cliente, pos_venda_stage,
        lead_insights ( temperature, conversion_chance, summary, main_doubt, main_objection,
                        loss_reason, next_action, next_msg_draft, classified_at, classification_source )
      `)
      .eq("consultant_id", consultantId)
      .is("data_ativo", null)
      .is("data_validado", null)
      .order("last_bot_interaction_at", { ascending: false, nullsFirst: false })
      .limit(1000);

    if (error) {
      toast.error("Falha ao carregar leads", { description: error.message });
      setLoading(false);
      return;
    }

    const now = Date.now();
    const customerIds = (data ?? []).map((c: any) => c.id as string);
    const inboundMap = new Map<string, number>();
    if (customerIds.length > 0) {
      const { data: counts, error: countErr } = await (supabase as any).rpc("count_inbound_messages", {
        p_customer_ids: customerIds,
      });
      if (countErr) {
        // Sem inbound_count o score perde o boost de engajamento, mas a fila
        // continua utilizável. Avisa discretamente em vez de falhar silencioso.
        console.warn("[conversao] count_inbound_messages falhou:", countErr.message);
        toast.warning("Engajamento indisponível", {
          description: "Aplique a migration de conversão para ordenar por mensagens.",
        });
      }
      for (const row of (counts as { customer_id: string; cnt: number }[]) ?? []) {
        inboundMap.set(row.customer_id, Number(row.cnt));
      }
    }

    // Só entra no Conversão quem já iniciou conversa (last_bot_interaction_at
    // ou pelo menos uma mensagem em `conversations`).
    const convSet = new Set<string>();
    if (customerIds.length > 0) {
      const { data: convRows } = await supabase
        .from("conversations" as any)
        .select("customer_id")
        .in("customer_id", customerIds);
      for (const row of (convRows as unknown as { customer_id: string }[]) ?? []) {
        convSet.add(row.customer_id);
      }
    }

    const CLIENT_STATUSES = new Set(["ativo", "aprovado", "validado", "licenciada", "licenciado"]);
    const SUB_TRUTHY = new Set(["true", "t", "sim", "yes", "1"]);
    const filteredData = (data ?? []).filter((c: any) => {
      const started = !!c.last_bot_interaction_at || convSet.has(c.id);
      if (!started) return false;
      const s = (c.andamento_igreen ?? "").toString().trim().toLowerCase();
      if (CLIENT_STATUSES.has(s)) return false;
      const sub = (c.assinatura_cliente ?? "").toString().trim().toLowerCase();
      if (SUB_TRUTHY.has(sub)) return false;
      return true;
    });
    const mapped: LeadRow[] = filteredData.map((c: any) => {
      const li = Array.isArray(c.lead_insights) ? c.lead_insights[0] : c.lead_insights;
      const ref = c.last_bot_interaction_at || c.created_at;
      const hours = ref ? (now - new Date(ref).getTime()) / 3_600_000 : null;
      const inboundCount = inboundMap.get(c.id) ?? null;
      const base: LeadRow = {
        customer_id: c.id,
        name: c.name,
        phone: c.phone_whatsapp ?? null,
        bill_value: c.electricity_bill_value != null ? Number(c.electricity_bill_value) : null,
        bot_paused: c.bot_paused,
        hours_stuck: hours,
        inbound_count: inboundCount,
        referral_partner_id: c.referral_partner_id ?? null,
        lead_source: c.lead_source,
        conversation_step: c.conversation_step ?? null,
        temperature: (li?.temperature as Temp) ?? null,
        conversion_chance: li?.conversion_chance ?? null,
        summary: li?.summary ?? null,
        main_doubt: li?.main_doubt ?? null,
        main_objection: li?.main_objection ?? null,
        loss_reason: li?.loss_reason ?? null,
        next_action: li?.next_action ?? null,
        next_msg_draft: li?.next_msg_draft ?? null,
        classified_at: li?.classified_at ?? null,
        classification_source: li?.classification_source ?? null,
        score: 0,
      };
      base.score = priorityScore({
        temperature: base.temperature,
        conversionChance: base.conversion_chance,
        billValue: base.bill_value,
        hoursStuck: base.hours_stuck,
        inboundCount: base.inbound_count,
      });
      return base;
    });
    setRows(mapped);
    const steps = mapped.map((r) => r.conversation_step).filter(Boolean) as string[];
    loadFlowTitles(steps).then(setFlowTitles);
    setLoading(false);
  }, [consultantId]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  useEffect(() => {
    const p = searchParams.get("partner");
    if (p) setPartnerFilter(p);
  }, [searchParams]);

  // ─── Métricas do topo ──────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const classified = rows.filter((r) => r.classified_at);
    const unclassified = rows.length - classified.length;
    const hotStuck = rows.filter(
      (r) => (r.temperature === "hot" || r.temperature === "rescue") && r.bot_paused,
    );
    const revenueAtStake = rows
      .filter((r) => (r.temperature === "hot" || r.temperature === "rescue") && r.bill_value)
      .reduce((s, r) => s + (r.bill_value ?? 0), 0);
    const avgChance = classified.length
      ? Math.round(classified.reduce((s, r) => s + (r.conversion_chance ?? 0), 0) / classified.length)
      : 0;
    return { total: rows.length, classified: classified.length, unclassified, hotStuck: hotStuck.length, revenueAtStake, avgChance };
  }, [rows]);

  // ─── Filtros + ordenação por score ──────────────────────────────────────────
  const partnerOptions: ComboboxOption[] = useMemo(() => [
    { value: "all", label: "Todos os parceiros" },
    { value: "none", label: "Sem parceiro" },
    ...partners.map((p) => ({ value: p.id, label: p.nome })),
  ], [partners]);

  const filtered = useMemo(() => {
    const out = rows.filter((r) => {
      if (tempFilter !== "all" && r.temperature !== tempFilter) return false;
      if (originFilter !== "all" && originOf(r.lead_source) !== originFilter) return false;
      if (partnerFilter === "none" && r.referral_partner_id) return false;
      if (partnerFilter !== "all" && partnerFilter !== "none" && r.referral_partner_id !== partnerFilter) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        if (!(r.name ?? "").toLowerCase().includes(s) && !(r.summary ?? "").toLowerCase().includes(s)) return false;
      }
      return true;
    });
    return out.sort((a, b) => b.score - a.score);
  }, [rows, tempFilter, originFilter, partnerFilter, search]);

  const tempCounts = useMemo(() => {
    const c: Record<Temp, number> = { hot: 0, warm: 0, cold: 0, dead: 0, objection: 0, rescue: 0 };
    for (const r of rows) if (r.temperature) c[r.temperature]++;
    return c;
  }, [rows]);

  // Etapas presentes na base (para o painel de Frases sugerir).
  const availableSteps = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.conversation_step) set.add(r.conversation_step);
    return Array.from(set);
  }, [rows]);

  // ─── Ações IA ────────────────────────────────────────────────────────────────
  const classifyOne = useCallback(async (customerId: string) => {
    setClassifying(customerId);
    try {
      const { data, error } = await supabase.functions.invoke("lead-temperature-classifier", {
        body: { customer_id: customerId },
      });
      if (error) throw error;
      const src = (data?.results?.[0]?.source ?? data?.results?.[0]?.skipped) as string | undefined;
      const label = src === "rules" ? "por regras (0 tokens)"
        : src === "ai_lite" ? "com IA"
        : src === "cache" ? "(sem mudança)"
        : "";
      toast.success(`Lead reclassificado ${label}`.trim());
      await fetchRows();
    } catch (e: any) {
      toast.error("Falha ao classificar", { description: e.message });
    } finally {
      setClassifying(null);
    }
  }, [fetchRows]);

  const classifyStale = useCallback(async () => {
    setBulkStale(true);
    try {
      const { data, error } = await supabase.functions.invoke("lead-temperature-classifier", {
        body: { consultant_id: consultantId, scope: "stale_24h" },
      });
      if (error) throw error;
      const stats = data?.stats;
      toast.success(`${data?.processed ?? 0} leads reclassificados`, {
        description: stats ? `${stats.rules ?? 0} por regras, ${stats.ai_lite ?? 0} IA lite` : undefined,
      });
      await fetchRows();
    } catch (e: any) {
      toast.error("Falha ao reclassificar", { description: e.message });
    } finally {
      setBulkStale(false);
    }
  }, [consultantId, fetchRows]);

  const classifyAll = useCallback(async () => {
    if (metrics.unclassified === 0) { toast.info("Nada para classificar"); return; }
    const total = metrics.unclassified;
    setBulk({ done: 0, total });
    let done = 0;
    try {
      for (let i = 0; i < 50; i++) {
        const { data, error } = await supabase.functions.invoke("lead-temperature-classifier", {
          body: { consultant_id: consultantId, scope: "all_unclassified" },
        });
        if (error) throw error;
        const results = (data?.results ?? []) as any[];
        const eff = results.filter((r) => r?.temperature).length;
        done += eff;
        setBulk({ done: Math.min(done, total), total });
        await fetchRows();
        if (eff === 0) break;
        if (results.some((r) => r?.error === "rate_limited" || r?.error === "no_credits")) {
          toast.warning("Pausado por limite da IA. Tente em alguns minutos.");
          break;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      toast.success(`${done} leads classificados`);
    } catch (e: any) {
      toast.error("Falha no lote", { description: e.message });
    } finally {
      setBulk(null);
    }
  }, [consultantId, metrics.unclassified, fetchRows]);


  // ─── Classificação sob demanda ao abrir a Central ───────────────────────────
  // Em vez de um cron periódico processar todos os leads o tempo todo (gasto
  // ocioso quando ninguém está olhando), classifica só quando o consultor abre
  // a tela. Top 25 por prioridade (score) garante abertura rápida; o restante
  // fica para o botão manual ou para a rede de segurança do cron diário.
  // Dispara uma única vez por consultor por sessão (autoClassifiedFor).
  const autoClassifyOnOpen = useCallback(async () => {
    // Pega os pendentes (sem classificação) já ordenados por prioridade.
    const pending = rows
      .filter((r) => !r.classified_at)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25)
      .map((r) => r.customer_id);
    if (pending.length === 0) return;
    setBulk({ done: 0, total: pending.length });
    try {
      const { data, error } = await supabase.functions.invoke("lead-temperature-classifier", {
        body: { customer_ids: pending },
      });
      if (error) throw error;
      const results = (data?.results ?? []) as any[];
      const eff = results.filter((r) => r?.temperature).length;
      setBulk({ done: eff, total: pending.length });
      await fetchRows();
    } catch {
      // Silencioso: a classificação sob demanda é conveniência, não bloqueia a
      // tela. O consultor ainda pode classificar manualmente.
    } finally {
      setBulk(null);
    }
  }, [rows, fetchRows]);

  useEffect(() => {
    // Espera o primeiro carregamento terminar e roda uma vez por consultor.
    if (loading || !consultantId) return;
    if (autoClassifiedFor.current === consultantId) return;
    autoClassifiedFor.current = consultantId;
    void autoClassifyOnOpen();
  }, [loading, consultantId, autoClassifyOnOpen]);

  // ─── Seleção + envio em lote ────────────────────────────────────────────────
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const selectAllFiltered = useCallback(() => {
    setSelectedIds(new Set(filtered.map((r) => r.customer_id)));
  }, [filtered]);

  // Envia o template de reaquecimento da etapa de cada lead selecionado.
  // Fatiado client-side em chunks de 20 (a edge function dorme ~5s entre
  // envios; um único request com centenas de leads estouraria o timeout).
  const CHUNK = 20;
  const sendBatch = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length < 2) {
      toast.info("Selecione ao menos 2 leads para o envio em lote");
      return;
    }
    const batchId = crypto.randomUUID();
    setBatchSending({ done: 0, total: ids.length });
    let sent = 0;
    let failed = 0;
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        if (chunk.length < 2) {
          // A edge function exige 2–500; envia o resto via single fallback.
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          const url = (import.meta as any).env?.VITE_SUPABASE_URL || "";
          const lead = rows.find((r) => r.customer_id === chunk[0]);
          if (token && lead?.next_msg_draft) {
            const res = await fetch(`${url}/functions/v1/reactivation-send`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ mode: "single", customer_id: chunk[0], message_text: lead.next_msg_draft }),
            });
            const d = await res.json().catch(() => ({}));
            if (res.ok && d.ok) sent++; else failed++;
          } else {
            failed++;
          }
          setBatchSending({ done: Math.min(i + chunk.length, ids.length), total: ids.length });
          continue;
        }
        const { data, error } = await supabase.functions.invoke("reactivation-send", {
          body: { mode: "batch", customer_ids: chunk, batch_id: batchId },
        });
        if (error) throw error;
        sent += data?.sent ?? 0;
        failed += data?.failed ?? 0;
        setBatchSending({ done: Math.min(i + chunk.length, ids.length), total: ids.length });
      }
      toast.success(`Reaquecimento enviado`, { description: `${sent} enviados, ${failed} falharam` });
      exitSelectMode();
      await fetchRows();
    } catch (e: any) {
      toast.error("Falha no envio em lote", { description: e.message });
    } finally {
      setBatchSending(null);
    }
  }, [selectedIds, rows, exitSelectMode, fetchRows]);

  return (
    <Tabs value={activeView} onValueChange={setActiveView} className="space-y-5">
      <ViewSwitcher value={activeView} onChange={setActiveView} />
      <TabsList className="sr-only">
        <TabsTrigger value="fila">Fila</TabsTrigger>
        <TabsTrigger value="frases">Frases</TabsTrigger>
        <TabsTrigger value="resultados">Resultados</TabsTrigger>
        <TabsTrigger value="config">Configurar</TabsTrigger>
      </TabsList>

      <TabsContent value="fila" className="space-y-5">
        <HeroStrip
          metrics={metrics}
          bulk={bulk}
          onClassifyAll={classifyAll}
          onClassifyStale={classifyStale}
          staleLoading={bulkStale}
          onReload={fetchRows}
          loading={loading}
        />

        <FilterBar
          tempFilter={tempFilter}
          setTempFilter={setTempFilter}
          tempCounts={tempCounts}
          originFilter={originFilter}
          setOriginFilter={setOriginFilter}
          partnerOptions={partnerOptions}
          partnerFilter={partnerFilter}
          setPartnerFilter={setPartnerFilter}
          hasPartners={partners.length > 0}
          search={search}
          setSearch={setSearch}
        />

        <SelectionBar
          selectMode={selectMode}
          selectedCount={selectedIds.size}
          batchSending={batchSending}
          onToggleMode={() => {
            setSelectMode((v) => !v);
            setSelectedIds(new Set());
          }}
          onSelectAll={() => setSelectedIds(new Set(filtered.map((r) => r.customer_id)))}
          onClear={() => setSelectedIds(new Set())}
          onSend={sendBatch}
        />

        {loading ? (
          <Card className="grid place-items-center p-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </Card>
        ) : filtered.length === 0 ? (
          <EmptyState unclassified={metrics.unclassified} onClassifyAll={classifyAll} />
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {filtered.map((r, idx) => (
                <LeadCard
                  key={r.customer_id}
                  lead={r}
                  rank={idx + 1}
                  stepLabelText={stepLabel(r.conversation_step, flowTitles)}
                  classifying={classifying === r.customer_id}
                  selectMode={selectMode}
                  selected={selectedIds.has(r.customer_id)}
                  onToggleSelect={() => toggleSelect(r.customer_id)}
                  onOpen={() => setSelected(r)}
                  onClassify={() => classifyOne(r.customer_id)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </TabsContent>

      <TabsContent value="frases">
        <FrasesPanel consultantId={consultantId} availableSteps={availableSteps} />
      </TabsContent>

      <TabsContent value="resultados">
        <ResultadosPanel consultantId={consultantId} />
      </TabsContent>

      <TabsContent value="config">
        <ConfigPanel consultantId={consultantId} />
      </TabsContent>

      <ConversaoLeadDrawer
        lead={selected}
        consultantId={consultantId}
        onClose={() => setSelected(null)}
        onClassify={(id) => classifyOne(id)}
        onReload={fetchRows}
        navigate={navigate}
      />
    </Tabs>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  Sub-componentes
// ════════════════════════════════════════════════════════════════════════════

function HeroStrip({ metrics, bulk, onClassifyAll, onClassifyStale, staleLoading, onReload, loading }: {
  metrics: { total: number; classified: number; unclassified: number; hotStuck: number; revenueAtStake: number; avgChance: number };
  bulk: { done: number; total: number } | null;
  onClassifyAll: () => void;
  onClassifyStale: () => void;
  staleLoading: boolean;
  onReload: () => void;
  loading: boolean;
}) {
  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/[0.07] via-card to-card">
      <div className="flex flex-wrap items-center gap-4 p-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/30 bg-primary/15">
          <TrendingUp className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1 min-w-[220px]">
          <h2 className="text-lg font-semibold text-foreground">Central de Conversão</h2>
          <p className="text-xs text-muted-foreground">
            Fila ordenada por potencial de fechamento — os melhores leads no topo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onReload} disabled={loading || !!bulk}>
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Recarregar
          </Button>
          {metrics.unclassified > 0 && (
            <Button size="sm" onClick={onClassifyAll} disabled={!!bulk} className="gap-1.5">
              {bulk ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Classificar {metrics.unclassified}
            </Button>
          )}
          {metrics.unclassified === 0 && metrics.classified > 0 && (
            <Button size="sm" variant="outline" onClick={onClassifyStale} disabled={!!bulk || staleLoading} className="gap-1.5">
              {staleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Reclassificar 24h
            </Button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-px border-t border-border/40 bg-border/40 sm:grid-cols-4">
        <Kpi label="Leads na fila" value={String(metrics.total)} icon={<MessageSquare className="h-3.5 w-3.5" />} />
        <Kpi
          label="Quentes parados"
          value={String(metrics.hotStuck)}
          icon={<BellOff className="h-3.5 w-3.5" />}
          tone={metrics.hotStuck > 0 ? "danger" : "default"}
        />
        <Kpi label="Receita em jogo" value={brl(metrics.revenueAtStake)} sub="/mês em contas" icon={<Flame className="h-3.5 w-3.5" />} tone="warn" />
        <Kpi label="Chance média" value={`${metrics.avgChance}%`} icon={<TrendingUp className="h-3.5 w-3.5" />} />
      </div>

      {bulk && (
        <div className="space-y-1.5 border-t border-border/40 p-3">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Classificando com IA…</span>
            <span className="font-mono">{bulk.done}/{bulk.total}</span>
          </div>
          <Progress value={(bulk.done / Math.max(1, bulk.total)) * 100} className="h-1.5" />
        </div>
      )}
    </Card>
  );
}

function Kpi({ label, value, sub, icon, tone = "default" }: {
  label: string; value: string; sub?: string; icon: React.ReactNode;
  tone?: "default" | "danger" | "warn";
}) {
  const toneCls = tone === "danger" ? "text-destructive" : tone === "warn" ? "text-warning" : "text-foreground";
  return (
    <div className="bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </div>
      <div className={`mt-1 text-xl font-semibold ${toneCls}`}>
        {value}
        {sub && <span className="ml-1 text-[10px] font-normal text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

function FilterBar({
  tempFilter, setTempFilter, tempCounts, originFilter, setOriginFilter,
  partnerOptions, partnerFilter, setPartnerFilter, hasPartners, search, setSearch,
}: any) {
  const ORIGIN_LABEL: Record<OriginFilter, string> = {
    all: "Todas", meta_ads: "Meta Ads", whatsapp_direct: "WhatsApp", partner: "Parceiro",
  };
  // Total de leads classificados em cada temperatura (para o "Todos").
  const totalTemp = (Object.keys(tempCounts) as Temp[]).reduce((s, t) => s + tempCounts[t], 0);
  // Temperatura — agora em combobox (libera espaço no topo e fica mais limpo).
  const tempOptions: ComboboxOption[] = [
    { value: "all", label: "Todos", hint: String(totalTemp) },
    ...(Object.keys(TEMP_META) as Temp[]).map((t) => ({
      value: t,
      label: TEMP_META[t].label,
      hint: String(tempCounts[t]),
    })),
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/40 bg-card/40 p-2.5">
      {/* Temperatura — combobox (substitui a fileira de botões) */}
      <div className="w-44">
        <Combobox
          options={tempOptions}
          value={tempFilter}
          onChange={(v) => setTempFilter((v as Temp | "all") ?? "all")}
          placeholder="Temperatura"
          searchPlaceholder="Buscar temperatura…"
          className="h-8"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {hasPartners && (
          <div className="w-48">
            <Combobox
              options={partnerOptions}
              value={partnerFilter}
              onChange={(v: string | null) => setPartnerFilter(v ?? "all")}
              placeholder="Parceiro"
              searchPlaceholder="Buscar parceiro…"
              className="h-8"
            />
          </div>
        )}
        {/* Origem — combobox (substitui a fileira de botões) */}
        <div className="w-40">
          <Combobox
            options={(Object.keys(ORIGIN_LABEL) as OriginFilter[]).map((o) => ({
              value: o,
              label: ORIGIN_LABEL[o],
            }))}
            value={originFilter}
            onChange={(v) => setOriginFilter((v as OriginFilter) ?? "all")}
            placeholder="Origem"
            searchPlaceholder="Buscar origem…"
            className="h-8"
          />
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar nome / resumo"
            className="h-8 w-52 pl-7 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

function LeadCard({ lead, rank, stepLabelText, classifying, selectMode, selected, onToggleSelect, onOpen, onClassify }: {
  lead: LeadRow; rank: number; stepLabelText: string; classifying: boolean;
  selectMode: boolean; selected: boolean; onToggleSelect: () => void;
  onOpen: () => void; onClassify: () => void;
}) {
  const tier = priorityTier(lead.score);
  const TM = TIER_META[tier];
  const temp = lead.temperature ? TEMP_META[lead.temperature] : null;
  const TempIcon = temp?.icon;
  const isClassified = !!lead.classified_at;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.18 }}
    >
      <Card
        className={`group relative cursor-pointer overflow-hidden p-3 transition hover:border-primary/40 hover:shadow-sm ${selected ? "border-primary/60 ring-1 ring-primary/40" : ""}`}
        onClick={selectMode ? onToggleSelect : onOpen}
      >
        {/* Faixa de prioridade na lateral */}
        <span className={`absolute left-0 top-0 h-full w-1 ${TM.dot}`} />

        {selectMode && (
          <span
            className={`absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border/60 bg-card"}`}
          >
            {selected && <CheckSquare className="h-3.5 w-3.5" />}
          </span>
        )}

        <div className="flex items-start gap-3 pl-1.5">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium ${temp ? temp.cls : "border-border/40 bg-muted/40 text-muted-foreground"}`}>
            {initials(lead.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-foreground">{lead.name || "(sem nome)"}</span>
              {lead.bot_paused && (
                <BellOff className="h-3 w-3 shrink-0 text-destructive" aria-label="Bot pausado" />
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className={`rounded border px-1.5 py-0.5 text-[10px] ${TM.cls}`}>{TM.label}</span>
              {temp && TempIcon && (
                <span className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] ${temp.cls}`}>
                  <TempIcon className="h-2.5 w-2.5" /> {temp.label}
                </span>
              )}
              {lead.classification_source && lead.classification_source !== "cache" && (
                <span className="rounded border border-border/40 bg-muted/40 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                  {SOURCE_LABEL[lead.classification_source] ?? lead.classification_source}
                </span>
              )}
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <Clock className="h-2.5 w-2.5" /> {formatStuck(lead.hours_stuck)}
              </span>
            </div>
            {lead.conversation_step && (
              <p className="mt-1 truncate text-[10px] text-muted-foreground">{stepLabelText}</p>
            )}
          </div>
          <div className="text-right">
            <div className="font-mono text-sm font-semibold text-foreground">{Math.round(lead.score)}</div>
            <div className="text-[9px] uppercase text-muted-foreground">score</div>
          </div>
        </div>

        {/* conta + chance */}
        <div className="mt-2 flex items-center gap-3 pl-1.5">
          {lead.bill_value != null && (
            <span className="text-[11px] text-muted-foreground">conta <strong className="text-foreground">{brl(lead.bill_value)}</strong></span>
          )}
          {lead.conversion_chance != null && (
            <div className="flex flex-1 items-center gap-1.5">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/60">
                <div className={`h-full ${TM.dot}`} style={{ width: `${Math.max(3, Math.min(100, lead.conversion_chance))}%` }} />
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">{lead.conversion_chance}%</span>
            </div>
          )}
        </div>

        {/* próxima ação ou CTA classificar */}
        {isClassified ? (
          lead.next_action && (
            <p className="mt-2 line-clamp-1 pl-1.5 text-[11px] text-muted-foreground">
              <span className="text-primary">▸</span> {lead.next_action}
            </p>
          )
        ) : (
          <Button
            size="sm" variant="outline" className="mt-2 h-7 w-full gap-1 text-[11px]"
            onClick={(e) => { e.stopPropagation(); onClassify(); }}
            disabled={classifying}
          >
            {classifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Analisar com IA
          </Button>
        )}
      </Card>
    </motion.div>
  );
}

function SelectionBar({ selectMode, selectedCount, batchSending, onToggleMode, onSelectAll, onClear, onSend }: {
  selectMode: boolean;
  selectedCount: number;
  batchSending: { done: number; total: number } | null;
  onToggleMode: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  onSend: () => void;
}) {
  if (!selectMode) {
    return (
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onToggleMode} className="gap-1.5">
          <CheckSquare className="h-4 w-4" /> Selecionar para envio em lote
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 p-2.5">
      <span className="text-xs font-medium text-foreground">{selectedCount} selecionado(s)</span>
      <Button variant="ghost" size="sm" onClick={onSelectAll} className="h-7 text-[11px]">Selecionar todos</Button>
      <Button variant="ghost" size="sm" onClick={onClear} className="h-7 text-[11px]">Limpar</Button>
      <div className="ml-auto flex items-center gap-2">
        {batchSending && (
          <span className="text-[11px] text-muted-foreground font-mono">{batchSending.done}/{batchSending.total}</span>
        )}
        <Button
          size="sm"
          className="h-7 gap-1.5 text-[11px]"
          disabled={selectedCount < 2 || !!batchSending}
          onClick={onSend}
        >
          {batchSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Reativar selecionados
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleMode} disabled={!!batchSending}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function EmptyState({ unclassified, onClassifyAll }: { unclassified: number; onClassifyAll: () => void }) {
  return (
    <Card className="p-16 text-center">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-border/40 bg-muted/40">
        <Sparkles className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">Nenhum lead com esses filtros.</p>
      {unclassified > 0 && (
        <Button size="sm" className="mt-4 gap-1.5" onClick={onClassifyAll}>
          <Zap className="h-3.5 w-3.5" /> Classificar {unclassified} agora
        </Button>
      )}
    </Card>
  );
}

const VIEW_META: Record<string, { label: string; desc: string; icon: any }> = {
  fila:       { label: "Fila de leads", desc: "Leads ordenados por potencial",  icon: ListOrdered },
  frases:     { label: "Frases",        desc: "Mensagens sugeridas por etapa",  icon: MessageSquareText },
  resultados: { label: "Resultados",    desc: "Métricas e desempenho",          icon: TrendingUp },
  config:     { label: "Configurar",    desc: "Ajustes do cockpit",             icon: Settings2 },
};

function ViewSwitcher({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const current = VIEW_META[value] ?? VIEW_META.fila;
  const CurrentIcon = current.icon;
  const options: ComboboxOption[] = Object.entries(VIEW_META).map(([k, m]) => ({
    value: k,
    label: m.label,
    hint: m.desc,
  }));
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-card via-card to-card/60 p-4 shadow-sm">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
          <CurrentIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-foreground">{current.label}</h2>
          <p className="truncate text-xs text-muted-foreground">{current.desc}</p>
        </div>
        <div className="w-full sm:w-64">
          <Combobox
            options={options}
            value={value}
            onChange={(v) => onChange((v as string) ?? "fila")}
            placeholder="Selecionar visão"
            searchPlaceholder="Buscar visão…"
            className="h-9"
          />
        </div>
      </div>
    </div>
  );
}

export default ConversaoCockpit;
