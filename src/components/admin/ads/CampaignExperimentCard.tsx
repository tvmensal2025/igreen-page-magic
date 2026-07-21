import { useEffect, useMemo, useState } from "react";
import { AlertCircle, BarChart3, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { META_CAMPAIGN_PROOF_OR, hasMetaCampaignProof } from "@/lib/metaCampaignProof";
import {
  evaluateMetaAdsExperiment,
  type MetaAdsCampaignContext,
  type MetaAdsDailyMetrics,
  type MetaAdsExperimentResult,
} from "@/lib/metaAdsExperiment";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const RAFAEL_EMAIL = "rafael.ids@icloud.com";
const PAGE_SIZE = 1_000;

interface Campaign extends MetaAdsCampaignContext {
  name: string;
  status: string;
  createdAt: string;
}

interface MetricRow {
  campaign_id: string;
  date: string;
  spend_cents: number;
  impressions: number;
  messaging_conversations_started: number;
  meta_lead_actions: number;
}

function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function dateInSaoPaulo(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function startOfSaoPauloDateUtc(date: string): string {
  return `${date}T03:00:00.000Z`;
}

async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export function CampaignExperimentCard({ consultantId }: { consultantId: string }) {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [controlId, setControlId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [conditionsConfirmed, setConditionsConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MetaAdsExperimentResult | null>(null);

  useEffect(() => {
    let active = true;
    setAuthorized(null);
    setCampaigns([]);
    setControlId("");
    setVariantId("");
    setConditionsConfirmed(false);
    setResult(null);
    setError(null);
    void (async () => {
      const { data: consultant, error: consultantError } = await supabase
        .from("consultants")
        .select("id,igreen_portal_email")
        .eq("id", consultantId)
        .maybeSingle();
      if (!active) return;
      if (consultantError) {
        setAuthorized(false);
        return;
      }
      const isRafael = consultant?.id === consultantId
        && (consultant.igreen_portal_email ?? "").trim().toLocaleLowerCase() === RAFAEL_EMAIL;
      setAuthorized(isRafael);
      if (!isRafael) return;

      setLoadingCampaigns(true);
      const { data, error: campaignsError } = await supabase
        .from("facebook_campaigns")
        .select("id,name,status,consultant_id,distribuidora,cities,age_min,age_max,daily_budget_cents,optimization_strategy,tracking_protocol,created_at")
        .eq("consultant_id", consultantId)
        .order("created_at", { ascending: false });
      if (!active) return;
      setLoadingCampaigns(false);
      if (campaignsError) {
        setError(`Não foi possível listar as campanhas: ${campaignsError.message}`);
        return;
      }
      setCampaigns((data ?? []).map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        consultantId: campaign.consultant_id,
        distribuidora: campaign.distribuidora,
        cities: campaign.cities,
        ageMin: campaign.age_min,
        ageMax: campaign.age_max,
        dailyBudgetCents: campaign.daily_budget_cents,
        optimizationStrategy: campaign.optimization_strategy,
        trackingProtocol: campaign.tracking_protocol,
        createdAt: campaign.created_at,
      })));
    })();
    return () => { active = false; };
  }, [consultantId]);

  const selectedControl = useMemo(() => campaigns.find((campaign) => campaign.id === controlId) ?? null, [campaigns, controlId]);
  const selectedVariant = useMemo(() => campaigns.find((campaign) => campaign.id === variantId) ?? null, [campaigns, variantId]);

  async function analyze() {
    if (!selectedControl || !selectedVariant || !conditionsConfirmed) return;
    setAnalyzing(true);
    setError(null);
    setResult(null);
    try {
      const today = todayInSaoPaulo();
      const earliestCampaignDate = [selectedControl.createdAt, selectedVariant.createdAt]
        .map((value) => value.slice(0, 10))
        .sort()[0];
      const campaignIds = [selectedControl.id, selectedVariant.id];

      const [metricRows, customerRows, approvedRows] = await Promise.all([
        readAll<MetricRow>((from, to) => supabase
          .from("facebook_metrics_daily")
          .select("campaign_id,date,spend_cents,impressions,messaging_conversations_started,meta_lead_actions")
          .in("campaign_id", campaignIds)
          .gte("date", earliestCampaignDate)
          .lt("date", today)
          .order("date", { ascending: true })
          .range(from, to)),
        readAll<any>((from, to) => (supabase as any)
          .from("customers")
          .select("id,source_campaign_id,created_at,source_ad_id,ctwa_clid,source_ctwa_clid")
          .eq("consultant_id", consultantId)
          .in("source_campaign_id", campaignIds)
          .or(META_CAMPAIGN_PROOF_OR)
          .gte("created_at", startOfSaoPauloDateUtc(earliestCampaignDate))
          .lt("created_at", startOfSaoPauloDateUtc(today))
          .order("created_at", { ascending: true })
          .range(from, to)),
        readAll<any>((from, to) => (supabase as any)
          .from("crm_deals")
          .select("id,approved_at,customers!inner(source_campaign_id,source_ad_id,ctwa_clid,source_ctwa_clid)")
          .eq("consultant_id", consultantId)
          .eq("stage", "aprovado")
          .in("customers.source_campaign_id", campaignIds)
          .not("approved_at", "is", null)
          .gte("approved_at", startOfSaoPauloDateUtc(earliestCampaignDate))
          .lt("approved_at", startOfSaoPauloDateUtc(today))
          .order("approved_at", { ascending: true })
          .range(from, to)),
      ]);

      const daily = new Map<string, MetaAdsDailyMetrics>();
      const metricKeys = new Set<string>();
      const keyOf = (campaignId: string, date: string) => `${campaignId}:${date}`;
      const ensure = (campaignId: string, date: string) => {
        const key = keyOf(campaignId, date);
        if (!daily.has(key)) daily.set(key, { date, spendCents: 0, impressions: 0, conversations: 0, metaLeads: 0, crmContacts: 0, approved: 0 });
        return daily.get(key)!;
      };
      metricRows.forEach((row) => {
        metricKeys.add(keyOf(row.campaign_id, row.date));
        const item = ensure(row.campaign_id, row.date);
        item.spendCents += Number(row.spend_cents || 0);
        item.impressions += Number(row.impressions || 0);
        item.conversations += Number(row.messaging_conversations_started || 0);
        item.metaLeads += Number(row.meta_lead_actions || 0);
      });
      customerRows.forEach((row) => {
        if (!row.source_campaign_id || !hasMetaCampaignProof(row)) return;
        ensure(row.source_campaign_id, dateInSaoPaulo(row.created_at)).crmContacts += 1;
      });
      approvedRows.forEach((row) => {
        const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
        if (!customer?.source_campaign_id || !hasMetaCampaignProof(customer)) return;
        ensure(customer.source_campaign_id, dateInSaoPaulo(row.approved_at)).approved += 1;
      });
      const rowsFor = (campaignId: string) => [...daily.entries()]
        .filter(([key]) => key.startsWith(`${campaignId}:`) && metricKeys.has(key))
        .map(([, row]) => row);
      setResult(evaluateMetaAdsExperiment(
        { context: selectedControl, dailyMetrics: rowsFor(selectedControl.id) },
        { context: selectedVariant, dailyMetrics: rowsFor(selectedVariant.id) },
        { today },
      ));
    } catch (queryError) {
      const message = queryError instanceof Error ? queryError.message : "Erro desconhecido";
      setError(`A análise não foi concluída. Nenhum valor foi tratado como zero: ${message}`);
    } finally {
      setAnalyzing(false);
    }
  }

  if (authorized !== true) return null;

  return (
    <Card className="border-primary/25">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4 text-primary" /> Comparador controlado de campanhas</CardTitle>
            <CardDescription className="mt-1">Compara custo por resultado em campanhas distintas, simultâneas e com contexto equivalente.</CardDescription>
          </div>
          <Badge variant="outline">Somente leitura</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>O que pode ser comparado</AlertTitle>
          <AlertDescription>
            Itens dentro do mesmo <code>asset_feed_spec</code> não formam um A/B isolado. Use apenas campanhas diferentes que rodaram nos mesmos dias. Este teste não garante resultado futuro e não usa benchmark de mercado.
          </AlertDescription>
        </Alert>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="experiment-control">Campanha controle</Label>
            <Select value={controlId} onValueChange={(value) => { setControlId(value); setConditionsConfirmed(false); setResult(null); }} disabled={loadingCampaigns}>
              <SelectTrigger id="experiment-control" aria-label="Escolher campanha controle"><SelectValue placeholder="Selecione o controle" /></SelectTrigger>
              <SelectContent>{campaigns.map((campaign) => <SelectItem key={campaign.id} value={campaign.id} disabled={campaign.id === variantId}>{campaign.name} — {campaign.status}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="experiment-variant">Campanha variante</Label>
            <Select value={variantId} onValueChange={(value) => { setVariantId(value); setConditionsConfirmed(false); setResult(null); }} disabled={loadingCampaigns}>
              <SelectTrigger id="experiment-variant" aria-label="Escolher campanha variante"><SelectValue placeholder="Selecione a variante" /></SelectTrigger>
              <SelectContent>{campaigns.map((campaign) => <SelectItem key={campaign.id} value={campaign.id} disabled={campaign.id === controlId}>{campaign.name} — {campaign.status}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-lg border p-3">
          <Checkbox
            id="experiment-conditions"
            checked={conditionsConfirmed}
            onCheckedChange={(checked) => { setConditionsConfirmed(checked === true); setResult(null); }}
            disabled={!selectedControl || !selectedVariant}
            aria-describedby="experiment-conditions-description"
          />
          <div className="grid gap-1 leading-none">
            <Label htmlFor="experiment-conditions" className="cursor-pointer">Confirmo que o teste alterou somente o anúncio</Label>
            <p id="experiment-conditions-description" className="text-xs leading-relaxed text-muted-foreground">
              Público, cidades, idade, oferta, orçamento, posicionamentos, período e fluxo após o clique permaneceram equivalentes. Sem essa confirmação, a diferença não pode ser atribuída ao criativo ou à copy.
            </p>
          </div>
        </div>

        <Button onClick={() => void analyze()} disabled={!selectedControl || !selectedVariant || !conditionsConfirmed || analyzing || loadingCampaigns} className="w-full sm:w-auto">
          {(analyzing || loadingCampaigns) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Analisar comparação
        </Button>

        {error && <Alert variant="destructive" role="alert"><AlertCircle className="h-4 w-4" /><AlertTitle>Falha na leitura</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {result && <ExperimentResult result={result} />}
      </CardContent>
    </Card>
  );
}

function money(cents: number | null): string {
  return cents === null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function ExperimentResult({ result }: { result: MetaAdsExperimentResult }) {
  const status = result.status === "reducao_confirmada"
    ? { title: "Redução confirmada nos dados analisados", description: "A variante atingiu a redução mínima e o limite estatístico definido.", className: "border-primary/40 bg-primary/5" }
    : result.status === "sem_evidencia"
      ? { title: "Sem evidência de redução", description: "A comparação é analisável, mas não confirmou a redução nas regras definidas.", className: "border-warning/40 bg-warning/5" }
      : { title: "Resultado inconclusivo", description: "Faltou comparabilidade ou volume mínimo para concluir.", className: "border-border bg-muted/30" };
  return (
    <div className="space-y-4" aria-live="polite">
      <div className={`rounded-lg border p-4 ${status.className}`}>
        <div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-semibold text-foreground">{status.title}</p><p className="text-sm text-muted-foreground">{status.description}</p></div></div>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div><span className="text-muted-foreground">Redução pontual:</span> <strong>{percent(result.pointReduction)}</strong></div>
          <div><span className="text-muted-foreground">Razão variante/controle:</span> <strong>{result.costRatio?.toFixed(3) ?? "—"}</strong></div>
          <div><span className="text-muted-foreground">Limite superior 95%:</span> <strong>{result.upper95?.toFixed(3) ?? "—"}</strong></div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Limite unilateral de 95% por bootstrap pareado determinístico de {result.bootstrapIterations.toLocaleString("pt-BR")} reamostragens. Confirmação exige limite &lt; 1 e redução pontual mínima de {percent(result.minimumPointReduction)}.</p>
      </div>

      <div className="overflow-x-auto max-w-full min-w-0 rounded-lg border overscroll-x-contain">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground"><tr><th className="p-3">Braço</th><th className="p-3 text-right">Gasto</th><th className="p-3 text-right">Custo/conversa</th><th className="p-3 text-right">Custo/lead Meta</th><th className="p-3 text-right">Custo/contato CRM</th><th className="p-3 text-right">Custo/aprovado</th></tr></thead>
          <tbody>
            <ArmRow label="Controle" summary={result.control} />
            <ArmRow label="Variante" summary={result.variant} />
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border p-3"><p className="mb-2 text-sm font-semibold">Resumo das quatro etapas</p><ol className="space-y-2">{result.stages.map((stage) => <li key={stage.key} className="text-xs"><Badge variant={stage.passed ? "default" : "outline"} className="mr-2">{stage.passed ? "OK" : "Pendente"}</Badge><strong>{stage.label}:</strong> <span className="text-muted-foreground">{stage.detail}</span></li>)}</ol></div>
        <div className="rounded-lg border p-3"><p className="mb-2 text-sm font-semibold">Motivos e regras</p>{result.reasons.length ? <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{result.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p className="text-xs text-muted-foreground">Nenhuma regra bloqueou a análise.</p>}<p className="mt-3 text-xs text-muted-foreground">Foram usados {result.overlapDates.length} dias completos sobrepostos, excluindo hoje. Regras: mínimo de 7 dias, 1.000 impressões e 20 eventos por braço; aprovados têm prioridade, depois contatos CRM. Conversas e leads Meta são apenas diagnósticos.</p></div>
      </div>
    </div>
  );
}

function ArmRow({ label, summary }: { label: string; summary: MetaAdsExperimentResult["control"] }) {
  return <tr className="border-t"><th className="p-3 text-left font-medium">{label}<span className="mt-1 block text-xs font-normal text-muted-foreground">{summary.conversations} conversas · {summary.metaLeads} leads Meta · {summary.crmContacts} contatos CRM · {summary.approved} aprovados</span></th><td className="p-3 text-right font-mono">{money(summary.spendCents)}</td><td className="p-3 text-right font-mono">{money(summary.costPerConversationCents)}</td><td className="p-3 text-right font-mono">{money(summary.costPerMetaLeadCents)}</td><td className="p-3 text-right font-mono">{money(summary.costPerCrmContactCents)}</td><td className="p-3 text-right font-mono">{money(summary.costPerApprovedCents)}</td></tr>;
}
