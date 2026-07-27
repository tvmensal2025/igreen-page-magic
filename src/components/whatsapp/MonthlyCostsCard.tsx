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
  const [foneSpendCents, setFoneSpendCents] = useState(0);
  const [adByCampaign, setAdByCampaign] = useState<Array<{ name: string; cents: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [openAds, setOpenAds] = useState(false);
  const [openAi, setOpenAi] = useState(false);
  const [openFone, setOpenFone] = useState(false);

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
      let ads = 0;
      let fone = 0;
      const byCampaign = new Map<string, number>();
      for (const r of spendRows) {
        const ch = String(r.metadata?.channel || "");
        const cents = Number(r.amount_cents || 0);
        if (ch === "sms" || ch === "voice") {
          fone += cents;
          continue;
        }
        ads += cents;
        const name = r.metadata?.campaign_name || (r.description || "Campanha").split(" • ")[0] || "Campanha";
        byCampaign.set(name, (byCampaign.get(name) || 0) + cents);
      }
      setAdSpendCents(ads);
      setFoneSpendCents(fone);
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
  // IA é informativa (não debita carteira). Total cobrado = ads + iGreen Fone.
  const totalCents = adSpendCents + foneSpendCents;

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
            <p className="text-xs text-muted-foreground">Anúncios + iGreen Fone (SMS/ligação). IA é só estimativa.</p>
          </div>
        </div>
        <div className="text-left sm:text-right shrink-0">
          <div className="text-2xl font-bold text-foreground">{loading ? "…" : brl(totalCents)}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">total na carteira</div>
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

      {/* iGreen Fone */}
      <div className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden">
        <button
          type="button"
          onClick={() => setOpenFone((o) => !o)}
          className="w-full flex items-center justify-between p-3 hover:bg-muted/40 transition"
        >
          <div className="flex items-center gap-2.5">
            <Receipt className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">iGreen Fone (SMS + ligação)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold tabular-nums text-foreground">{loading ? "…" : brl(foneSpendCents)}</span>
            {openFone ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </button>
        {openFone && !loading && (
          <div className="border-t border-border/60 px-3 py-2">
            <p className="text-xs text-muted-foreground py-1 leading-relaxed">
              SMS R$ 0,10 · ligação R$ 0,10 a cada 30s atendida. WhatsApp e chatbot não entram aqui.
            </p>
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
            <span className="text-sm font-medium text-foreground">Assistente IA (estimado · grátis)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold tabular-nums text-foreground">{loading ? "…" : brlFromUsd(aiUsd)}</span>
            {openAi ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </button>
        {openAi && !loading && (
          <div className="border-t border-border/60 px-3 py-2 space-y-1.5">
            {aiPhases.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">Nenhum uso de IA registrado neste mês.</p>
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
        WhatsApp e chatbot são grátis. SMS e ligação usam a carteira (mesmo saldo dos anúncios).
        Novos consultores começam com R$ 1,00 — para mais crédito, fale com o administrador.
      </p>
    </div>
  );
}
