import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, ChevronDown, ChevronUp, Megaphone, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";

// Painel unificado de custos do mês: Anúncios (FB Ads) + IA.
// Mostra total estimado e permite expandir cada categoria.

type CostRow = {
  day: string;
  phase: string;
  calls: number;
  usd_est: number;
};

const PHASE_LABEL: Record<string, string> = {
  orchestrator: "Atendimento (conversa)",
  conversa: "Atendimento (conversa)",
  faq: "Respostas de dúvidas",
  intent: "Entender a mensagem",
  triage: "Triagem",
  extract: "Leitura de dados",
  ocr: "Leitura de conta/documento",
  other: "Outros",
  embedding: "Busca de conhecimento",
};

const USD_TO_BRL = 5.5;
const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brlFromUsd = (usd: number) => (usd * USD_TO_BRL).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function MonthlyCostsCard({ userId, className }: { userId: string; className?: string }) {
  const [aiRows, setAiRows] = useState<CostRow[]>([]);
  const [adSpendCents, setAdSpendCents] = useState(0);
  const [adByCampaign, setAdByCampaign] = useState<Array<{ name: string; cents: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [openAds, setOpenAds] = useState(false);
  const [openAi, setOpenAi] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const firstIso = firstDay.toISOString();
      const firstDayStr = firstIso.slice(0, 10);

      const [{ data: aiData }, { data: spendData }] = await Promise.all([
        supabase
          .from("ai_costs")
          .select("day, phase, calls, usd_est")
          .eq("consultant_id", userId)
          .gte("day", firstDayStr),
        supabase
          .from("wallet_transactions")
          .select("amount_cents, description, metadata")
          .eq("consultant_id", userId)
          .eq("type", "spend")
          .gte("created_at", firstIso),
      ]);

      if (cancelled) return;
      setAiRows((aiData as CostRow[]) || []);

      const spendRows = (spendData || []) as Array<{ amount_cents: number; description: string | null; metadata: any }>;
      const totalSpend = spendRows.reduce((s, r) => s + Number(r.amount_cents || 0), 0);
      setAdSpendCents(totalSpend);

      const byCampaign = new Map<string, number>();
      for (const r of spendRows) {
        const name = r.metadata?.campaign_name || (r.description || "Campanha").split(" • ")[0] || "Campanha";
        byCampaign.set(name, (byCampaign.get(name) || 0) + Number(r.amount_cents || 0));
      }
      setAdByCampaign(
        Array.from(byCampaign.entries())
          .map(([name, cents]) => ({ name, cents }))
          .sort((a, b) => b.cents - a.cents)
          .slice(0, 10),
      );
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const aiUsd = aiRows.reduce((s, r) => s + Number(r.usd_est || 0), 0);
  const aiCents = Math.round(aiUsd * USD_TO_BRL * 100);
  const totalCents = aiCents + adSpendCents;

  const aiByPhase = new Map<string, { usd: number; calls: number }>();
  for (const r of aiRows) {
    const k = PHASE_LABEL[r.phase] || r.phase;
    const cur = aiByPhase.get(k) || { usd: 0, calls: 0 };
    cur.usd += Number(r.usd_est || 0);
    cur.calls += Number(r.calls || 0);
    aiByPhase.set(k, cur);
  }
  const aiPhases = Array.from(aiByPhase.entries()).sort((a, b) => b[1].usd - a[1].usd);

  return (
    <div className={cn("bg-card border border-border rounded-2xl p-5 space-y-4 min-w-0", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
            <Receipt className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="font-heading font-bold text-foreground">Custos do mês</h3>
            <p className="text-xs text-muted-foreground">Anúncios + Assistente IA. Valores estimados.</p>
          </div>
        </div>
        <div className="text-left sm:text-right shrink-0">
          <div className="text-2xl font-bold text-foreground">{loading ? "…" : brl(totalCents)}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">total estimado</div>
        </div>
      </div>

      {/* Anúncios */}
      <div className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden">
        <button
          type="button"
          onClick={() => setOpenAds((o) => !o)}
          className="w-full flex items-center justify-between p-3 hover:bg-muted/40 transition"
        >
          <div className="flex items-center gap-2.5">
            <Megaphone className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">Anúncios (Facebook)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold tabular-nums text-foreground">{loading ? "…" : brl(adSpendCents)}</span>
            {openAds ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </button>
        {openAds && !loading && (
          <div className="border-t border-border/60 px-3 py-2 space-y-1.5">
            {adByCampaign.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">Nenhum gasto com anúncios neste mês.</p>
            ) : adByCampaign.map((c) => (
              <div key={c.name} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground truncate pr-2">{c.name}</span>
                <span className="text-foreground tabular-nums">{brl(c.cents)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* IA */}
      <div className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden">
        <button
          type="button"
          onClick={() => setOpenAi((o) => !o)}
          className="w-full flex items-center justify-between p-3 hover:bg-muted/40 transition"
        >
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">Assistente IA</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold tabular-nums text-foreground">{loading ? "…" : brlFromUsd(aiUsd)}</span>
            {openAi ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </button>
        {openAi && !loading && (
          <div className="border-t border-border/60 px-3 py-2 space-y-1.5">
            {aiPhases.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">Nenhum gasto com IA neste mês.</p>
            ) : aiPhases.map(([label, v]) => (
              <div key={label} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground truncate pr-2">{label} <span className="text-[10px] opacity-60">({v.calls})</span></span>
                <span className="text-foreground tabular-nums">{brlFromUsd(v.usd)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        💡 O WhatsApp/robô em si não tem custo separado — está incluso no plano. Você só paga pelos anúncios
        que rodam e pelo uso da IA durante o atendimento.
      </p>
    </div>
  );
}
